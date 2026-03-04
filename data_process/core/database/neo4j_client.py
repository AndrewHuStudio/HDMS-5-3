"""
Neo4j graph database client for HDMS.
"""

from neo4j import GraphDatabase, Driver
from typing import List, Dict, Any, Optional
import logging
import re

logger = logging.getLogger(__name__)

# Regex to validate Neo4j labels: allow Chinese characters, ASCII letters, digits, underscores
_SAFE_LABEL_RE = re.compile(r'^[\w\u4e00-\u9fff]+$')


def _validate_label(label: str) -> None:
    """Raise ValueError if label contains unsafe characters for Cypher interpolation."""
    if not label or not _SAFE_LABEL_RE.match(label):
        raise ValueError(f"Invalid Neo4j label: {label!r}")


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
            label: Node label (e.g., "地块", "片区", "标准")
            properties: Node properties

        Returns:
            Node element ID
        """
        _validate_label(label)
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
        Create or merge a relationship between two nodes.

        Uses MERGE to avoid duplicate edges between the same pair of nodes
        for the same relationship type. Properties are merged additively.

        Args:
            from_id: Source node element ID
            to_id: Target node element ID
            rel_type: Relationship type (e.g., "PART_OF", "APPLIES_TO")
            properties: Optional relationship properties
        """
        with self.driver.session() as session:
            query = f"""
            MATCH (a), (b)
            WHERE elementId(a) = $from_id AND elementId(b) = $to_id
            MERGE (a)-[r:{rel_type}]->(b)
            """
            if properties:
                query += " SET r += $props"

            session.run(
                query,
                from_id=from_id,
                to_id=to_id,
                props=properties or {}
            )
            logger.debug(f"Merged {rel_type} relationship: {from_id} -> {to_id}")

    def batch_merge_relationships(
        self,
        rel_type: str,
        rels: List[Dict[str, Any]],
    ) -> int:
        """
        Batch-merge relationships of the same type in a single transaction.

        Each item in *rels* must contain keys ``from_id``, ``to_id``, and
        optionally ``properties``.

        Returns the number of relationships merged.
        """
        if not rels:
            return 0
        with self.driver.session() as session:
            query = f"""
            UNWIND $rows AS row
            MATCH (a), (b)
            WHERE elementId(a) = row.from_id AND elementId(b) = row.to_id
            MERGE (a)-[r:{rel_type}]->(b)
            SET r += row.props
            RETURN count(r) AS cnt
            """
            rows = [
                {
                    "from_id": r["from_id"],
                    "to_id": r["to_id"],
                    "props": r.get("properties") or {},
                }
                for r in rels
            ]
            result = session.run(query, rows=rows)
            cnt = result.single()["cnt"]
            logger.debug(f"Batch-merged {cnt} {rel_type} relationships")
            return cnt

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
        _validate_label(label)
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

    # ------------------------------------------------------------------
    # Document tracking helpers (for resumable KG builds)
    # ------------------------------------------------------------------

    def merge_document(
        self,
        doc_id: str,
        file_name: str = "",
        file_path: str = "",
        kg_status: str = "in_progress",
        extra_props: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Create/update a :Document node used to track KG build progress.

        Returns the elementId of the Document node.
        """
        if not doc_id:
            raise ValueError("doc_id is required")
        with self.driver.session() as session:
            result = session.run(
                """
                MERGE (d:Document {doc_id: $doc_id})
                SET d.file_name = $file_name,
                    d.file_path = $file_path,
                    d.kg_status = $kg_status,
                    d.kg_updated_at = datetime()
                FOREACH (_ IN CASE WHEN $kg_status = 'success' THEN [1] ELSE [] END |
                  SET d.kg_completed_at = datetime()
                )
                FOREACH (_ IN CASE WHEN $kg_status = 'failed' THEN [1] ELSE [] END |
                  SET d.kg_failed_at = datetime()
                )
                SET d += $extra
                RETURN elementId(d) as id
                """,
                doc_id=doc_id,
                file_name=file_name or "",
                file_path=file_path or "",
                kg_status=kg_status or "in_progress",
                extra=extra_props or {},
            )
            return result.single()["id"]

    def get_document_status(self, doc_id: str) -> Optional[str]:
        """Return kg_status for a :Document node, or None if not found."""
        if not doc_id:
            return None
        rows = self.query(
            "MATCH (d:Document {doc_id: $doc_id}) RETURN d.kg_status as status LIMIT 1",
            {"doc_id": doc_id},
        )
        if not rows:
            return None
        status = rows[0].get("status")
        return str(status) if status is not None else None

    def is_document_built(self, doc_id: str) -> bool:
        """True if the document is marked as successfully built."""
        return self.get_document_status(doc_id) == "success"

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

    def list_document_statuses(self) -> List[Dict[str, Any]]:
        """Return kg build status for all :Document nodes."""
        rows = self.query(
            "MATCH (d:Document) WHERE d.doc_id IS NOT NULL "
            "RETURN d.doc_id as doc_id, d.file_name as file_name, "
            "d.kg_status as kg_status, "
            "d.kg_entities_count as entities_count, "
            "d.kg_relationships_count as relationships_count, "
            "d.kg_phase as phase, "
            "d.kg_progress as progress, "
            "d.kg_processed_chunks as processed_chunks, "
            "d.kg_total_chunks as total_chunks, "
            "d.kg_error as error "
            "ORDER BY d.kg_updated_at DESC"
        )
        results: List[Dict[str, Any]] = []
        for row in rows:
            doc_id = str(row.get("doc_id") or "").strip()
            if not doc_id:
                continue
            results.append({
                "doc_id": doc_id,
                "file_name": str(row.get("file_name") or ""),
                "kg_status": str(row.get("kg_status") or "unknown"),
                "entities_count": row.get("entities_count") or 0,
                "relationships_count": row.get("relationships_count") or 0,
                "phase": str(row.get("phase") or ""),
                "progress": row.get("progress") if row.get("progress") is not None else None,
                "processed_chunks": row.get("processed_chunks") if row.get("processed_chunks") is not None else None,
                "total_chunks": row.get("total_chunks") if row.get("total_chunks") is not None else None,
                "error": row.get("error"),
            })
        return results

    def get_source_doc_names(self) -> List[str]:
        """
        Get distinct source_doc values from all nodes.

        Returns:
            List of distinct non-empty source_doc file names
        """
        rows = self.query(
            "MATCH (n) WHERE n.source_doc IS NOT NULL "
            "RETURN DISTINCT n.source_doc as name"
        )
        names: List[str] = []
        for row in rows:
            name = str(row.get("name") or "").strip()
            if name:
                names.append(name)
        return names

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
                OPTIONAL MATCH (d)-[:CONTAINS]->(e_out)
                OPTIONAL MATCH (d)<-[:DERIVED_FROM]-(e_in)
                WITH collect(DISTINCT d) as docs,
                     collect(DISTINCT e_out) + collect(DISTINCT e_in) as entities
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
                    OPTIONAL MATCH (entity)-[:DERIVED_FROM]->(doc:Document)
                    OPTIONAL MATCH (entity)<-[:CONTAINS]-(doc2:Document)
                    WITH entity, count(doc) + count(doc2) as refs
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
        _validate_label(label)
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

            # Count distinct source documents
            doc_result = session.run(
                "MATCH (n) WHERE n.source_doc IS NOT NULL "
                "RETURN count(DISTINCT n.source_doc) as count"
            )
            doc_count = doc_result.single()["count"]

            return {
                "node_count": node_count,
                "relationship_count": rel_count,
                "labels": labels,
                "doc_count": doc_count,
            }

    # ------------------------------------------------------------------
    # Visualization helpers
    # ------------------------------------------------------------------

    def get_visual_subgraph(
        self,
        limit: int = 200,
        include_documents: bool = True,
        max_relationships: int = 5000,
    ) -> Dict[str, Any]:
        """
        Return a subgraph suitable for frontend visualization.

        We pick the top-*limit* nodes by degree (number of incident relationships),
        then return only relationships where both endpoints are within that set.
        """
        if limit <= 0:
            return {"nodes": [], "edges": []}

        # Basic safety clamp to prevent accidental "load everything".
        limit = max(1, min(int(limit), 20000))
        max_relationships = max(0, min(int(max_relationships), 200000))

        with self.driver.session() as session:
            cypher = """
            MATCH (n)
            WHERE ($include_documents OR NOT n:Document)
            WITH n, COUNT { (n)--() } AS deg
            ORDER BY deg DESC
            LIMIT $limit
            WITH collect(n) AS ns
            UNWIND ns AS a
            OPTIONAL MATCH (a)-[r]-(b)
            WHERE b IN ns
            WITH ns, collect(DISTINCT r) AS rs
            RETURN ns AS nodes, rs[0..$max_relationships] AS rels
            """
            record = session.run(
                cypher,
                include_documents=bool(include_documents),
                limit=limit,
                max_relationships=max_relationships,
            ).single()

            if not record:
                return {"nodes": [], "edges": []}

            nodes = record.get("nodes") or []
            rels = record.get("rels") or []

            def _to_jsonable(value: Any) -> Any:
                # Neo4j can return temporal/spatial types that FastAPI can't JSON encode.
                if value is None or isinstance(value, (str, int, float, bool)):
                    return value
                if isinstance(value, dict):
                    return {str(k): _to_jsonable(v) for k, v in value.items()}
                if isinstance(value, (list, tuple, set)):
                    return [_to_jsonable(v) for v in value]
                # Fall back to string representation for Neo4j-specific types (DateTime, etc.).
                return str(value)

            def _pick_label(labels: Any) -> str:
                # Neo4j Node.labels is a set-like collection.
                try:
                    lbs = list(labels or [])
                except Exception:
                    lbs = []
                if "Document" in lbs:
                    return "Document"
                return sorted(lbs)[0] if lbs else "Unknown"

            nodes_out: List[Dict[str, Any]] = []
            node_ids: set[str] = set()
            for n in nodes:
                nid = n.element_id
                node_ids.add(nid)
                props = _to_jsonable(dict(n))
                label = _pick_label(getattr(n, "labels", None))
                # Use a friendly display name for Document nodes.
                name = (
                    props.get("name")
                    or props.get("file_name")
                    or props.get("doc_id")
                    or "?"
                )
                nodes_out.append(
                    {
                        "id": nid,
                        "label": label,
                        "name": str(name),
                        "properties": props,
                    }
                )

            edges_out: List[Dict[str, Any]] = []
            for r in rels:
                try:
                    src = r.start_node.element_id
                    tgt = r.end_node.element_id
                except Exception:
                    # Shouldn't happen, but keep endpoint stable.
                    continue
                if src not in node_ids or tgt not in node_ids:
                    continue
                edges_out.append(
                    {
                        "id": r.element_id,
                        "type": r.type,
                        "source": src,
                        "target": tgt,
                        "properties": _to_jsonable(dict(r)),
                    }
                )

            return {"nodes": nodes_out, "edges": edges_out}
