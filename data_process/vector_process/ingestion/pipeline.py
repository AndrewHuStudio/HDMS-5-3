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
from ...core import config

logger = logging.getLogger(__name__)


class IngestionPipeline:
    """Pipeline for ingesting OCR documents into vector and document databases."""

    def __init__(
        self,
        milvus_client: MilvusClient,
        mongodb_client: MongoDBClient,
        embedding_service: EmbeddingService,
        vision_service: VisionService,
        chunker: DocumentChunker
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

    def ingest_document(
        self,
        markdown_path: str,
        meta_path: str,
        images_dir: Optional[str] = None,
        process_images: bool = True
    ) -> Dict[str, Any]:
        """
        Ingest a single OCR document.

        Process flow:
        1. Load markdown + metadata
        2. Chunk document
        3. Generate embeddings
        4. Process images (optional)
        5. Store in Milvus + MongoDB

        Args:
            markdown_path: Path to markdown file
            meta_path: Path to metadata JSON file
            images_dir: Path to images directory (optional)
            process_images: Whether to generate image descriptions

        Returns:
            Dictionary with ingestion results
        """
        logger.info(f"Starting ingestion for {markdown_path}")

        # Validate inputs
        md_path = Path(markdown_path)
        meta_file = Path(meta_path)
        if not md_path.exists() or not md_path.is_file():
            raise FileNotFoundError(f"Markdown file not found: {md_path}")
        if not meta_file.exists() or not meta_file.is_file():
            raise FileNotFoundError(f"Metadata file not found: {meta_file}")

        # Load document
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

        # Deduplicate by content hash (optional)
        content_hash = hashlib.sha256(markdown_text.encode("utf-8")).hexdigest()
        existing = None
        if config.INGEST_DEDUP_BY_HASH:
            existing = self.mongodb.find_one(
                "documents",
                {"content_hash": content_hash},
                projection={"_id": 1, "file_name": 1, "images_processed": 1, "ingest_status": 1}
            )
            if existing and existing.get("ingest_status") == "complete":
                existing_id = str(existing.get("_id"))
                chunks_count = self.mongodb.count_documents("chunks", {"doc_id": existing_id})
                return {
                    "doc_id": existing_id,
                    "file_name": existing.get("file_name", "") or metadata.get("file_name", ""),
                    "chunks_count": chunks_count,
                    "images_processed": int(existing.get("images_processed") or 0),
                    "status": "skipped"
                }

        doc_id = str(existing.get("_id")) if existing else str(uuid.uuid4())
        now = time.strftime("%Y-%m-%d %H:%M:%S")

        # Store full document in MongoDB
        doc_record = {
            "_id": doc_id,
            "file_name": metadata.get("file_name", ""),
            "category": metadata.get("category", ""),
            "pages": metadata.get("pages", 0),
            "markdown_path": str(md_path.resolve()),
            "full_text": markdown_text,
            "metadata": metadata,
            "ingested_at": now,
            "content_hash": content_hash,
            "ingest_status": "in_progress",
            "ingest_error": "",
            "chunks_count": 0,
            "images_processed": 0
        }

        try:
            if existing:
                try:
                    self.milvus.delete_by_doc_ids(config.MILVUS_COLLECTION_TEXT, [doc_id])
                except Exception as e:
                    logger.warning(f"Failed to clean Milvus vectors for {doc_id}: {e}")
                try:
                    self.mongodb.delete_many("chunks", {"doc_id": doc_id})
                except Exception as e:
                    logger.warning(f"Failed to clean Mongo chunks for {doc_id}: {e}")
                doc_update = dict(doc_record)
                doc_update.pop("_id", None)
                self.mongodb.update_document("documents", doc_id, doc_update)
                logger.info(f"Reset document {doc_id} in MongoDB")
            else:
                self.mongodb.insert_document("documents", doc_record)
                logger.info(f"Stored document {doc_id} in MongoDB")
        except Exception as e:
            logger.error(f"Failed to store document in MongoDB: {e}")
            raise

        try:
            # Chunk document
            chunks = self.chunker.chunk_markdown(markdown_text, doc_id, metadata)
            logger.info(f"Created {len(chunks)} chunks")
            if not chunks:
                raise ValueError("No chunks generated from document content")

            # Process images (if enabled and directory exists)
            image_descriptions = {}
            images_processed = 0
            if process_images and images_dir:
                try:
                    if not Path(images_dir).exists():
                        raise FileNotFoundError(f"Images directory not found: {images_dir}")
                    image_descriptions, images_processed = self._process_images(
                        images_dir,
                        markdown_text
                    )
                    logger.info(f"Processed {images_processed} images")
                except Exception as e:
                    logger.warning(f"Failed to process images: {e}")
                    images_processed = 0

            enhanced_texts = [
                self._build_enhanced_chunk_text(chunk, image_descriptions)
                for chunk in chunks
            ]

            # Generate embeddings from the final text that will be stored in Milvus.
            embeddings = self.embedder.embed_batch(enhanced_texts)
            logger.info(f"Generated {len(embeddings)} embeddings")
            if len(embeddings) != len(enhanced_texts):
                raise ValueError(
                    f"Embedding count mismatch: expected {len(enhanced_texts)}, got {len(embeddings)}"
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

            # Prepare data for Milvus
            milvus_data = []
            for chunk, embedding, enhanced_text in zip(chunks, embeddings, enhanced_texts):
                chunk_id = f"{doc_id}_{chunk['chunk_index']}"

                milvus_data.append({
                    "id": chunk_id,
                    "embedding": embedding,
                    "text": enhanced_text,
                    "doc_id": doc_id,
                    "chunk_index": chunk["chunk_index"],
                    "metadata": {
                        "section_title": chunk["section_title"],
                        "has_table": chunk["has_table"],
                        "has_image": chunk["has_image"],
                        "file_name": metadata.get("file_name", ""),
                        "category": metadata.get("category", "")
                    }
                })
            # Insert into Milvus
            collection_name = config.MILVUS_COLLECTION_TEXT
            self.milvus.insert_vectors(collection_name, milvus_data)
            logger.info(f"Inserted {len(milvus_data)} vectors into Milvus")

            # Store chunks in MongoDB
            chunk_records = []
            for chunk, embedding, enhanced_text in zip(chunks, embeddings, enhanced_texts):
                chunk_records.append({
                    "_id": f"{doc_id}_{chunk['chunk_index']}",
                    "doc_id": doc_id,
                    "chunk_index": chunk["chunk_index"],
                    "text": chunk["text"],
                    "enhanced_text": enhanced_text,
                    "section_title": chunk["section_title"],
                    "has_table": chunk["has_table"],
                    "has_image": chunk["has_image"],
                    "embedding_dimension": len(embedding)
                })
            self.mongodb.insert_many("chunks", chunk_records)
            logger.info(f"Stored {len(chunk_records)} chunks in MongoDB")
            try:
                self.mongodb.update_document(
                    "documents",
                    doc_id,
                    {
                        "chunks_count": len(chunks),
                        "images_processed": images_processed,
                        "ingest_status": "complete",
                        "ingest_error": "",
                        "ingested_at": time.strftime("%Y-%m-%d %H:%M:%S")
                    }
                )
            except Exception as e:
                logger.warning(f"Failed to update document stats: {e}")

        except Exception as e:
            try:
                self.milvus.delete_by_doc_ids(config.MILVUS_COLLECTION_TEXT, [doc_id])
            except Exception as cleanup_exc:
                logger.warning(f"Failed to cleanup Milvus after error: {cleanup_exc}")
            try:
                self.mongodb.delete_many("chunks", {"doc_id": doc_id})
            except Exception as cleanup_exc:
                logger.warning(f"Failed to cleanup Mongo chunks after error: {cleanup_exc}")
            try:
                self.mongodb.update_document(
                    "documents",
                    doc_id,
                    {
                        "ingest_status": "failed",
                        "ingest_error": str(e)[:500]
                    }
                )
            except Exception as update_exc:
                logger.warning(f"Failed to mark document failed: {update_exc}")
            raise

        return {
            "doc_id": doc_id,
            "file_name": metadata.get("file_name", ""),
            "chunks_count": len(chunks),
            "images_processed": images_processed,
            "status": "success"
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
        """
        Ingest all documents from OCR output directory.

        Args:
            ocr_output_dir: Path to OCR output directory
            category: Optional category filter
            process_images: Whether to process images

        Returns:
            Dictionary with batch ingestion results
        """
        output_path = Path(ocr_output_dir)
        results = {
            "total": 0,
            "success": 0,
            "failed": 0,
            "skipped": 0,
            "documents": []
        }

        # Find all document directories
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

            # Find markdown and meta files
            md_files = [p for p in doc_dir.glob("*.md") if not p.name.endswith(".meta.md")]
            meta_files = list(doc_dir.glob("*.meta.json"))

            if not md_files or not meta_files:
                logger.warning(f"Skipping {doc_dir.name}: missing files")
                results["failed"] += 1
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
                if result.get("status") == "skipped":
                    results["skipped"] += 1
                else:
                    results["success"] += 1
                results["documents"].append(result)
                logger.info(f"Successfully ingested {doc_dir.name}")
            except Exception as e:
                logger.error(f"Failed to ingest {doc_dir.name}: {e}")
                results["failed"] += 1
                results["documents"].append({
                    "file_name": doc_dir.name,
                    "status": "failed",
                    "error": str(e)
                })

        logger.info(
            f"Batch ingestion complete: {results['success']}/{results['total']} succeeded"
        )
        return results
