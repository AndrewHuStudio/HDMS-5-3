"""
Ingestion pipeline for processing OCR documents into vector database.
"""

import json
import uuid
import hashlib
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
import logging

from .chunker import DocumentChunker
from .embedder import EmbeddingService
from ..vision_service import VisionService
from ...core.database.milvus_client import MilvusClient
from ...core.database.mongodb_client import MongoDBClient
from ...core.database.neo4j_client import Neo4jClient
from ...core import config

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """Pipeline for ingesting OCR documents into vector and document databases."""

    DOCUMENTS_COLLECTION = "documents"
    CHUNKS_COLLECTION = "chunks"
    VERSIONS_COLLECTION = "document_versions"

    def __init__(
        self,
        milvus_client: MilvusClient,
        mongodb_client: MongoDBClient,
        embedding_service: EmbeddingService,
        vision_service: VisionService,
        chunker: DocumentChunker,
        neo4j_client: Optional[Neo4jClient] = None
    ):
        """
        Initialize ingestion pipeline.

        Args:
            milvus_client: Milvus vector database client
            mongodb_client: MongoDB document database client
            embedding_service: Service for generating embeddings
            vision_service: Service for describing images
            chunker: Document chunker
        """
        self.milvus = milvus_client
        self.mongodb = mongodb_client
        self.embedder = embedding_service
        self.vision = vision_service
        self.chunker = chunker
        self.neo4j = neo4j_client

    def ingest_document(
        self,
        markdown_path: str,
        meta_path: str,
        images_dir: Optional[str] = None,
        process_images: bool = True
    ) -> Dict[str, Any]:
        """Ingest a single OCR document with incremental chunk updates."""
        logger.info(f"Starting ingestion for {markdown_path}")

        md_path = Path(markdown_path)
        meta_file = Path(meta_path)
        if not md_path.exists() or not md_path.is_file():
            raise FileNotFoundError(f"Markdown file not found: {md_path}")
        if not meta_file.exists() or not meta_file.is_file():
            raise FileNotFoundError(f"Metadata file not found: {meta_file}")

        try:
            markdown_text = md_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to read markdown file: {e}")
            raise

        try:
            metadata = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception as e:
            logger.error(f"Failed to parse metadata JSON: {e}")
            raise

        if not markdown_text.strip():
            raise ValueError(f"Markdown file is empty: {md_path}")

        return self._ingest_loaded_document(
            markdown_text=markdown_text,
            metadata=metadata,
            markdown_path=str(md_path.resolve()),
            images_dir=images_dir,
            process_images=process_images,
            force_doc_id=None,
            is_rollback=False,
            rollback_from_version=None,
        )

    def rollback_document(
        self,
        doc_id: str,
        target_version: int,
        process_images: bool = False,
        images_dir: Optional[str] = None
    ) -> Dict[str, Any]:
        """Rollback one document to a historical version snapshot."""
        if target_version <= 0:
            raise ValueError("target_version must be > 0")

        snapshot = self.mongodb.find_one(
            self.VERSIONS_COLLECTION,
            {"doc_id": doc_id, "version": target_version},
        )
        if not snapshot:
            raise ValueError(f"Version {target_version} not found for document {doc_id}")

        markdown_text = str(snapshot.get("full_text") or "")
        metadata = snapshot.get("metadata") or {}
        markdown_path = str(snapshot.get("markdown_path") or "")
        if not markdown_path:
            current_doc = self.mongodb.find_by_id(self.DOCUMENTS_COLLECTION, doc_id) or {}
            markdown_path = str(current_doc.get("markdown_path") or f"rollback://{doc_id}/v{target_version}")

        result = self._ingest_loaded_document(
            markdown_text=markdown_text,
            metadata=metadata,
            markdown_path=markdown_path,
            images_dir=images_dir,
            process_images=process_images,
            force_doc_id=doc_id,
            is_rollback=True,
            rollback_from_version=target_version,
        )
        if result.get("status") != "skipped":
            result["status"] = "rolled_back"
        result["operation"] = "rollback"
        return result

    def delete_document(self, doc_id: str, delete_versions: bool = False) -> Dict[str, Any]:
        """Delete one document from Milvus/MongoDB/Neo4j."""
        cleanup = self._cleanup_doc_artifacts(
            doc_id=doc_id,
            remove_document=True,
            mark_failed_reason="",
            cleanup_graph=True,
        )

        deleted_versions = 0
        if delete_versions:
            deleted_versions = self.mongodb.delete_many(self.VERSIONS_COLLECTION, {"doc_id": doc_id})

        return {
            "doc_id": doc_id,
            "status": "success",
            "deleted_documents": int(cleanup.get("documents", 0)),
            "deleted_chunks": int(cleanup.get("chunks", 0)),
            "deleted_vectors": int(cleanup.get("vectors", 0)),
            "deleted_graph_docs": int(cleanup.get("graph_docs", 0)),
            "deleted_graph_entities": int(cleanup.get("graph_entities", 0)),
            "deleted_versions": int(deleted_versions),
        }

    def get_document_versions(self, doc_id: str, limit: int = 20) -> Dict[str, Any]:
        """Return current version and history snapshots for one document."""
        if limit <= 0:
            limit = 20

        current = self.mongodb.find_by_id(self.DOCUMENTS_COLLECTION, doc_id) or {}
        history = self.mongodb.find_by_query(
            self.VERSIONS_COLLECTION,
            {"doc_id": doc_id},
            limit=limit,
            projection={
                "doc_id": 1,
                "version": 1,
                "content_hash": 1,
                "file_name": 1,
                "markdown_path": 1,
                "chunks_count": 1,
                "created_at": 1,
                "archived_at": 1,
                "source": 1,
            },
            sort=[("version", -1)],
        )

        return {
            "doc_id": doc_id,
            "current_version": int(current.get("version") or 0),
            "current_content_hash": current.get("content_hash") or "",
            "current_status": current.get("ingest_status") or "",
            "history": history,
        }

    def repair_consistency(
        self,
        dry_run: bool = True,
        cleanup_inconsistent_docs: bool = False,
        target_doc_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Check and optionally repair Milvus/MongoDB/Neo4j consistency."""
        target_set = {doc_id for doc_id in (target_doc_ids or []) if doc_id}

        docs = self.mongodb.find_by_query(
            self.DOCUMENTS_COLLECTION,
            {"_id": {"$in": list(target_set)}} if target_set else {},
            limit=None,
            projection={"_id": 1},
        )
        mongo_doc_ids = {str(doc.get("_id")) for doc in docs if doc.get("_id")}

        chunks = self.mongodb.find_by_query(
            self.CHUNKS_COLLECTION,
            {"doc_id": {"$in": list(target_set)}} if target_set else {},
            limit=None,
            projection={"_id": 1, "doc_id": 1},
        )
        chunk_doc_counts: Dict[str, int] = {}
        orphan_chunk_ids: List[str] = []
        for chunk in chunks:
            chunk_id = str(chunk.get("_id") or "")
            doc_id = str(chunk.get("doc_id") or "")
            if target_set and doc_id not in target_set and doc_id:
                continue
            if not doc_id:
                if chunk_id:
                    orphan_chunk_ids.append(chunk_id)
                continue
            chunk_doc_counts[doc_id] = chunk_doc_counts.get(doc_id, 0) + 1
            if doc_id not in mongo_doc_ids and chunk_id:
                orphan_chunk_ids.append(chunk_id)

        milvus_rows = self.milvus.query_by_expr(
            config.MILVUS_COLLECTION_TEXT,
            'doc_id != ""',
            output_fields=["id", "doc_id"],
            limit=50000,
        )
        milvus_doc_counts: Dict[str, int] = {}
        orphan_vector_ids: List[str] = []
        for row in milvus_rows:
            vector_id = str(row.get("id") or "")
            doc_id = str(row.get("doc_id") or "")
            if target_set and doc_id not in target_set:
                continue
            if not doc_id:
                if vector_id:
                    orphan_vector_ids.append(vector_id)
                continue
            milvus_doc_counts[doc_id] = milvus_doc_counts.get(doc_id, 0) + 1
            if doc_id not in mongo_doc_ids and vector_id:
                orphan_vector_ids.append(vector_id)

        graph_doc_ids: List[str] = []
        if self.neo4j:
            graph_doc_ids = self.neo4j.get_document_doc_ids()
        if target_set:
            graph_doc_ids = [doc_id for doc_id in graph_doc_ids if doc_id in target_set]
        orphan_graph_doc_ids = [doc_id for doc_id in graph_doc_ids if doc_id not in mongo_doc_ids]

        inconsistent_docs: List[Dict[str, Any]] = []
        all_doc_ids = set(mongo_doc_ids) | set(chunk_doc_counts) | set(milvus_doc_counts)
        if target_set:
            all_doc_ids &= target_set
        for doc_id in sorted(all_doc_ids):
            mongo_chunks = int(chunk_doc_counts.get(doc_id, 0))
            milvus_vectors = int(milvus_doc_counts.get(doc_id, 0))
            if mongo_chunks != milvus_vectors:
                inconsistent_docs.append(
                    {
                        "doc_id": doc_id,
                        "mongo_chunks": mongo_chunks,
                        "milvus_vectors": milvus_vectors,
                    }
                )

        repaired = {
            "deleted_orphan_chunks": 0,
            "deleted_orphan_vectors": 0,
            "deleted_orphan_graph_docs": 0,
            "deleted_orphan_graph_entities": 0,
            "cleaned_inconsistent_docs": 0,
        }

        if not dry_run:
            for batch in self._iter_batches(orphan_chunk_ids, 500):
                repaired["deleted_orphan_chunks"] += self.mongodb.delete_many(
                    self.CHUNKS_COLLECTION,
                    {"_id": {"$in": batch}},
                )

            if orphan_vector_ids:
                repaired["deleted_orphan_vectors"] += self.milvus.delete_by_ids(
                    config.MILVUS_COLLECTION_TEXT,
                    orphan_vector_ids,
                )

            if self.neo4j:
                for doc_id in orphan_graph_doc_ids:
                    graph_cleanup = self.neo4j.delete_document_subgraph(doc_id)
                    repaired["deleted_orphan_graph_docs"] += int(graph_cleanup.get("deleted_document_nodes", 0))
                    repaired["deleted_orphan_graph_entities"] += int(graph_cleanup.get("pruned_entities", 0))

            if cleanup_inconsistent_docs:
                for row in inconsistent_docs:
                    doc_id = row.get("doc_id")
                    if not doc_id:
                        continue
                    self._cleanup_doc_artifacts(
                        doc_id=doc_id,
                        remove_document=False,
                        mark_failed_reason="Consistency repair cleared inconsistent chunk/vector data",
                        cleanup_graph=True,
                    )
                    repaired["cleaned_inconsistent_docs"] += 1

        return {
            "dry_run": dry_run,
            "target_docs": len(target_set),
            "mongo_documents": len(mongo_doc_ids),
            "mongo_chunks": len(chunks),
            "milvus_vectors_scanned": len(milvus_rows),
            "graph_documents": len(graph_doc_ids),
            "orphan_chunks": len(orphan_chunk_ids),
            "orphan_vectors": len(orphan_vector_ids),
            "orphan_graph_documents": len(orphan_graph_doc_ids),
            "inconsistent_docs": inconsistent_docs,
            "repaired": repaired,
        }

    def _ingest_loaded_document(
        self,
        markdown_text: str,
        metadata: Dict[str, Any],
        markdown_path: str,
        images_dir: Optional[str],
        process_images: bool,
        force_doc_id: Optional[str],
        is_rollback: bool,
        rollback_from_version: Optional[int],
    ) -> Dict[str, Any]:
        content_hash = self._hash_text(markdown_text)
        now = time.strftime("%Y-%m-%d %H:%M:%S")

        existing_doc, dedup_doc = self._locate_existing_documents(
            markdown_path=markdown_path,
            content_hash=content_hash,
            force_doc_id=force_doc_id,
        )

        if (
            existing_doc
            and existing_doc.get("ingest_status") == "complete"
            and existing_doc.get("content_hash") == content_hash
            and not is_rollback
        ):
            doc_id = str(existing_doc.get("_id"))
            return {
                "doc_id": doc_id,
                "file_name": existing_doc.get("file_name", "") or metadata.get("file_name", ""),
                "chunks_count": int(existing_doc.get("chunks_count") or 0),
                "images_processed": int(existing_doc.get("images_processed") or 0),
                "status": "skipped",
                "operation": "skip_identical",
                "version": int(existing_doc.get("version") or 1),
                "embeddings_generated": 0,
            }

        if (
            dedup_doc
            and not existing_doc
            and dedup_doc.get("ingest_status") == "complete"
            and not force_doc_id
            and not is_rollback
        ):
            doc_id = str(dedup_doc.get("_id"))
            return {
                "doc_id": doc_id,
                "file_name": dedup_doc.get("file_name", "") or metadata.get("file_name", ""),
                "chunks_count": int(dedup_doc.get("chunks_count") or 0),
                "images_processed": int(dedup_doc.get("images_processed") or 0),
                "status": "skipped",
                "operation": "skip_dedup_hash",
                "version": int(dedup_doc.get("version") or 1),
                "embeddings_generated": 0,
            }

        doc_id = force_doc_id or (str(existing_doc.get("_id")) if existing_doc else str(uuid.uuid4()))
        prev_version = int((existing_doc or {}).get("version") or 0)
        prev_hash = str((existing_doc or {}).get("content_hash") or "")
        changed_hash = bool(prev_hash and prev_hash != content_hash)
        if not existing_doc:
            version = 1
        elif changed_hash:
            version = max(prev_version, 1) + 1
        else:
            version = max(prev_version, 1)

        if existing_doc and changed_hash:
            self._persist_version_snapshot(existing_doc, archived_at=now)

        doc_record = {
            "_id": doc_id,
            "file_name": metadata.get("file_name", ""),
            "category": metadata.get("category", ""),
            "pages": metadata.get("pages", 0),
            "markdown_path": markdown_path,
            "full_text": markdown_text,
            "metadata": metadata,
            "ingested_at": now,
            "updated_at": now,
            "created_at": (existing_doc or {}).get("created_at") or now,
            "content_hash": content_hash,
            "ingest_status": "in_progress",
            "ingest_error": "",
            "chunks_count": 0,
            "images_processed": 0,
            "version": version,
        }
        if is_rollback and rollback_from_version is not None:
            doc_record["rollback_from_version"] = int(rollback_from_version)

        try:
            if existing_doc:
                doc_update = dict(doc_record)
                doc_update.pop("_id", None)
                self.mongodb.update_document(self.DOCUMENTS_COLLECTION, doc_id, doc_update)
            else:
                self.mongodb.insert_document(self.DOCUMENTS_COLLECTION, doc_record)
        except Exception as e:
            logger.error(f"Failed to store document in MongoDB: {e}")
            raise

        try:
            chunks = self.chunker.chunk_markdown(markdown_text, doc_id, metadata)
            logger.info(f"Created {len(chunks)} chunks")
            if not chunks:
                raise ValueError("No chunks generated from document content")

            image_descriptions: Dict[str, str] = {}
            images_processed = 0
            if process_images and images_dir:
                try:
                    if not Path(images_dir).exists():
                        raise FileNotFoundError(f"Images directory not found: {images_dir}")
                    image_descriptions, images_processed = self._process_images(images_dir, markdown_text)
                    logger.info(f"Processed {images_processed} images")
                except Exception as e:
                    logger.warning(f"Failed to process images: {e}")
                    images_processed = 0

            prepared_chunks = self._build_chunk_payloads(
                doc_id=doc_id,
                metadata=metadata,
                chunks=chunks,
                image_descriptions=image_descriptions,
                version=version,
            )

            existing_chunks = self.mongodb.find_by_query(
                self.CHUNKS_COLLECTION,
                {"doc_id": doc_id},
                limit=None,
                projection={
                    "_id": 1,
                    "chunk_index": 1,
                    "chunk_hash": 1,
                    "text": 1,
                    "enhanced_text": 1,
                },
            )
            diff = self._diff_chunks(prepared_chunks, existing_chunks)
            chunks_to_upsert = diff["upsert_chunks"]
            remove_ids = diff["remove_ids"]

            embeddings: List[List[float]] = []
            if chunks_to_upsert:
                embeddings = self.embedder.embed_batch([chunk["enhanced_text"] for chunk in chunks_to_upsert])
                self._validate_embeddings(embeddings, len(chunks_to_upsert))

            deleted_vectors = 0
            deleted_chunks = 0
            if remove_ids:
                deleted_vectors = self.milvus.delete_by_ids(config.MILVUS_COLLECTION_TEXT, remove_ids)
                deleted_chunks = self.mongodb.delete_many(self.CHUNKS_COLLECTION, {"_id": {"$in": remove_ids}})

            if chunks_to_upsert:
                milvus_data = []
                chunk_records = []
                for chunk, embedding in zip(chunks_to_upsert, embeddings):
                    chunk_id = str(chunk["_id"])
                    milvus_meta = {
                        "section_title": chunk["section_title"],
                        "has_table": chunk["has_table"],
                        "has_image": chunk["has_image"],
                        "file_name": metadata.get("file_name", ""),
                        "category": metadata.get("category", ""),
                        "chunk_hash": chunk["chunk_hash"],
                        "version": version,
                    }
                    # Propagate page info into Milvus JSON metadata
                    if chunk.get("page") is not None:
                        milvus_meta["page"] = int(chunk["page"])
                    if chunk.get("page_end") is not None:
                        milvus_meta["page_end"] = int(chunk["page_end"])

                    milvus_data.append({
                        "id": chunk_id,
                        "embedding": embedding,
                        "text": chunk["enhanced_text"],
                        "doc_id": doc_id,
                        "chunk_index": chunk["chunk_index"],
                        "metadata": milvus_meta,
                    })
                    chunk_record = dict(chunk)
                    chunk_record["embedding_dimension"] = len(embedding)
                    chunk_records.append(chunk_record)

                self.milvus.insert_vectors(config.MILVUS_COLLECTION_TEXT, milvus_data)
                self.mongodb.insert_many(self.CHUNKS_COLLECTION, chunk_records)

            operation = "created"
            if existing_doc:
                operation = "updated" if changed_hash else "reprocessed"
            if is_rollback:
                operation = "rollback"

            self.mongodb.update_document(
                self.DOCUMENTS_COLLECTION,
                doc_id,
                {
                    "chunks_count": len(prepared_chunks),
                    "images_processed": images_processed,
                    "ingest_status": "complete",
                    "ingest_error": "",
                    "ingested_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "version": version,
                    "unchanged_chunks": int(diff["unchanged"]),
                    "updated_chunks": int(len(chunks_to_upsert)),
                    "removed_chunks": int(diff["removed"]),
                    "embeddings_generated": int(len(chunks_to_upsert)),
                    "last_cleanup_vectors": int(deleted_vectors),
                    "last_cleanup_chunks": int(deleted_chunks),
                },
            )

            return {
                "doc_id": doc_id,
                "file_name": metadata.get("file_name", ""),
                "chunks_count": len(prepared_chunks),
                "images_processed": images_processed,
                "status": "created" if operation == "created" else "success",
                "operation": operation,
                "version": version,
                "embeddings_generated": len(chunks_to_upsert),
                "unchanged_chunks": int(diff["unchanged"]),
                "removed_chunks": int(diff["removed"]),
            }

        except Exception as e:
            cleanup = self._cleanup_doc_artifacts(
                doc_id=doc_id,
                remove_document=False,
                mark_failed_reason=str(e)[:500],
                cleanup_graph=True,
            )
            logger.warning(f"Cleanup after ingestion failure for {doc_id}: {cleanup}")
            raise

    def _build_chunk_payloads(
        self,
        doc_id: str,
        metadata: Dict[str, Any],
        chunks: List[Dict[str, Any]],
        image_descriptions: Dict[str, str],
        version: int,
    ) -> List[Dict[str, Any]]:
        payloads: List[Dict[str, Any]] = []
        for chunk in chunks:
            chunk_index = int(chunk.get("chunk_index") or 0)
            enhanced_text = self._build_enhanced_chunk_text(chunk, image_descriptions)
            payload: Dict[str, Any] = {
                "_id": f"{doc_id}_{chunk_index}",
                "doc_id": doc_id,
                "chunk_index": chunk_index,
                "text": chunk.get("text", ""),
                "enhanced_text": enhanced_text,
                "section_title": chunk.get("section_title", ""),
                "has_table": bool(chunk.get("has_table")),
                "has_image": bool(chunk.get("has_image")),
                "chunk_hash": self._hash_text(enhanced_text),
                "version": version,
                "file_name": metadata.get("file_name", ""),
                "category": metadata.get("category", ""),
            }
            # Page info injected by chunker (may be absent for legacy data)
            if chunk.get("page") is not None:
                payload["page"] = int(chunk["page"])
            if chunk.get("page_end") is not None:
                payload["page_end"] = int(chunk["page_end"])
            payloads.append(payload)
        return payloads

    def _diff_chunks(
        self,
        new_chunks: List[Dict[str, Any]],
        existing_chunks: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        existing_by_index: Dict[int, Dict[str, Any]] = {}
        for chunk in existing_chunks:
            existing_by_index[int(chunk.get("chunk_index") or 0)] = chunk

        upsert_chunks: List[Dict[str, Any]] = []
        remove_ids: List[str] = []
        unchanged = 0
        seen_indices: set[int] = set()

        for chunk in new_chunks:
            chunk_index = int(chunk.get("chunk_index") or 0)
            seen_indices.add(chunk_index)
            old_chunk = existing_by_index.get(chunk_index)
            if not old_chunk:
                upsert_chunks.append(chunk)
                continue

            old_hash = str(old_chunk.get("chunk_hash") or "")
            if not old_hash:
                old_text = str(old_chunk.get("enhanced_text") or old_chunk.get("text") or "")
                old_hash = self._hash_text(old_text)

            if old_hash == chunk.get("chunk_hash"):
                unchanged += 1
                continue

            old_id = str(old_chunk.get("_id") or "")
            if old_id:
                remove_ids.append(old_id)
            upsert_chunks.append(chunk)

        removed = 0
        for chunk_index, old_chunk in existing_by_index.items():
            if chunk_index in seen_indices:
                continue
            old_id = str(old_chunk.get("_id") or "")
            if old_id:
                remove_ids.append(old_id)
            removed += 1

        dedup_remove_ids: List[str] = []
        seen_ids: set[str] = set()
        for value in remove_ids:
            if not value or value in seen_ids:
                continue
            seen_ids.add(value)
            dedup_remove_ids.append(value)

        return {
            "upsert_chunks": upsert_chunks,
            "remove_ids": dedup_remove_ids,
            "unchanged": unchanged,
            "removed": removed,
        }

    def _validate_embeddings(self, embeddings: List[List[float]], expected_count: int) -> None:
        if len(embeddings) != expected_count:
            raise ValueError(
                f"Embedding count mismatch: expected {expected_count}, got {len(embeddings)}"
            )

        if embeddings:
            actual_dim = len(embeddings[0])
            expected_dim = config.EMBEDDING_DIMENSION
            if expected_dim and actual_dim != expected_dim:
                raise ValueError(
                    "Embedding dimension mismatch: "
                    f"expected {expected_dim}, got {actual_dim}. "
                    "Please align EMBEDDING_MODEL and EMBEDDING_DIMENSION."
                )

    def _locate_existing_documents(
        self,
        markdown_path: str,
        content_hash: str,
        force_doc_id: Optional[str],
    ) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        existing_doc = None
        dedup_doc = None

        if force_doc_id:
            existing_doc = self.mongodb.find_by_id(self.DOCUMENTS_COLLECTION, force_doc_id)
            return existing_doc, dedup_doc

        if markdown_path:
            existing_doc = self.mongodb.find_one(self.DOCUMENTS_COLLECTION, {"markdown_path": markdown_path})

        if config.INGEST_DEDUP_BY_HASH and content_hash and not existing_doc:
            dedup_doc = self.mongodb.find_one(self.DOCUMENTS_COLLECTION, {"content_hash": content_hash})

        return existing_doc, dedup_doc

    def _persist_version_snapshot(self, doc_record: Dict[str, Any], archived_at: str) -> None:
        doc_id = str(doc_record.get("_id") or "")
        if not doc_id:
            return

        version = int(doc_record.get("version") or 1)
        snapshot_id = f"{doc_id}:v{version}"
        snapshot = {
            "doc_id": doc_id,
            "version": version,
            "content_hash": doc_record.get("content_hash", ""),
            "file_name": doc_record.get("file_name", ""),
            "markdown_path": doc_record.get("markdown_path", ""),
            "full_text": doc_record.get("full_text", ""),
            "metadata": doc_record.get("metadata", {}),
            "chunks_count": int(doc_record.get("chunks_count") or 0),
            "images_processed": int(doc_record.get("images_processed") or 0),
            "created_at": doc_record.get("ingested_at") or doc_record.get("updated_at") or archived_at,
            "archived_at": archived_at,
            "source": "ingestion",
        }
        self.mongodb.upsert_document(
            self.VERSIONS_COLLECTION,
            snapshot_id,
            snapshot,
            set_on_insert={"created_at": snapshot.get("created_at", archived_at)},
        )

    def _cleanup_doc_artifacts(
        self,
        doc_id: str,
        remove_document: bool,
        mark_failed_reason: str,
        cleanup_graph: bool,
    ) -> Dict[str, int]:
        deleted_vectors = 0
        deleted_chunks = 0
        deleted_docs = 0
        deleted_graph_docs = 0
        deleted_graph_entities = 0

        if doc_id:
            try:
                deleted_vectors = self.milvus.delete_by_doc_ids(config.MILVUS_COLLECTION_TEXT, [doc_id])
            except Exception as cleanup_exc:
                logger.warning(f"Failed to cleanup Milvus for {doc_id}: {cleanup_exc}")

            try:
                deleted_chunks = self.mongodb.delete_many(self.CHUNKS_COLLECTION, {"doc_id": doc_id})
            except Exception as cleanup_exc:
                logger.warning(f"Failed to cleanup Mongo chunks for {doc_id}: {cleanup_exc}")

            if cleanup_graph and self.neo4j:
                try:
                    graph_cleanup = self.neo4j.delete_document_subgraph(doc_id)
                    deleted_graph_docs = int(graph_cleanup.get("deleted_document_nodes", 0))
                    deleted_graph_entities = int(graph_cleanup.get("pruned_entities", 0))
                except Exception as cleanup_exc:
                    logger.warning(f"Failed to cleanup Neo4j graph for {doc_id}: {cleanup_exc}")

            if remove_document:
                try:
                    deleted_docs = int(self.mongodb.delete_document(self.DOCUMENTS_COLLECTION, doc_id))
                except Exception as cleanup_exc:
                    logger.warning(f"Failed to cleanup Mongo document for {doc_id}: {cleanup_exc}")
            elif mark_failed_reason:
                try:
                    self.mongodb.update_document(
                        self.DOCUMENTS_COLLECTION,
                        doc_id,
                        {
                            "ingest_status": "failed",
                            "ingest_error": mark_failed_reason,
                            "chunks_count": 0,
                            "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                        }
                    )
                except Exception as update_exc:
                    logger.warning(f"Failed to mark document failed: {update_exc}")

        return {
            "vectors": int(deleted_vectors),
            "chunks": int(deleted_chunks),
            "documents": int(deleted_docs),
            "graph_docs": int(deleted_graph_docs),
            "graph_entities": int(deleted_graph_entities),
        }

    def _build_enhanced_chunk_text(self, chunk: Dict[str, Any], image_descriptions: Dict[str, str]) -> str:
        """
        Build final chunk text by injecting unique image descriptions referenced in this chunk.
        """
        enhanced_text = chunk["text"]
        if not chunk.get("has_image") or not image_descriptions:
            return enhanced_text

        chunk_refs = self.chunker.extract_image_refs(chunk["text"])
        appended: set[str] = set()
        for img_ref in chunk_refs:
            desc = self._get_image_description(img_ref, image_descriptions)
            if not desc or desc in appended:
                continue
            appended.add(desc)
            enhanced_text += f"\n\n[image_description: {desc}]"
        return enhanced_text

    def _process_images(
        self,
        images_dir: str,
        markdown_text: str
    ) -> tuple[Dict[str, str], int]:
        """
        Process images in directory and generate descriptions.

        Args:
            images_dir: Path to images directory
            markdown_text: Full markdown text for context extraction

        Returns:
            Tuple of (image description mapping, processed image count)
        """
        image_descriptions: Dict[str, str] = {}
        images_path = Path(images_dir)

        image_refs = self.chunker.extract_image_refs(markdown_text)
        if not image_refs:
            return image_descriptions, 0

        desc_cache: Dict[str, str] = {}
        processed_files: set[str] = set()
        for img_ref in image_refs:
            resolved_path = self._resolve_image_path(img_ref, images_path)
            if not resolved_path:
                image_descriptions[img_ref] = "[图片文件未找到]"
                continue

            cache_key = str(resolved_path)
            if cache_key in desc_cache:
                description = desc_cache[cache_key]
            else:
                context = self.chunker.extract_image_context(markdown_text, img_ref)
                try:
                    description = self.vision.describe_image(str(resolved_path), context)
                except Exception as e:
                    logger.warning(f"Failed to describe {resolved_path.name}: {e}")
                    description = "[无法生成描述]"
                desc_cache[cache_key] = description
                processed_files.add(cache_key)

            image_descriptions[img_ref] = description
            normalized = self.chunker.normalize_image_ref(img_ref)
            if normalized:
                image_descriptions.setdefault(normalized, description)
                image_descriptions.setdefault(normalized.lower(), description)
                image_descriptions.setdefault(Path(normalized).name, description)
                image_descriptions.setdefault(Path(normalized).name.lower(), description)

        return image_descriptions, len(processed_files)

    def _resolve_image_path(self, img_ref: str, images_path: Path) -> Optional[Path]:
        """
        Resolve image reference to a local file path.
        """
        if not img_ref:
            return None
        ref = self.chunker.normalize_image_ref(img_ref)
        if not ref or ref.startswith("http://") or ref.startswith("https://") or ref.startswith("data:"):
            return None

        doc_dir = images_path.parent
        candidate_paths = [
            (doc_dir / ref),
            (images_path / Path(ref).name),
        ]
        for candidate in candidate_paths:
            if candidate.exists() and candidate.is_file():
                return candidate
        return None

    def _get_image_description(self, img_ref: str, image_descriptions: Dict[str, str]) -> str:
        """
        Match image reference to a description.
        """
        if not img_ref:
            return ""
        if img_ref in image_descriptions:
            return image_descriptions[img_ref]
        normalized = self.chunker.normalize_image_ref(img_ref)
        if normalized in image_descriptions:
            return image_descriptions[normalized]
        normalized_lower = normalized.lower()
        if normalized_lower in image_descriptions:
            return image_descriptions[normalized_lower]
        base = Path(normalized).name
        if base in image_descriptions:
            return image_descriptions[base]
        base_lower = base.lower()
        return image_descriptions.get(base_lower, "")

    def ingest_batch(
        self,
        ocr_output_dir: str,
        category: Optional[str] = None,
        process_images: bool = True
    ) -> Dict[str, Any]:
        """Ingest all documents from OCR output directory incrementally."""
        output_path = Path(ocr_output_dir)
        results = {
            "total": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "added": 0,
            "updated": 0,
            "documents": []
        }

        if category:
            cat_dir = output_path / category
            if not cat_dir.exists() or not cat_dir.is_dir():
                logger.warning(f"Category directory not found: {cat_dir}")
                return results
            doc_dirs = list(cat_dir.iterdir())
        else:
            doc_dirs = []
            if not output_path.exists() or not output_path.is_dir():
                logger.warning(f"OCR output directory not found: {output_path}")
                return results
            for cat_dir in output_path.iterdir():
                if cat_dir.is_dir():
                    doc_dirs.extend(cat_dir.iterdir())

        results["total"] = len(doc_dirs)

        for doc_dir in doc_dirs:
            if not doc_dir.is_dir():
                continue

            md_files = [p for p in doc_dir.glob("*.md") if not p.name.endswith(".meta.md")]
            meta_files = list(doc_dir.glob("*.meta.json"))

            if not md_files or not meta_files:
                logger.warning(f"Skipping {doc_dir.name}: missing files")
                results["failed"] += 1
                results["documents"].append(
                    {
                        "file_name": doc_dir.name,
                        "status": "failed",
                        "operation": "invalid_input",
                        "error": "missing markdown or metadata"
                    }
                )
                continue

            markdown_path = str(md_files[0])
            meta_path = str(meta_files[0])
            images_dir = str(doc_dir / "images") if (doc_dir / "images").exists() else None

            try:
                result = self.ingest_document(
                    markdown_path,
                    meta_path,
                    images_dir,
                    process_images
                )
                status = str(result.get("status") or "")
                operation = str(result.get("operation") or "")

                if status == "skipped":
                    results["skipped"] += 1
                else:
                    results["success"] += 1
                    if operation == "created":
                        results["added"] += 1
                    else:
                        results["updated"] += 1

                results["documents"].append(result)
                logger.info(f"Successfully ingested {doc_dir.name} ({operation or status})")
            except Exception as e:
                logger.error(f"Failed to ingest {doc_dir.name}: {e}")
                results["failed"] += 1
                results["documents"].append({
                    "file_name": doc_dir.name,
                    "status": "failed",
                    "operation": "ingest_failed",
                    "error": str(e)
                })

        logger.info(
            "Batch ingestion complete: "
            f"success={results['success']}, added={results['added']}, "
            f"updated={results['updated']}, skipped={results['skipped']}, failed={results['failed']}"
        )
        return results

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256((text or "").encode("utf-8")).hexdigest()

    @staticmethod
    def _iter_batches(values: List[str], batch_size: int) -> List[List[str]]:
        return [values[idx:idx + batch_size] for idx in range(0, len(values), batch_size)]
