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
    get_document_analysis_prompt,
)
from .entity_filter import create_entity_filter, create_importance_scorer

logger = logging.getLogger(__name__)

# Valid entity types (Chinese labels) - 6 types
VALID_ENTITY_TYPES = {
    # 空间层级类
    "片区", "地块", "空间要素",

    # 管控规则类
    "法规", "标准", "导则",
}

# Entity type mapping (Chinese to English for reference)
ENTITY_TYPE_MAPPING = {
    "片区": "District",
    "地块": "Plot",
    "空间要素": "SpatialElement",
    "法规": "Regulation",
    "标准": "Standard",
    "导则": "Guideline",
}

# Valid relationship types (English) - 8 types
VALID_RELATIONSHIP_TYPES = {
    # 层级关系
    "PART_OF",      # 地块属于片区
    "CONTAINS",     # 片区包含地块

    # 空间关系
    "ADJACENT_TO",  # 地块相邻
    "LOCATED_IN",   # 空间要素位于地块

    # 管控关系
    "APPLIES_TO",   # 法规/标准/导则适用于片区/地块
    "REFERENCES",   # 标准引用法规、导则引用标准

    # 来源关系
    "DERIVED_FROM", # 实体来源于文档

    # 属性关系（可选）
    "HAS_PROPERTY", # 地块有属性
}


class GraphStoreService:
    """Service for extracting entities and building knowledge graph."""

    def __init__(
        self,
        neo4j_client: Neo4jClient,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str,
        enable_entity_filtering: bool = True,
        enable_importance_scoring: bool = True,
        min_importance_score: float = 1.0,
    ):
        self.neo4j = neo4j_client
        self.llm_base_url = llm_base_url.rstrip("/")
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model

        # Entity filtering
        self.enable_entity_filtering = enable_entity_filtering
        self.enable_importance_scoring = enable_importance_scoring
        self.min_importance_score = min_importance_score

        self.entity_filter = create_entity_filter() if enable_entity_filtering else None
        self.importance_scorer = create_importance_scorer() if enable_importance_scoring else None

    # ------------------------------------------------------------------
    # LLM call helper
    # ------------------------------------------------------------------

    def _call_llm(self, prompt: str, max_tokens: int = 3000) -> str:
        """Call LLM API with retry logic and return the response content string."""
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

        max_retries = 3
        for attempt in range(max_retries):
            try:
                req = urllib.request.Request(
                    endpoint, data=data, headers=headers, method="POST"
                )
                with urllib.request.urlopen(req, timeout=90) as response:
                    body = response.read().decode("utf-8")
                    result = json.loads(body)
                return result["choices"][0]["message"]["content"]
            except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError) as e:
                wait = 2 ** attempt
                if attempt < max_retries - 1:
                    logger.warning(
                        f"LLM call attempt {attempt + 1}/{max_retries} failed: {e}, "
                        f"retrying in {wait}s..."
                    )
                    import time
                    time.sleep(wait)
                else:
                    logger.error(f"LLM call failed after {max_retries} attempts: {e}")
                    raise

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Extract and validate JSON object from LLM response text."""
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                data = json.loads(json_match.group())
                if not isinstance(data, dict):
                    logger.warning("LLM response JSON is not a dict, returning empty")
                    return {}
                # Normalize expected keys to lists
                if "entities" in data and not isinstance(data["entities"], list):
                    logger.warning("LLM 'entities' is not a list, discarding")
                    data["entities"] = []
                if "relationships" in data and not isinstance(data["relationships"], list):
                    logger.warning("LLM 'relationships' is not a list, discarding")
                    data["relationships"] = []
                return data
            except json.JSONDecodeError:
                logger.warning("Failed to parse JSON from LLM response")
        return {}

    # ------------------------------------------------------------------
    # Document-level analysis (first pass)
    # ------------------------------------------------------------------

    def _analyze_document(
        self,
        first_chunks: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        First pass: analyze document to identify type, district, project, and core concepts.

        Returns dict with document_type, district, project, anchor_entities, indicator_categories.
        """
        combined_text = " ".join(
            c.get("text", "")[:1000] for c in first_chunks[:3]
        )
        if not combined_text.strip():
            return {
                "document_type": "其他",
                "district": None,
                "project": None,
                "anchor_entities": [],
                "indicator_categories": []
            }

        prompt = get_document_analysis_prompt(combined_text)

        try:
            content = self._call_llm(prompt, max_tokens=1500)
            result = self._parse_json_response(content)
            if result:
                logger.info(
                    f"Document analysis: type={result.get('document_type')}, "
                    f"district={result.get('district')}, "
                    f"anchors={len(result.get('anchor_entities', []))}"
                )
                return result
        except Exception as e:
            logger.warning(f"Document analysis failed: {e}")

        return {
            "document_type": "其他",
            "district": None,
            "project": None,
            "anchor_entities": [],
            "indicator_categories": []
        }

    # ------------------------------------------------------------------
    # Chunk-level entity extraction (second pass)
    # ------------------------------------------------------------------

    def extract_entities_and_relations(
        self,
        text: str,
        doc_type: str = "其他",
        district: str = "未知",
        project: str = "未知",
        is_table: bool = False,
        doc_context: str = ""
    ) -> Dict[str, Any]:
        """
        Use LLM to extract entities and relationships from text.

        Uses universal extraction prompt with document context.
        """
        prompt = get_extraction_prompt(
            text=text,
            doc_type=doc_type,
            district=district,
            project=project,
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
            # Fall back to regex for plot-based documents
            if "地块" in text or "DU" in text:
                return self.extract_with_regex(text)
            return {"entities": [], "relationships": []}

    def _validate_extracted(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Validate and filter extracted entities and relationships."""
        # Step 1: Basic validation (type and name)
        valid_entities = []
        for entity in data.get("entities", []):
            etype = entity.get("type", "")
            ename = entity.get("name", "")
            if etype in VALID_ENTITY_TYPES and ename and len(ename) <= 100:
                valid_entities.append(entity)
            elif etype and ename:
                logger.debug(f"Filtered invalid entity: type={etype}, name={ename}")

        # Step 2: Apply entity filter (heuristic rules)
        if self.enable_entity_filtering and self.entity_filter:
            valid_entities = self.entity_filter.filter_entities(valid_entities)

        # Step 3: Update importance scorer frequency
        if self.enable_importance_scoring and self.importance_scorer:
            self.importance_scorer.update_frequency(valid_entities)

        # Step 4: Filter by importance score (optional, can be done later)
        # Note: We don't filter by importance here to allow frequency accumulation
        # Importance filtering is better done after all documents are processed

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

        Focuses on plot-based information extraction.
        Indicator values are stored as plot node properties (not separate entities).
        """
        entities = []
        relationships = []

        # Plot IDs (DU01-01, DU02-03, etc.)
        plot_pattern = r'DU\d{2}-\d{2}(?:-\d+)?'
        plots = set(re.findall(plot_pattern, text))

        # Indicator regex patterns -> property key mapping
        indicator_patterns = {
            "far": r'容积率[：:\s]*[≤<=]*\s*([\d.]+)',
            "height_limit": r'(?:建筑)?限高[：:\s]*[≤<=]*\s*([\d.]+)\s*[米m]?',
            "building_density": r'建筑密度[：:\s]*[≤<=]*\s*([\d.]+)\s*%?',
            "green_ratio": r'绿地率[：:\s]*[≥>=]*\s*([\d.]+)\s*%?',
            "setback": r'退线[：:\s]*[≥>=]*\s*([\d.]+)\s*[米m]?',
            "parking_spaces": r'停车[位泊][：:\s]*[≥>=]*\s*(\d+)',
        }

        # Extract indicator values and attach as plot properties
        extracted_props: Dict[str, str] = {}
        for prop_key, pattern in indicator_patterns.items():
            match = re.search(pattern, text)
            if match:
                extracted_props[prop_key] = match.group(1)

        for plot in plots:
            entities.append({
                "type": "地块",
                "name": plot,
                "properties": dict(extracted_props),
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
                entities.append({"type": "片区", "name": district_name, "properties": {}})
                for plot in plots:
                    relationships.append({
                        "from": plot, "from_type": "地块",
                        "to": district_name, "to_type": "片区",
                        "type": "PART_OF", "properties": {},
                    })

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

        Pass 1: Document-level analysis (document type, district, project, anchor entities)
        Pass 2: Chunk-level entity/relationship extraction with universal prompts
        """
        # Track progress in Neo4j so batch runs can resume after interruption.
        # This is intentionally lightweight: we don't delete on retry; the build
        # is designed to be idempotent via find/merge patterns.
        doc_node_id: Optional[str] = None
        total_chunks = max(len(chunks), 1)
        processed_chunks = 0
        progress_update_interval = 5

        def _doc_progress(phase: str, processed: int, status: str = "in_progress") -> None:
            if not doc_node_id:
                return
            clamped_processed = max(0, min(processed, total_chunks))
            progress = int(round((clamped_processed / total_chunks) * 100))
            try:
                self.neo4j.merge_document(
                    doc_id=doc_id,
                    file_name=file_name,
                    file_path=file_path,
                    kg_status=status,
                    extra_props={
                        "kg_phase": phase,
                        "kg_total_chunks": total_chunks,
                        "kg_processed_chunks": clamped_processed,
                        "kg_progress": progress,
                    },
                )
            except Exception as progress_error:
                logger.warning(f"Failed to update progress for {doc_id}: {progress_error}")

        try:
            doc_node_id = self.neo4j.merge_document(
                doc_id=doc_id,
                file_name=file_name,
                file_path=file_path,
                kg_status="in_progress",
                extra_props={
                    "kg_phase": "analyzing",
                    "kg_total_chunks": total_chunks,
                    "kg_processed_chunks": 0,
                    "kg_progress": 0,
                },
            )
        except Exception as e:
            # Don't block graph building if document tracking fails.
            logger.warning(f"Failed to create/merge Document node for {doc_id}: {e}")

        all_entities: Dict[str, str] = {}  # entity_key -> node_id
        all_relationships: List[Dict] = []

        try:

            # --- Step 1: Analyze document ---
            doc_analysis = self._analyze_document(chunks[:3]) if use_llm and chunks else {}
            doc_type = doc_analysis.get("document_type", "其他")
            district = doc_analysis.get("district")
            project = doc_analysis.get("project")

            logger.info(
                f"Document {doc_id} analyzed: type={doc_type}, "
                f"district={district}, project={project}"
            )
            _doc_progress("extracting", 0)

            # --- Step 2: Create anchor entities from document analysis ---
            doc_context_str = ""
            if use_llm and doc_analysis:
                doc_context_str = json.dumps(doc_analysis, ensure_ascii=False)

                # Create anchor entities (片区, 地块, 法规, 标准, 导则, 空间要素)
                for anchor in doc_analysis.get("anchor_entities", []):
                    atype = anchor.get("type", "")
                    aname = anchor.get("name", "")
                    if atype in VALID_ENTITY_TYPES and aname:
                        props = anchor.get("properties", {})
                        # Add source tracking
                        props["source_doc"] = file_name
                        anchor_id = self._ensure_node(atype, aname, props)
                        entity_key = f"{atype}:{aname}"
                        all_entities[entity_key] = anchor_id

            # --- Step 3: Second pass - chunk-level extraction ---
            for i, chunk in enumerate(chunks):
                processed_chunks = i + 1
                text = chunk.get("text", "")
                if not text or len(text.strip()) < 20:
                    if processed_chunks == total_chunks or processed_chunks % progress_update_interval == 0:
                        _doc_progress("extracting", processed_chunks)
                    continue

                is_table = chunk.get("has_table", False)

                if use_llm:
                    extracted = self.extract_entities_and_relations(
                        text=text,
                        doc_type=doc_type,
                        district=district or "未知",
                        project=project or "未知",
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
                        # Add source tracking
                        props["source_doc"] = file_name
                        entity_id = self._ensure_node(entity["type"], entity["name"], props)
                        all_entities[entity_key] = entity_id

                # Collect relationships for batch merge
                rel_batch: Dict[str, list] = {}  # rel_type -> list of {from_id, to_id, properties}
                for rel in extracted.get("relationships", []):
                    from_key = f"{rel['from_type']}:{rel['from']}"
                    to_key = f"{rel['to_type']}:{rel['to']}"

                    if from_key in all_entities and to_key in all_entities:
                        rtype = rel["type"]
                        rel_batch.setdefault(rtype, []).append({
                            "from_id": all_entities[from_key],
                            "to_id": all_entities[to_key],
                            "properties": rel.get("properties", {}),
                        })
                        all_relationships.append(rel)

                # Flush batch per relationship type
                for rtype, rels in rel_batch.items():
                    self.neo4j.batch_merge_relationships(rtype, rels)

                if (i + 1) % 10 == 0:
                    logger.info(f"Processed {i + 1}/{len(chunks)} chunks for {doc_id}")
                if processed_chunks == total_chunks or processed_chunks % progress_update_interval == 0:
                    _doc_progress("extracting", processed_chunks)

            # Link Entities -> Document so we can resume/skip and optionally delete a doc subgraph.
            if doc_node_id and all_entities:
                try:
                    _doc_progress("linking", total_chunks)
                    rel_rows = [
                        {"from_id": eid, "to_id": doc_node_id, "properties": {}}
                        for eid in set(all_entities.values())
                    ]
                    self.neo4j.batch_merge_relationships("DERIVED_FROM", rel_rows)
                except Exception as e:
                    logger.warning(f"Failed to link Document to entities for {doc_id}: {e}")

            logger.info(
                f"Built graph for {doc_id} (type={doc_type}, district={district}): "
                f"{len(all_entities)} entities, {len(all_relationships)} relationships"
            )

            if doc_node_id:
                try:
                    self.neo4j.merge_document(
                        doc_id=doc_id,
                        file_name=file_name,
                        file_path=file_path,
                        kg_status="success",
                        extra_props={
                            "kg_entities_count": len(all_entities),
                            "kg_relationships_count": len(all_relationships),
                            "kg_phase": "completed",
                            "kg_total_chunks": total_chunks,
                            "kg_processed_chunks": total_chunks,
                            "kg_progress": 100,
                        },
                    )
                except Exception as e:
                    logger.warning(f"Failed to mark Document as success for {doc_id}: {e}")

            return {
                "doc_id": doc_id,
                "file_name": file_name,
                "document_type": doc_type,
                "district": district,
                "project": project,
                "entities_count": len(all_entities),
                "relationships_count": len(all_relationships),
                "status": "success",
            }

        except Exception as e:
            if doc_node_id:
                try:
                    self.neo4j.merge_document(
                        doc_id=doc_id,
                        file_name=file_name,
                        file_path=file_path,
                        kg_status="failed",
                        extra_props={
                            "kg_error": str(e),
                            "kg_phase": "failed",
                            "kg_total_chunks": total_chunks,
                            "kg_processed_chunks": max(0, min(processed_chunks, total_chunks)),
                            "kg_progress": int(
                                round((max(0, min(processed_chunks, total_chunks)) / total_chunks) * 100)
                            ),
                        },
                    )
                except Exception as ee:
                    logger.warning(f"Failed to mark Document as failed for {doc_id}: {ee}")
            raise

    # ------------------------------------------------------------------
    # Node helpers
    # ------------------------------------------------------------------

    def _ensure_node(
        self,
        label: str,
        name: str,
        properties: Optional[Dict[str, Any]] = None
    ) -> str:
        """Find existing node by name or create a new one. Returns node ID.

        If the node already exists, merge new non-empty properties into it
        so that attributes discovered in later chunks are not lost.
        """
        existing = self.neo4j.find_node_by_property(label, "name", name)
        if existing:
            node_id = existing["id"]
            existing_props = existing.get("properties", {})
            # Merge new properties into existing node (skip empty values)
            new_props = {
                k: v for k, v in (properties or {}).items()
                if v and k not in {"name", "source_doc"}
            }
            # Keep first source_doc stable; only backfill when missing.
            if properties and properties.get("source_doc") and not existing_props.get("source_doc"):
                new_props["source_doc"] = properties["source_doc"]
            if new_props:
                try:
                    self.neo4j.query(
                        "MATCH (n) WHERE elementId(n) = $nid SET n += $props",
                        {"nid": node_id, "props": new_props},
                    )
                except Exception as e:
                    logger.warning(f"Failed to merge properties for {label}:{name}: {e}")
            return node_id

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
        """Get comprehensive information about a plot (new schema: Chinese labels)."""
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
        results = self.neo4j.query(cypher, {"plot_name": plot_name})
        if results:
            return results[0]
        return {}


def create_graph_store_service(
    neo4j_client: Neo4jClient,
    enable_entity_filtering: bool = True,
    enable_importance_scoring: bool = True,
    min_importance_score: float = 1.0,
) -> GraphStoreService:
    """Create graph store service from environment variables.

    Args:
        neo4j_client: Neo4j client instance
        enable_entity_filtering: Enable heuristic entity filtering (default: True)
        enable_importance_scoring: Enable entity importance scoring (default: True)
        min_importance_score: Minimum importance score threshold (default: 1.0)

    Returns:
        Configured GraphStoreService instance
    """
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_KG_MODEL", "deepseek-v3")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return GraphStoreService(
        neo4j_client,
        base_url,
        api_key,
        model,
        enable_entity_filtering=enable_entity_filtering,
        enable_importance_scoring=enable_importance_scoring,
        min_importance_score=min_importance_score,
    )
