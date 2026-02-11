"""
Lightweight graph query service for RAG retrieval (read-only).

Enhanced with concept search, subgraph extraction, and indicator network queries
to support dynamic knowledge graph visualization in the QA frontend.
"""

from typing import List, Dict, Any, Optional
import logging

from core.database.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)


class GraphQueryService:
    """Read-only service for querying the knowledge graph."""

    def __init__(self, neo4j_client: Neo4jClient):
        self.neo4j = neo4j_client

    def query_graph(
        self,
        cypher: str,
        parameters: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """Execute a Cypher query on the graph."""
        return self.neo4j.query(cypher, parameters)

    def get_plot_info(self, plot_name: str) -> Dict[str, Any]:
        """Get comprehensive information about a plot."""
        cypher = """
        MATCH (p:Plot {name: $plot_name})
        OPTIONAL MATCH (p)-[r:HAS_INDICATOR]->(i:Indicator)
        OPTIONAL MATCH (p)-[:HAS_FUNCTION]->(f:Function)
        OPTIONAL MATCH (p)-[:HAS_REQUIREMENT]->(req:Requirement)
        OPTIONAL MATCH (p)-[:LOCATED_IN]->(loc:Location)
        OPTIONAL MATCH (p)-[:PART_OF]->(d:District)
        RETURN p,
               collect(distinct {indicator: i.name, value: r.value}) as indicators,
               collect(distinct f.name) as functions,
               collect(distinct req.description) as requirements,
               collect(distinct loc.name) as locations,
               collect(distinct d.name) as districts
        """
        results = self.neo4j.query(cypher, {"plot_name": plot_name})
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
        Full-text search across concept nodes (Indicator, Standard,
        DesignGuideline, ResearchFinding, PerformanceDimension, SpatialElement).

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
            results = self.neo4j.query(cypher, {"query": safe_query, "limit": limit})
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
            })

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
            results = self.neo4j.query(cypher, {"seeds": seed_names[:5]})
            nodes = [
                {"id": r["id"], "label": r["label"], "name": r["name"],
                 "properties": r.get("properties", {})}
                for r in results if r.get("name")
            ]
            return {"nodes": nodes, "edges": []}
        except Exception:
            return {"nodes": [], "edges": []}

    # ------------------------------------------------------------------
    # Indicator network query
    # ------------------------------------------------------------------

    def get_indicator_network(self, indicator_name: str) -> Dict[str, Any]:
        """
        Get an indicator and all its connections for visualization.

        Returns subgraph centered on the indicator node.
        """
        cypher = """
        MATCH (i:Indicator {name: $name})
        OPTIONAL MATCH (i)<-[r1:DEFINES]-(s:Standard)
        OPTIONAL MATCH (i)-[r2:CATEGORIZED_UNDER]->(pd:PerformanceDimension)
        OPTIONAL MATCH (i)<-[r3:SUPPORTS]-(rf:ResearchFinding)
        OPTIONAL MATCH (i)-[r4:HAS_THRESHOLD]->(tv:ThresholdValue)
        OPTIONAL MATCH (p:Plot)-[r5:HAS_INDICATOR]->(i)
        WITH i,
             collect(DISTINCT s) as standards,
             collect(DISTINCT pd) as dimensions,
             collect(DISTINCT rf) as findings,
             collect(DISTINCT tv) as thresholds,
             collect(DISTINCT {plot: p, rel: r5}) as plot_rels
        RETURN i,
               [s IN standards | {name: s.name, label: 'Standard'}] as standards,
               [pd IN dimensions | {name: pd.name, label: 'PerformanceDimension'}] as dimensions,
               [rf IN findings | {name: rf.name, label: 'ResearchFinding'}] as findings,
               [tv IN thresholds | {name: tv.name, label: 'ThresholdValue'}] as thresholds,
               [pr IN plot_rels[..5] | {name: pr.plot.name, value: pr.rel.value}] as plot_values
        """
        try:
            results = self.neo4j.query(cypher, {"name": indicator_name})
            if results:
                return results[0]
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
