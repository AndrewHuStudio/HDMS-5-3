"""
Lightweight graph query service for RAG retrieval (read-only).

Enhanced with concept search, subgraph extraction, and indicator network queries
to support dynamic knowledge graph visualization in the QA frontend.
"""

from typing import List, Dict, Any, Optional
import logging

from core import config as app_config
from core.database.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)


class GraphQueryService:
    """Read-only service for querying the knowledge graph."""

    def __init__(self, neo4j_client: Neo4jClient):
        self.neo4j = neo4j_client
        self.query_timeout_seconds = float(
            getattr(app_config, "QA_NEO4J_QUERY_TIMEOUT_SECONDS", 8.0)
        )

    def query_graph(
        self,
        cypher: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Execute a Cypher query on the graph."""
        return self.neo4j.query(
            cypher,
            parameters,
            timeout_seconds=self.query_timeout_seconds,
        )

    def get_plot_info(self, plot_name: str) -> Dict[str, Any]:
        """Get comprehensive information about a plot (new schema: Chinese labels, properties on node)."""
        cypher = """
        MATCH (p:地块 {name: $plot_name})
        OPTIONAL MATCH (p)-[:PART_OF]->(d:片区)
        OPTIONAL MATCH (p)-[:LOCATED_IN]->(loc)
        OPTIONAL MATCH (rule)-[:APPLIES_TO]->(p)
        RETURN p,
               properties(p) as properties,
               collect(distinct d.name) as districts,
               collect(distinct loc.name) as locations,
               collect(distinct {name: rule.name, label: labels(rule)[0]}) as rules
        """
        results = self.query_graph(cypher, {"plot_name": plot_name})
        if results:
            return results[0]
        return {}

    # ------------------------------------------------------------------
    # Concept search via full-text index
    # ------------------------------------------------------------------

    def search_concepts(
        self, query_text: str, limit: int = 8
    ) -> List[Dict[str, Any]]:
        """
        Full-text search across all 6 entity types
        (片区, 地块, 空间要素, 法规, 标准, 导则).

        Returns list of matched nodes with scores.
        """
        # Escape special Lucene characters for safety
        safe_query = self._escape_lucene(query_text)
        if not safe_query.strip():
            return []

        cypher = """
        CALL db.index.fulltext.queryNodes('concept_search', $query)
        YIELD node, score
        RETURN elementId(node) as id,
               labels(node)[0] as label,
               node.name as name,
               properties(node) as properties,
               score
        ORDER BY score DESC
        LIMIT $limit
        """
        try:
            results = self.query_graph(cypher, {"query": safe_query, "limit": limit})
            logger.info(f"Concept search for '{query_text[:30]}' returned {len(results)} results")
            return results
        except Exception as e:
            logger.warning(f"Concept search failed (index may not exist): {e}")
            return []

    # ------------------------------------------------------------------
    # Subgraph extraction for visualization
    # ------------------------------------------------------------------

    def get_subgraph(
        self,
        seed_names: List[str],
        max_depth: int = 2,
        max_nodes: int = 30
    ) -> Dict[str, Any]:
        """
        Extract a subgraph around seed entities for frontend visualization.

        Finds nodes matching seed_names, then traverses up to max_depth hops
        to collect related nodes and edges.

        Returns: {"nodes": [...], "edges": [...]}
        """
        if not seed_names:
            return {"nodes": [], "edges": []}

        # Use a variable-length path query (no APOC dependency)
        cypher = """
        UNWIND $seeds AS seed_name
        MATCH (seed) WHERE seed.name = seed_name
        WITH collect(DISTINCT seed) AS seeds
        UNWIND seeds AS s
        OPTIONAL MATCH path = (s)-[*1..2]-(related)
        WHERE related IS NOT NULL
        WITH seeds,
             collect(DISTINCT related) AS related_nodes,
             collect(DISTINCT path) AS paths
        WITH seeds + related_nodes AS all_nodes, paths
        UNWIND all_nodes AS n
        WITH collect(DISTINCT n) AS unique_nodes, paths
        UNWIND unique_nodes[..$max_nodes] AS n
        WITH collect(DISTINCT n) AS limited_nodes, paths
        UNWIND paths AS p
        UNWIND relationships(p) AS r
        WITH limited_nodes, collect(DISTINCT r) AS all_rels
        // Filter edges to only include those between limited_nodes
        UNWIND all_rels AS r
        WITH limited_nodes, r
        WHERE startNode(r) IN limited_nodes AND endNode(r) IN limited_nodes
        WITH limited_nodes, collect(DISTINCT r) AS filtered_rels
        RETURN
          [n IN limited_nodes | {
            id: elementId(n),
            label: labels(n)[0],
            name: n.name,
            properties: properties(n)
          }] AS nodes,
          [r IN filtered_rels | {
            id: elementId(r),
            type: type(r),
            source: elementId(startNode(r)),
            target: elementId(endNode(r)),
            properties: properties(r)
          }] AS edges
        """

        try:
            results = self.neo4j.query(cypher, {
                "seeds": seed_names[:5],
                "max_nodes": max_nodes,
            }, timeout_seconds=max(self.query_timeout_seconds, 10.0))

            if results and results[0]:
                nodes = results[0].get("nodes", [])
                edges = results[0].get("edges", [])
                # Remove None entries and clean up
                nodes = [n for n in nodes if n and n.get("name")]
                edges = [e for e in edges if e and e.get("source") and e.get("target")]
                logger.info(
                    f"Subgraph for seeds {seed_names[:3]}: "
                    f"{len(nodes)} nodes, {len(edges)} edges"
                )
                return {"nodes": nodes, "edges": edges}

        except Exception as e:
            logger.warning(f"Subgraph extraction failed: {e}")
            # Fallback: return just the seed nodes without relationships
            return self._fallback_seed_nodes(seed_names)

        return {"nodes": [], "edges": []}

    def _fallback_seed_nodes(self, seed_names: List[str]) -> Dict[str, Any]:
        """Fallback: fetch seed nodes only when subgraph query fails."""
        cypher = """
        UNWIND $seeds AS seed_name
        MATCH (n) WHERE n.name = seed_name
        RETURN elementId(n) as id, labels(n)[0] as label,
               n.name as name, properties(n) as properties
        LIMIT 10
        """
        try:
            results = self.query_graph(cypher, {"seeds": seed_names[:5]})
            nodes = [
                {"id": r["id"], "label": r["label"], "name": r["name"],
                 "properties": r.get("properties", {})}
                for r in results if r.get("name")
            ]
            return {"nodes": nodes, "edges": []}
        except Exception:
            return {"nodes": [], "edges": []}

    # ------------------------------------------------------------------
    # Indicator query (new schema: indicators are plot properties)
    # ------------------------------------------------------------------

    def get_indicator_network(self, indicator_name: str) -> Dict[str, Any]:
        """
        Query plots that have a specific indicator property and their
        related regulations/standards/guidelines.

        indicator_name should be the property key on 地块 nodes, e.g.
        "far", "height_limit", "setback", "building_density", "green_ratio".

        Returns dict with plots list and related rules.
        """
        # Map Chinese indicator keywords to property keys
        keyword_to_prop = {
            "容积率": "far",
            "建筑限高": "height_limit",
            "限高": "height_limit",
            "退线": "setback",
            "退线距离": "setback",
            "建筑密度": "building_density",
            "绿地率": "green_ratio",
            "停车位": "parking_spaces",
        }
        prop_key = keyword_to_prop.get(indicator_name, indicator_name)

        cypher = """
        MATCH (p:地块)
        WHERE p[$prop_key] IS NOT NULL
        OPTIONAL MATCH (p)-[:PART_OF]->(d:片区)
        OPTIONAL MATCH (rule)-[:APPLIES_TO]->(p)
        RETURN p.name as plot_name,
               p[$prop_key] as value,
               collect(distinct d.name) as districts,
               collect(distinct {name: rule.name, label: labels(rule)[0]}) as rules
        ORDER BY p.name
        LIMIT 20
        """
        try:
            results = self.query_graph(cypher, {"prop_key": prop_key})
            return {
                "indicator": indicator_name,
                "property_key": prop_key,
                "plots": results or [],
            }
        except Exception as e:
            logger.warning(f"Indicator network query failed: {e}")
        return {}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _escape_lucene(text: str) -> str:
        """Escape special Lucene query characters."""
        special = r'+-&|!(){}[]^"~*?:\/'
        escaped = []
        for ch in text:
            if ch in special:
                escaped.append(f"\\{ch}")
            else:
                escaped.append(ch)
        return "".join(escaped)
