"""
Graph builder for constructing knowledge graph from documents.
"""

from typing import List, Dict, Any, Optional
import logging

from ...core.database.neo4j_client import _validate_label
from ...core.database.mongodb_client import MongoDBClient
from ..graph_store import GraphStoreService

logger = logging.getLogger(__name__)


class GraphBuilder:
    """Builder for constructing Neo4j knowledge graph from document chunks."""

    def __init__(
        self,
        mongodb_client: MongoDBClient,
        graph_store: GraphStoreService
    ):
        """
        Initialize graph builder.

        Args:
            mongodb_client: MongoDB client for retrieving documents
            graph_store: Graph store service for entity extraction
        """
        self.mongodb = mongodb_client
        self.graph_store = graph_store

    @staticmethod
    def _build_source_document(doc_meta: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "version": int(doc_meta.get("version") or 0) or None,
            "content_hash": str(doc_meta.get("content_hash") or ""),
            "updated_at": doc_meta.get("updated_at"),
            "chunks_count": int(doc_meta.get("chunks_count") or 0),
        }

    def _should_skip_document_build(self, doc_id: str, source_document: Dict[str, Any]) -> bool:
        try:
            build_info = self.graph_store.neo4j.get_document_build_info(doc_id)
        except Exception as e:
            logger.warning(f"Failed to check document build info for {doc_id}: {e}")
            return False

        if not build_info:
            return False
        if build_info.get("kg_status") != "success":
            return False

        source_version = source_document.get("version")
        tracked_version = build_info.get("source_version")
        if source_version and not tracked_version:
            return False
        if source_version and tracked_version and int(source_version) != int(tracked_version):
            return False

        source_hash = str(source_document.get("content_hash") or "")
        tracked_hash = str(build_info.get("source_content_hash") or "")
        if source_hash and not tracked_hash:
            return False
        if source_hash and tracked_hash and source_hash != tracked_hash:
            return False

        if source_version or source_hash:
            return True

        return True

    def build_from_document(
        self,
        doc_id: str,
        use_llm: bool = True,
        max_chunks: Optional[int] = None,
        skip_if_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Build graph from a single document.

        Args:
            doc_id: Document ID
            use_llm: Whether to use LLM for entity extraction
            max_chunks: Maximum number of chunks to process (None for all)

        Returns:
            Dictionary with build results
        """
        logger.info(f"Building graph for document {doc_id}")

        # Retrieve document metadata for file_name and file_path
        doc_meta = self.mongodb.find_by_query(
            "documents",
            {"_id": doc_id},
            limit=1,
            projection={
                "file_name": 1,
                "file_path": 1,
                "version": 1,
                "content_hash": 1,
                "updated_at": 1,
                "chunks_count": 1,
            },
        )
        file_name = ""
        file_path = ""
        source_document: Dict[str, Any] = {}
        if doc_meta:
            file_name = doc_meta[0].get("file_name", "")
            file_path = doc_meta[0].get("file_path", "")
            source_document = self._build_source_document(doc_meta[0])

        if skip_if_built and not force_rebuild and self._should_skip_document_build(doc_id, source_document):
            logger.info(f"Skipping document {doc_id}: graph is up to date")
            return {
                "doc_id": doc_id,
                "file_name": file_name,
                "entities_count": 0,
                "relationships_count": 0,
                "status": "skipped",
                "reason": "already built",
            }

        # Retrieve document chunks from MongoDB
        chunks = self.mongodb.find_by_query(
            "chunks",
            {"doc_id": doc_id},
            limit=max_chunks or 1000
        )

        if not chunks:
            logger.warning(f"No chunks found for document {doc_id}")
            return {
                "doc_id": doc_id,
                "status": "failed",
                "error": "No chunks found"
            }

        # Build graph with enhanced two-pass extraction
        result = self.graph_store.build_graph_from_document(
            doc_id,
            chunks,
            use_llm=use_llm,
            file_name=file_name,
            file_path=file_path,
            source_document=source_document,
        )

        return result

    def build_from_all_documents(
        self,
        use_llm: bool = True,
        max_docs: Optional[int] = None,
        skip_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Build graph from all documents in MongoDB.

        Args:
            use_llm: Whether to use LLM for entity extraction
            max_docs: Maximum number of documents to process

        Returns:
            Dictionary with batch build results
        """
        logger.info("Building graph from all documents")

        documents = self.mongodb.find_by_query(
            "documents",
            {"ingest_status": "complete"},
            limit=max_docs or 1000,
            projection={"_id": 1, "file_name": 1}
        )

        return self._build_from_document_records(
            documents,
            use_llm=use_llm,
            skip_built=skip_built,
            force_rebuild=force_rebuild,
        )

    def build_from_documents(
        self,
        doc_ids: List[str],
        use_llm: bool = True,
        skip_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """
        Build graph from a selected set of documents.

        Args:
            doc_ids: Document IDs to process
            use_llm: Whether to use LLM for entity extraction

        Returns:
            Dictionary with batch build results
        """
        normalized_doc_ids = [str(doc_id).strip() for doc_id in doc_ids if str(doc_id).strip()]
        if not normalized_doc_ids:
            return {"total": 0, "success": 0, "failed": 0, "documents": []}

        logger.info("Building graph for %s selected documents", len(normalized_doc_ids))

        documents = self.mongodb.find_by_query(
            "documents",
            {"ingest_status": "complete"},
            limit=None,
            projection={"_id": 1, "file_name": 1}
        )
        allowed_doc_ids = set(normalized_doc_ids)
        selected_documents = [doc for doc in documents if str(doc.get("_id") or "") in allowed_doc_ids]

        return self._build_from_document_records(
            selected_documents,
            use_llm=use_llm,
            skip_built=skip_built,
            force_rebuild=force_rebuild,
        )

    def _build_from_document_records(
        self,
        documents: List[Dict[str, Any]],
        use_llm: bool = True,
        skip_built: bool = False,
        force_rebuild: bool = False,
    ) -> Dict[str, Any]:
        """Shared batch-build loop for a prepared document record list."""

        results = {
            "total": len(documents),
            "success": 0,
            "failed": 0,
            "documents": []
        }

        for doc in documents:
            doc_id = doc["_id"]
            file_name = doc.get("file_name", "")

            try:
                result = self.build_from_document(
                    doc_id,
                    use_llm=use_llm,
                    skip_if_built=skip_built,
                    force_rebuild=force_rebuild,
                )
                results["documents"].append(result)
                if result.get("status") == "success":
                    results["success"] += 1
                    logger.info(f"Successfully built graph for {file_name}")
                elif result.get("status") == "skipped":
                    # Not a failure: treated as already processed.
                    logger.info(f"Skipped graph build for {file_name}")
                else:
                    results["failed"] += 1
            except Exception as e:
                logger.error(f"Failed to build graph for {file_name}: {e}")
                results["failed"] += 1
                results["documents"].append({
                    "doc_id": doc_id,
                    "file_name": file_name,
                    "status": "failed",
                    "error": str(e)
                })

        logger.info(
            f"Batch graph build complete: {results['success']}/{results['total']} succeeded"
        )
        return results

    def create_entities(
        self,
        entities: List[Dict[str, Any]]
    ) -> List[str]:
        """
        Batch create entity nodes.

        Args:
            entities: List of entity dictionaries with type, name, and properties

        Returns:
            List of created entity IDs
        """
        entity_ids = []

        for entity in entities:
            try:
                # Check if entity already exists
                existing = self.graph_store.neo4j.find_node_by_property(
                    entity["type"],
                    "name",
                    entity["name"]
                )

                if existing:
                    entity_ids.append(existing["id"])
                else:
                    # Create new entity
                    props = entity.get("properties", {})
                    props["name"] = entity["name"]
                    entity_id = self.graph_store.neo4j.create_node(
                        entity["type"],
                        props
                    )
                    entity_ids.append(entity_id)

            except Exception as e:
                logger.error(f"Failed to create entity {entity['name']}: {e}")

        return entity_ids

    def create_relationships(
        self,
        relationships: List[Dict[str, Any]]
    ) -> int:
        """
        Batch create relationships.

        Args:
            relationships: List of relationship dictionaries

        Returns:
            Number of relationships created
        """
        created_count = 0

        for rel in relationships:
            try:
                # Find source and target nodes
                from_node = self.graph_store.neo4j.find_node_by_property(
                    rel["from_type"],
                    "name",
                    rel["from"]
                )
                to_node = self.graph_store.neo4j.find_node_by_property(
                    rel["to_type"],
                    "name",
                    rel["to"]
                )

                if from_node and to_node:
                    self.graph_store.neo4j.create_relationship(
                        from_node["id"],
                        to_node["id"],
                        rel["type"],
                        rel.get("properties", {})
                    )
                    created_count += 1

            except Exception as e:
                logger.error(f"Failed to create relationship: {e}")

        return created_count

    def get_graph_statistics(self) -> Dict[str, Any]:
        """
        Get statistics about the knowledge graph.

        Returns:
            Dictionary with graph statistics
        """
        stats = self.graph_store.neo4j.get_statistics()

        # Get counts by entity type
        entity_counts = {}
        for label in stats.get("labels", []):
            try:
                _validate_label(label)
            except ValueError:
                logger.warning(f"Skipping invalid label in statistics: {label!r}")
                continue
            cypher = f"MATCH (n:{label}) RETURN count(n) as count"
            result = self.graph_store.neo4j.query(cypher)
            if result:
                entity_counts[label] = result[0]["count"]

        return {
            "total_nodes": stats.get("node_count", 0),
            "total_relationships": stats.get("relationship_count", 0),
            "entity_types": stats.get("labels", []),
            "entity_counts": entity_counts,
            "doc_count": stats.get("doc_count", 0),
        }
