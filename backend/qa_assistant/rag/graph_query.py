"""
Lightweight graph query service for RAG retrieval (read-only).

Only includes query methods needed by the retriever.
Graph construction logic stays in data_process/KG_process/.
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
        """
        Execute a Cypher query on the graph.

        Args:
            cypher: Cypher query string
            parameters: Query parameters

        Returns:
            List of query results
        """
        return self.neo4j.query(cypher, parameters)

    def get_plot_info(self, plot_name: str) -> Dict[str, Any]:
        """
        Get comprehensive information about a plot.

        Args:
            plot_name: Plot name (e.g., "DU01-01")

        Returns:
            Dictionary with plot information and relationships
        """
        cypher = """
        MATCH (p:Plot {name: $plot_name})
        OPTIONAL MATCH (p)-[r:HAS_INDICATOR]->(i:Indicator)
        OPTIONAL MATCH (p)-[:HAS_FUNCTION]->(f:Function)
        OPTIONAL MATCH (p)-[:HAS_REQUIREMENT]->(req:Requirement)
        OPTIONAL MATCH (p)-[:LOCATED_IN]->(loc:Location)
        RETURN p,
               collect(distinct {indicator: i.name, value: r.value}) as indicators,
               collect(distinct f.name) as functions,
               collect(distinct req.description) as requirements,
               collect(distinct loc.name) as locations
        """

        results = self.neo4j.query(cypher, {"plot_name": plot_name})

        if results:
            return results[0]
        return {}
