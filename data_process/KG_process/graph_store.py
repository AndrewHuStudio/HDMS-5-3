"""
Graph store service for entity extraction and knowledge graph operations.

Enhanced with topic-aware extraction, table parsing, and two-pass
(document-level + chunk-level) extraction flow.
"""

import json
import urllib.request
import re
from typing import List, Dict, Any, Optional
import logging
import os

from ..core.database.neo4j_client import Neo4jClient
from .extraction_prompts import (
    get_extraction_prompt,
    get_document_context_prompt,
    classify_topic_from_path,
    TOPIC_CONFIG,
)

logger = logging.getLogger(__name__)

# Valid entity types for the expanded schema
VALID_ENTITY_TYPES = {
    "Topic", "Standard", "PerformanceDimension", "Indicator",
    "ThresholdValue", "EvaluationMethod", "DesignGuideline",
    "SpatialElement", "ResearchFinding", "Plot", "District",
    "Function", "Requirement", "Location", "Document",
}

# Valid relationship types
VALID_RELATIONSHIP_TYPES = {
    "DEFINES", "EVALUATES", "HAS_THRESHOLD", "CATEGORIZED_UNDER",
    "MEASURED_BY", "PRESCRIBES", "APPLIES_TO", "SUPPORTS",
    "DERIVED_FROM", "INFLUENCES", "HAS_INDICATOR", "HAS_FUNCTION",
    "HAS_REQUIREMENT", "LOCATED_IN", "PART_OF", "ADJACENT_TO",
    "BELONGS_TO", "CONTAINS",
}


class GraphStoreService:
    """Service for extracting entities and building knowledge graph."""

    def __init__(
        self,
        neo4j_client: Neo4jClient,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str
    ):
        self.neo4j = neo4j_client
        self.llm_base_url = llm_base_url.rstrip("/")
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model

    # ------------------------------------------------------------------
    # LLM call helper
    # ------------------------------------------------------------------

    def _call_llm(self, prompt: str, max_tokens: int = 3000) -> str:
        """Call LLM API and return the response content string."""
        endpoint = f"{self.llm_base_url}/chat/completions"
        payload = {
            "model": self.llm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.llm_api_key}",
        }

        req = urllib.request.Request(
            endpoint, data=data, headers=headers, method="POST"
        )

        with urllib.request.urlopen(req, timeout=90) as response:
            body = response.read().decode("utf-8")
            result = json.loads(body)

        return result["choices"][0]["message"]["content"]

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Extract JSON object from LLM response text."""
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                logger.warning("Failed to parse JSON from LLM response")
        return {}

    # ------------------------------------------------------------------
    # Topic classification
    # ------------------------------------------------------------------

    def _classify_topic(
        self,
        chunks: List[Dict[str, Any]],
        doc_id: str,
        file_name: str = ""
    ) -> str:
        """
        Classify which topic a document belongs to.

        Tries file path first, then falls back to content-based hints.
        """
        # Try path-based classification
        for source in [file_name, doc_id]:
            if source:
                topic = classify_topic_from_path(source)
                if topic != "课题5":  # non-default match
                    return topic
                if "课题5" in source:
                    return "课题5"

        # Content-based hints from first chunk
        if chunks:
            first_text = chunks[0].get("text", "")[:500]
            topic_hints = {
                "课题1": ["界定", "分类标准", "评估与优化指标标准", "征求意见稿"],
                "课题2": ["热舒适", "辐射温度", "深度学习", "UTCI", "热环境"],
                "课题3": ["设计导则", "空间形态", "功能混合", "全时利用", "近地空间"],
                "课题4": ["安全感", "归属感", "人本性能", "眼动", "EEG", "情绪健康"],
                "课题5": ["DU0", "地块开发", "实施手册", "超级总部", "后海"],
            }
            for topic_key, hints in topic_hints.items():
                if any(h in first_text for h in hints):
                    return topic_key

        return "课题5"

    # ------------------------------------------------------------------
    # Document-level context extraction (first pass)
    # ------------------------------------------------------------------

    def _extract_document_context(
        self,
        first_chunks: List[Dict[str, Any]],
        topic: str
    ) -> Dict[str, Any]:
        """
        First pass: extract document-level anchor entities.

        Returns dict with doc_type, anchor_entities, main_dimensions.
        """
        combined_text = " ".join(
            c.get("text", "")[:1000] for c in first_chunks[:3]
        )
        if not combined_text.strip():
            return {"doc_type": "unknown", "anchor_entities": [], "main_dimensions": []}

        prompt = get_document_context_prompt(combined_text)

        try:
            content = self._call_llm(prompt, max_tokens=1000)
            result = self._parse_json_response(content)
            if result:
                logger.info(
                    f"Document context: type={result.get('doc_type')}, "
                    f"anchors={len(result.get('anchor_entities', []))}"
                )
                return result
        except Exception as e:
            logger.warning(f"Document context extraction failed: {e}")

        return {"doc_type": "unknown", "anchor_entities": [], "main_dimensions": []}

    # ------------------------------------------------------------------
    # Chunk-level entity extraction (second pass)
    # ------------------------------------------------------------------

    def extract_entities_and_relations(
        self,
        text: str,
        doc_id: str,
        topic: str = "课题5",
        is_table: bool = False,
        doc_context: str = ""
    ) -> Dict[str, Any]:
        """
        Use LLM to extract entities and relationships from text.

        Uses topic-aware prompts for better extraction quality.
        """
        prompt = get_extraction_prompt(
            topic=topic,
            text=text,
            is_table=is_table,
            doc_context=doc_context,
        )

        try:
            content = self._call_llm(prompt, max_tokens=3000)
            extracted = self._parse_json_response(content)

            if not extracted:
                extracted = {"entities": [], "relationships": []}

            # Validate and filter
            extracted = self._validate_extracted(extracted)

            entity_count = len(extracted.get("entities", []))
            rel_count = len(extracted.get("relationships", []))
            logger.info(f"Extracted {entity_count} entities and {rel_count} relationships")
            return extracted

        except Exception as e:
            logger.error(f"Failed to extract entities: {e}")
            # Fall back to regex for 课题5
            if topic == "课题5":
                return self.extract_with_regex(text)
            return {"entities": [], "relationships": []}

    def _validate_extracted(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and filter extracted entities and relationships."""
        valid_entities = []
        for entity in data.get("entities", []):
            etype = entity.get("type", "")
            ename = entity.get("name", "")
            if etype in VALID_ENTITY_TYPES and ename and len(ename) <= 100:
                valid_entities.append(entity)
            elif etype and ename:
                logger.debug(f"Filtered invalid entity: type={etype}, name={ename}")

        valid_rels = []
        for rel in data.get("relationships", []):
            rtype = rel.get("type", "")
            if rtype in VALID_RELATIONSHIP_TYPES and rel.get("from") and rel.get("to"):
                valid_rels.append(rel)
            elif rtype:
                logger.debug(f"Filtered invalid relationship: type={rtype}")

        return {"entities": valid_entities, "relationships": valid_rels}

    def extract_with_regex(self, text: str) -> Dict[str, Any]:
        """
        Use regex patterns to extract entities as fallback.

        Expanded to cover more patterns beyond just plots and basic indicators.
        """
        entities = []
        relationships = []

        # Plot IDs (DU01-01, DU02-03, etc.)
        plot_pattern = r'DU\d{2}-\d{2}(?:-\d+)?'
        plots = set(re.findall(plot_pattern, text))
        for plot in plots:
            entities.append({"type": "Plot", "name": plot, "properties": {}})

        # Indicator values with numeric extraction
        indicators = {
            "容积率": r'容积率[：:\s]*[≤<=]*\s*([\d.]+)',
            "建筑限高": r'(?:建筑)?限高[：:\s]*[≤<=]*\s*([\d.]+)\s*[米m]?',
            "建筑密度": r'建筑密度[：:\s]*[≤<=]*\s*([\d.]+)\s*%?',
            "绿地率": r'绿地率[：:\s]*[≥>=]*\s*([\d.]+)\s*%?',
            "退线距离": r'退线[：:\s]*[≥>=]*\s*([\d.]+)\s*[米m]?',
            "停车位": r'停车[位泊][：:\s]*[≥>=]*\s*(\d+)',
        }

        for indicator_name, pattern in indicators.items():
            matches = re.findall(pattern, text)
            if matches:
                entities.append({"type": "Indicator", "name": indicator_name, "properties": {}})
                for plot in plots:
                    for value in matches:
                        relationships.append({
                            "from": plot, "from_type": "Plot",
                            "to": indicator_name, "to_type": "Indicator",
                            "type": "HAS_INDICATOR",
                            "properties": {"value": value},
                        })

        # District names
        district_patterns = [
            r'(深圳湾超级总部基地)',
            r'(后海中心区)',
            r'(丽泽金融商务区)',
        ]
        for dp in district_patterns:
            match = re.search(dp, text)
            if match:
                district_name = match.group(1)
                entities.append({"type": "District", "name": district_name, "properties": {}})
                for plot in plots:
                    relationships.append({
                        "from": plot, "from_type": "Plot",
                        "to": district_name, "to_type": "District",
                        "type": "PART_OF", "properties": {},
                    })

        # Performance dimensions
        dimensions = ["环境性能", "安全性能", "健康性能", "人本性能", "使用效能"]
        for dim in dimensions:
            if dim in text:
                entities.append({"type": "PerformanceDimension", "name": dim, "properties": {}})

        logger.info(f"Regex extracted {len(entities)} entities and {len(relationships)} relationships")
        return {"entities": entities, "relationships": relationships}

    # ------------------------------------------------------------------
    # Main build flow (two-pass)
    # ------------------------------------------------------------------

    def build_graph_from_document(
        self,
        doc_id: str,
        chunks: List[Dict[str, Any]],
        use_llm: bool = True,
        file_name: str = "",
        file_path: str = ""
    ) -> Dict[str, Any]:
        """
        Build knowledge graph from document chunks using two-pass extraction.

        Pass 1: Document-level context extraction (anchor entities)
        Pass 2: Chunk-level entity/relationship extraction with topic-aware prompts
        """
        all_entities: Dict[str, str] = {}  # entity_key -> node_id
        all_relationships: List[Dict] = []

        # --- Step 1: Classify topic ---
        topic = self._classify_topic(chunks, doc_id, file_path or file_name)
        logger.info(f"Document {doc_id} classified as {topic}")

        # --- Step 2: Ensure Topic node exists ---
        topic_config = TOPIC_CONFIG.get(topic, {})
        topic_name = topic_config.get("name", topic)
        topic_node_id = self._ensure_node("Topic", topic_name, {"code": topic})

        # --- Step 3: Create Document node ---
        existing_doc = self.neo4j.find_node_by_property("Document", "doc_id", doc_id)
        if existing_doc:
            doc_node_id = existing_doc["id"]
        else:
            doc_node_id = self.neo4j.create_node("Document", {
                "doc_id": doc_id,
                "file_name": file_name,
                "topic": topic,
            })

        # Link Document -> Topic
        self.neo4j.create_relationship(doc_node_id, topic_node_id, "BELONGS_TO")

        # --- Step 4: First pass - document-level context ---
        doc_context_str = ""
        if use_llm and chunks:
            doc_context = self._extract_document_context(chunks[:3], topic)
            doc_context_str = json.dumps(doc_context, ensure_ascii=False)

            # Create anchor entities from document context
            for anchor in doc_context.get("anchor_entities", []):
                atype = anchor.get("type", "")
                aname = anchor.get("name", "")
                if atype in VALID_ENTITY_TYPES and aname:
                    props = anchor.get("properties", {})
                    anchor_id = self._ensure_node(atype, aname, props)
                    entity_key = f"{atype}:{aname}"
                    all_entities[entity_key] = anchor_id
                    self.neo4j.create_relationship(doc_node_id, anchor_id, "CONTAINS")

            # Create PerformanceDimension nodes from main_dimensions
            for dim_name in doc_context.get("main_dimensions", []):
                if dim_name:
                    dim_id = self._ensure_node("PerformanceDimension", dim_name)
                    entity_key = f"PerformanceDimension:{dim_name}"
                    all_entities[entity_key] = dim_id

        # --- Step 5: Second pass - chunk-level extraction ---
        for i, chunk in enumerate(chunks):
            text = chunk.get("text", "")
            if not text or len(text.strip()) < 20:
                continue

            is_table = chunk.get("has_table", False)

            if use_llm:
                extracted = self.extract_entities_and_relations(
                    text=text,
                    doc_id=doc_id,
                    topic=topic,
                    is_table=is_table,
                    doc_context=doc_context_str,
                )
            else:
                extracted = self.extract_with_regex(text)

            # Create entity nodes
            for entity in extracted.get("entities", []):
                entity_key = f"{entity['type']}:{entity['name']}"

                if entity_key not in all_entities:
                    props = entity.get("properties", {})
                    entity_id = self._ensure_node(entity["type"], entity["name"], props)
                    all_entities[entity_key] = entity_id

                    # Link to document
                    self.neo4j.create_relationship(
                        doc_node_id, entity_id, "CONTAINS"
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
                        rel.get("properties", {}),
                    )
                    all_relationships.append(rel)

            if (i + 1) % 10 == 0:
                logger.info(f"Processed {i + 1}/{len(chunks)} chunks for {doc_id}")

        logger.info(
            f"Built graph for {doc_id} ({topic}): "
            f"{len(all_entities)} entities, {len(all_relationships)} relationships"
        )

        return {
            "doc_id": doc_id,
            "file_name": file_name,
            "topic": topic,
            "entities_count": len(all_entities),
            "relationships_count": len(all_relationships),
            "status": "success",
        }

    # ------------------------------------------------------------------
    # Node helpers
    # ------------------------------------------------------------------

    def _ensure_node(
        self,
        label: str,
        name: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> str:
        """Find existing node by name or create a new one. Returns node ID."""
        existing = self.neo4j.find_node_by_property(label, "name", name)
        if existing:
            return existing["id"]

        props = dict(properties or {})
        props["name"] = name
        return self.neo4j.create_node(label, props)

    # ------------------------------------------------------------------
    # Query methods (unchanged)
    # ------------------------------------------------------------------

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


def create_graph_store_service(neo4j_client: Neo4jClient) -> GraphStoreService:
    """Create graph store service from environment variables."""
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_MODEL", "deepseek-v3")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return GraphStoreService(neo4j_client, base_url, api_key, model)
