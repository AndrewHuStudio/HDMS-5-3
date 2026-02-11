"""
Graph builder for constructing knowledge graph from documents.
"""

from typing import List, Dict, Any, Optional
import logging

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

    def build_from_document(
        self,
        doc_id: str,
        use_llm: bool = True,
        max_chunks: Optional[int] = None
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
            projection={"file_name": 1, "file_path": 1}
        )
        file_name = ""
        file_path = ""
        if doc_meta:
            file_name = doc_meta[0].get("file_name", "")
            file_path = doc_meta[0].get("file_path", "")

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
        )

        return result

    def build_from_all_documents(
        self,
        use_llm: bool = True,
        max_docs: Optional[int] = None
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

        # Get all document IDs
        documents = self.mongodb.find_by_query(
            "documents",
            {},
            limit=max_docs or 1000,
            projection={"_id": 1, "file_name": 1}
        )

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
                result = self.build_from_document(doc_id, use_llm=use_llm)
                results["success"] += 1
                results["documents"].append(result)
                logger.info(f"Successfully built graph for {file_name}")
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
            cypher = f"MATCH (n:{label}) RETURN count(n) as count"
            result = self.graph_store.neo4j.query(cypher)
            if result:
                entity_counts[label] = result[0]["count"]

        return {
            "total_nodes": stats.get("node_count", 0),
            "total_relationships": stats.get("relationship_count", 0),
            "entity_types": stats.get("labels", []),
            "entity_counts": entity_counts
        }
