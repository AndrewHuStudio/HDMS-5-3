"""
Neo4j graph database client for HDMS.
"""

from neo4j import GraphDatabase, Driver
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class Neo4jClient:
    """Client for interacting with Neo4j graph database."""

    def __init__(self, uri: str, user: str, password: str):
        """
        Initialize Neo4j client.

        Args:
            uri: Neo4j connection URI (bolt://...)
            user: Username
            password: Password
        """
        self.uri = uri
        self.user = user
        self.password = password
        self.driver: Optional[Driver] = None

    def connect(self) -> None:
        """Establish connection to Neo4j server."""
        try:
            self.driver = GraphDatabase.driver(
                self.uri,
                auth=(self.user, self.password)
            )
            # Test connection
            with self.driver.session() as session:
                session.run("RETURN 1")
            logger.info(f"Connected to Neo4j at {self.uri}")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            raise

    def disconnect(self) -> None:
        """Disconnect from Neo4j server."""
        if self.driver:
            self.driver.close()
            self.driver = None
            logger.info("Disconnected from Neo4j")

    def create_node(
        self,
        label: str,
        properties: Dict[str, Any]
    ) -> str:
        """
        Create a node in the graph.

        Args:
            label: Node label (e.g., "Plot", "Indicator")
            properties: Node properties

        Returns:
            Node element ID
        """
        with self.driver.session() as session:
            result = session.run(
                f"CREATE (n:{label} $props) RETURN elementId(n) as id",
                props=properties
            )
            node_id = result.single()["id"]
            logger.info(f"Created {label} node: {node_id}")
            return node_id

    def create_relationship(
        self,
        from_id: str,
        to_id: str,
        rel_type: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Create a relationship between two nodes.

        Args:
            from_id: Source node element ID
            to_id: Target node element ID
            rel_type: Relationship type (e.g., "HAS_INDICATOR")
            properties: Optional relationship properties
        """
        with self.driver.session() as session:
            query = f"""
            MATCH (a), (b)
            WHERE elementId(a) = $from_id AND elementId(b) = $to_id
            CREATE (a)-[r:{rel_type}]->(b)
            """
            if properties:
                query += " SET r = $props"

            session.run(
                query,
                from_id=from_id,
                to_id=to_id,
                props=properties or {}
            )
            logger.info(f"Created {rel_type} relationship: {from_id} -> {to_id}")

    def find_node_by_property(
        self,
        label: str,
        property_name: str,
        property_value: Any
    ) -> Optional[Dict[str, Any]]:
        """
        Find a node by property value.

        Args:
            label: Node label
            property_name: Property name to search
            property_value: Property value to match

        Returns:
            Node data if found, None otherwise
        """
        with self.driver.session() as session:
            result = session.run(
                f"MATCH (n:{label} {{{property_name}: $value}}) "
                f"RETURN elementId(n) as id, properties(n) as props LIMIT 1",
                value=property_value
            )
            record = result.single()
            if record:
                return {
                    "id": record["id"],
                    "properties": dict(record["props"])
                }
            return None

    def query(
        self,
        cypher: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute a Cypher query.

        Args:
            cypher: Cypher query string
            parameters: Query parameters

        Returns:
            List of result records as dictionaries
        """
        with self.driver.session() as session:
            result = session.run(cypher, parameters or {})
            return [record.data() for record in result]

    def get_document_doc_ids(self) -> List[str]:
        """
        Get doc_id values from Document nodes.

        Returns:
            List of non-empty doc_id values
        """
        rows = self.query(
            "MATCH (d:Document) WHERE d.doc_id IS NOT NULL RETURN d.doc_id as doc_id"
        )
        doc_ids: List[str] = []
        for row in rows:
            doc_id = str(row.get("doc_id") or "").strip()
            if doc_id:
                doc_ids.append(doc_id)
        return doc_ids

    def delete_document_subgraph(self, doc_id: str, prune_orphan_entities: bool = True) -> Dict[str, int]:
        """
        Delete a document node and optionally orphan entities attached to it.

        Args:
            doc_id: Document ID stored on :Document node
            prune_orphan_entities: Delete entities no longer referenced by any document

        Returns:
            Dictionary containing delete counters
        """
        if not doc_id:
            return {"deleted_document_nodes": 0, "pruned_entities": 0}

        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (d:Document {doc_id: $doc_id})
                OPTIONAL MATCH (d)-[:CONTAINS]->(e)
                WITH collect(DISTINCT d) as docs, collect(DISTINCT e) as entities
                FOREACH (doc IN docs | DETACH DELETE doc)
                RETURN size(docs) as deleted_documents,
                       [entity IN entities WHERE entity IS NOT NULL | elementId(entity)] as entity_ids
                """,
                doc_id=doc_id,
            )
            record = result.single()
            deleted_documents = int((record or {}).get("deleted_documents") or 0)
            entity_ids = (record or {}).get("entity_ids") or []

            pruned_entities = 0
            if prune_orphan_entities and entity_ids:
                prune_result = session.run(
                    """
                    UNWIND $entity_ids as entity_id
                    MATCH (entity)
                    WHERE elementId(entity) = entity_id
                    OPTIONAL MATCH (entity)<-[:CONTAINS]-(:Document)
                    WITH entity, count(*) as refs
                    WHERE refs = 0
                    DETACH DELETE entity
                    RETURN count(entity) as pruned
                    """,
                    entity_ids=entity_ids,
                )
                prune_record = prune_result.single()
                pruned_entities = int((prune_record or {}).get("pruned") or 0)

        return {
            "deleted_document_nodes": deleted_documents,
            "pruned_entities": pruned_entities,
        }

    def get_node_with_relationships(
        self,
        node_id: str,
        max_depth: int = 1
    ) -> Dict[str, Any]:
        """
        Get a node and its relationships up to a certain depth.

        Args:
            node_id: Node element ID
            max_depth: Maximum relationship depth

        Returns:
            Dictionary with node and relationships
        """
        with self.driver.session() as session:
            query = f"""
            MATCH (n)
            WHERE elementId(n) = $node_id
            OPTIONAL MATCH path = (n)-[r*1..{max_depth}]-(m)
            RETURN n, collect(distinct r) as relationships, collect(distinct m) as related_nodes
            """
            result = session.run(query, node_id=node_id)
            record = result.single()

            if not record:
                return {}

            return {
                "node": dict(record["n"]),
                "relationships": [dict(r) for r in record["relationships"] if r],
                "related_nodes": [dict(m) for m in record["related_nodes"] if m]
            }

    def delete_all(self) -> None:
        """Delete all nodes and relationships (use with caution!)."""
        with self.driver.session() as session:
            session.run("MATCH (n) DETACH DELETE n")
            logger.warning("Deleted all nodes and relationships from Neo4j")

    def create_constraint(self, label: str, property_name: str) -> None:
        """
        Create a uniqueness constraint on a property.

        Args:
            label: Node label
            property_name: Property name
        """
        with self.driver.session() as session:
            constraint_name = f"{label}_{property_name}_unique"
            query = f"""
            CREATE CONSTRAINT {constraint_name} IF NOT EXISTS
            FOR (n:{label}) REQUIRE n.{property_name} IS UNIQUE
            """
            session.run(query)
            logger.info(f"Created constraint on {label}.{property_name}")

    def get_statistics(self) -> Dict[str, Any]:
        """
        Get database statistics.

        Returns:
            Dictionary with node and relationship counts
        """
        with self.driver.session() as session:
            # Count nodes
            node_result = session.run("MATCH (n) RETURN count(n) as count")
            node_count = node_result.single()["count"]

            # Count relationships
            rel_result = session.run("MATCH ()-[r]->() RETURN count(r) as count")
            rel_count = rel_result.single()["count"]

            # Get node labels
            labels_result = session.run("CALL db.labels()")
            labels = [record["label"] for record in labels_result]

            return {
                "node_count": node_count,
                "relationship_count": rel_count,
                "labels": labels
            }
