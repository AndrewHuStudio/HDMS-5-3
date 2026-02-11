"""
Graph store service for entity extraction and knowledge graph operations.
"""

import json
import urllib.request
import re
from typing import List, Dict, Any, Optional
import logging
import os

from ..core.database.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)


class GraphStoreService:
    """Service for extracting entities and building knowledge graph."""

    def __init__(
        self,
        neo4j_client: Neo4jClient,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str
    ):
        """
        Initialize graph store service.

        Args:
            neo4j_client: Neo4j database client
            llm_base_url: LLM API base URL
            llm_api_key: LLM API key
            llm_model: LLM model name
        """
        self.neo4j = neo4j_client
        self.llm_base_url = llm_base_url.rstrip("/")
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model

    def extract_entities_and_relations(
        self,
        text: str,
        doc_id: str
    ) -> Dict[str, Any]:
        """
        Use LLM to extract entities and relationships from text.

        Args:
            text: Text to analyze
            doc_id: Document ID

        Returns:
            Dictionary with entities and relationships
        """
        prompt = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

实体类型：
- Plot: 地块编号 (如 DU01-01, DU02-03)
- Indicator: 指标名称 (如 容积率, 建筑限高, 退线距离, 建筑密度, 绿地率)
- Function: 功能类型 (如 办公, 商业, 文化, 居住)
- Requirement: 管控要求描述
- Location: 位置名称 (如 深圳湾超级总部基地)

关系类型：
- HAS_INDICATOR: 地块 -> 指标 (包含指标值作为属性)
- HAS_FUNCTION: 地块 -> 功能
- HAS_REQUIREMENT: 地块 -> 要求
- LOCATED_IN: 地块 -> 位置

请以JSON格式返回，只返回JSON，不要其他文字：
{
  "entities": [
    {"type": "Plot", "name": "DU01-01", "properties": {}},
    {"type": "Indicator", "name": "容积率", "properties": {}}
  ],
  "relationships": [
    {"from": "DU01-01", "from_type": "Plot", "to": "容积率", "to_type": "Indicator", "type": "HAS_INDICATOR", "properties": {"value": "≤23.0"}}
  ]
}

文本：
""" + text[:2000]  # 限制文本长度

        endpoint = f"{self.llm_base_url}/chat/completions"
        payload = {
            "model": self.llm_model,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1,
            "max_tokens": 2000
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.llm_api_key}"
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)

            content = result["choices"][0]["message"]["content"]

            # 提取JSON部分
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                extracted_data = json.loads(json_match.group())
            else:
                extracted_data = {"entities": [], "relationships": []}

            logger.info(f"Extracted {len(extracted_data.get('entities', []))} entities and {len(extracted_data.get('relationships', []))} relationships")
            return extracted_data

        except Exception as e:
            logger.error(f"Failed to extract entities: {e}")
            return {"entities": [], "relationships": []}

    def extract_with_regex(self, text: str) -> Dict[str, Any]:
        """
        Use regex patterns to extract entities as fallback.

        Args:
            text: Text to analyze

        Returns:
            Dictionary with entities and relationships
        """
        entities = []
        relationships = []

        # 提取地块编号 (DU01-01, DU02-03等)
        plot_pattern = r'DU\d{2}-\d{2}(?:-\d+)?'
        plots = set(re.findall(plot_pattern, text))
        for plot in plots:
            entities.append({
                "type": "Plot",
                "name": plot,
                "properties": {}
            })

        # 提取指标值
        indicators = {
            "容积率": r'容积率[：:]\s*[≤<=]?\s*([\d.]+)',
            "建筑限高": r'建筑限高[：:]\s*[≤<=]?\s*([\d.]+)\s*[米m]',
            "建筑密度": r'建筑密度[：:]\s*[≤<=]?\s*([\d.]+)%',
            "绿地率": r'绿地率[：:]\s*[≥>=]?\s*([\d.]+)%'
        }

        for indicator_name, pattern in indicators.items():
            matches = re.findall(pattern, text)
            if matches:
                entities.append({
                    "type": "Indicator",
                    "name": indicator_name,
                    "properties": {}
                })

                # 为每个地块创建关系
                for plot in plots:
                    for value in matches:
                        relationships.append({
                            "from": plot,
                            "from_type": "Plot",
                            "to": indicator_name,
                            "to_type": "Indicator",
                            "type": "HAS_INDICATOR",
                            "properties": {"value": value}
                        })

        logger.info(f"Regex extracted {len(entities)} entities and {len(relationships)} relationships")
        return {"entities": entities, "relationships": relationships}

    def build_graph_from_document(
        self,
        doc_id: str,
        chunks: List[Dict[str, Any]],
        use_llm: bool = True
    ) -> Dict[str, Any]:
        """
        Build knowledge graph from document chunks.

        Args:
            doc_id: Document ID
            chunks: List of document chunks
            use_llm: Whether to use LLM for extraction (fallback to regex if False)

        Returns:
            Dictionary with build statistics
        """
        all_entities = {}
        all_relationships = []

        # Create document node
        doc_node_id = self.neo4j.create_node(
            "Document",
            {"doc_id": doc_id}
        )

        # Process each chunk
        for chunk in chunks:
            text = chunk.get("text", "")

            if use_llm:
                extracted = self.extract_entities_and_relations(text, doc_id)
            else:
                extracted = self.extract_with_regex(text)

            # Create entity nodes
            for entity in extracted.get("entities", []):
                entity_key = f"{entity['type']}:{entity['name']}"

                if entity_key not in all_entities:
                    # Check if entity already exists
                    existing = self.neo4j.find_node_by_property(
                        entity["type"],
                        "name",
                        entity["name"]
                    )

                    if existing:
                        all_entities[entity_key] = existing["id"]
                    else:
                        # Create new entity
                        props = entity.get("properties", {})
                        props["name"] = entity["name"]
                        entity_id = self.neo4j.create_node(entity["type"], props)
                        all_entities[entity_key] = entity_id

                        # Link to document
                        self.neo4j.create_relationship(
                            doc_node_id,
                            entity_id,
                            "CONTAINS",

                        )

            # Create relationships
            for rel in extracted.get("relationships", []):
                from_key = f"{rel['from_type']}:{rel['from']}"
                to_key = f"{rel['to_type']}:{rel['to']}"

                if from_key in all_entities and to_key in all_entities:
                    self.neo4j.create_relationship(
                        all_entities[from_key],
                        all_entities[to_key],
                        rel["type"],
                        rel.get("properties", {})
                    )
                    all_relationships.append(rel)

        logger.info(f"Built graph for document {doc_id}: {len(all_entities)} entities, {len(all_relationships)} relationships")

        return {
            "doc_id": doc_id,
            "entities_count": len(all_entities),
            "relationships_count": len(all_relationships),
            "status": "success"
        }

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


def create_graph_store_service(neo4j_client: Neo4jClient) -> GraphStoreService:
    """
    Create graph store service from environment variables.

    Args:
        neo4j_client: Neo4j client instance

    Returns:
        Configured GraphStoreService instance
    """
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_MODEL", "deepseek-v3")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return GraphStoreService(neo4j_client, base_url, api_key, model)
