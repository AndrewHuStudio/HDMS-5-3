"""
Knowledge graph fusion module.

Performs entity disambiguation, cross-document relationship discovery,
and property conflict resolution on an existing Neo4j knowledge graph.

Supports two modes:
- Full fusion: process all entities in the graph (first-time use)
- Incremental fusion: only fuse newly added entities against existing graph
"""

import json
import urllib.request
import re
import time
from typing import List, Dict, Any, Optional, Tuple, Set
import logging
import os

from ..core.database.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Fusion prompts
# ---------------------------------------------------------------------------

ENTITY_DISAMBIGUATION_PROMPT = """你是一个城市规划知识图谱融合专家。请判断以下两个实体是否指代同一个对象。

**实体A**:
- 类型: {type_a}
- 名称: {name_a}
- 属性: {props_a}
- 来源文档: {source_a}

**实体B**:
- 类型: {type_b}
- 名称: {name_b}
- 属性: {props_b}
- 来源文档: {source_b}

请判断并返回JSON:
{{
  "is_same": true/false,
  "confidence": 0.0-1.0,
  "reason": "判断理由"
}}

判断依据:
1. 名称相似度（如"后海片区"和"后海中心区"可能是同一片区）
2. 属性重叠度（如相同的容积率、限高等）
3. 上下文关联（如属于同一片区的不同称呼）
4. 地块编号规律（如"DU01-01"和"DU01-1"可能是同一地块）

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""

CONFLICT_RESOLUTION_PROMPT = """你是一个城市规划知识图谱融合专家。两个文档对同一实体给出了不同的属性值，请判断应保留哪个。

**实体**: {entity_type} - {entity_name}

**冲突属性**: {property_key}
- 文档A值: {value_a} (来源: {source_a})
- 文档B值: {value_b} (来源: {source_b})

**文档A上下文**: {context_a}
**文档B上下文**: {context_b}

请判断并返回JSON:
{{
  "chosen_value": "保留的值",
  "chosen_source": "A 或 B",
  "reason": "选择理由"
}}

判断依据:
1. 文档权威性（法规 > 标准 > 导则 > 规划文件）
2. 时效性（较新的文档优先）
3. 具体性（更具体的值优先，如"3.5"优于"不超过4.0"）

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""

CROSS_DOC_RELATION_PROMPT = """你是一个城市规划知识图谱融合专家。请分析以下来自不同文档的实体，判断它们之间是否存在隐含关系。

**实体列表**（按类型分组）:
{entity_groups}

**已有关系类型**:
- PART_OF: 属于/是...的一部分
- CONTAINS: 包含
- ADJACENT_TO: 邻接/相邻
- LOCATED_IN: 位于
- APPLIES_TO: 适用于
- REFERENCES: 引用

请找出实体之间可能存在但尚未建立的关系，返回JSON:
{{
  "discovered_relations": [
    {{
      "from": "实体名称",
      "from_type": "实体类型",
      "to": "实体名称",
      "to_type": "实体类型",
      "type": "关系类型",
      "confidence": 0.0-1.0,
      "reason": "推断理由"
    }}
  ]
}}

注意:
1. 只输出高置信度(>=0.7)的关系
2. 关系类型必须从上述6种中选择
3. 不要重复已有的关系
4. 基于城市规划领域知识进行推断

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""


# ---------------------------------------------------------------------------
# Fusion service
# ---------------------------------------------------------------------------

class GraphFusionService:
    """Service for knowledge graph fusion: disambiguation, conflict resolution,
    and cross-document relationship discovery."""

    def __init__(
        self,
        neo4j_client: Neo4jClient,
        llm_base_url: str,
        llm_api_key: str,
        llm_model: str,
        confidence_threshold: float = 0.8,
    ):
        self.neo4j = neo4j_client
        self.llm_base_url = llm_base_url.rstrip("/")
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model
        self.confidence_threshold = confidence_threshold

    # ------------------------------------------------------------------
    # LLM helpers (reuse same pattern as graph_store)
    # ------------------------------------------------------------------

    def _call_llm(self, prompt: str, max_tokens: int = 2000) -> str:
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
                    logger.warning(f"LLM call attempt {attempt + 1}/{max_retries} failed: {e}, retrying in {wait}s...")
                    time.sleep(wait)
                else:
                    logger.error(f"LLM call failed after {max_retries} attempts: {e}")
                    raise

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                data = json.loads(json_match.group())
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                logger.warning("Failed to parse JSON from LLM response")
        return {}

    # ------------------------------------------------------------------
    # Step 1: Entity disambiguation
    # ------------------------------------------------------------------

    def _get_all_entities_by_type(self, entity_type: str) -> List[Dict[str, Any]]:
        """Fetch all entities of a given type from Neo4j."""
        rows = self.neo4j.query(
            f"MATCH (n:{entity_type}) RETURN elementId(n) AS id, properties(n) AS props"
        )
        return [{"id": r["id"], "props": dict(r["props"])} for r in rows]

    def _get_entities_by_ids(self, node_ids: List[str]) -> List[Dict[str, Any]]:
        """Fetch entities by their element IDs, including labels."""
        if not node_ids:
            return []
        rows = self.neo4j.query(
            "UNWIND $ids AS nid "
            "MATCH (n) WHERE elementId(n) = nid "
            "RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props",
            {"ids": node_ids},
        )
        return [
            {"id": r["id"], "type": r["labels"][0] if r["labels"] else "", "props": dict(r["props"])}
            for r in rows
        ]

    def _compute_name_similarity(self, a: str, b: str) -> float:
        """Simple character-level Jaccard similarity for quick pre-filtering."""
        if a == b:
            return 1.0
        set_a, set_b = set(a), set(b)
        intersection = set_a & set_b
        union = set_a | set_b
        return len(intersection) / len(union) if union else 0.0

    def _find_candidate_pairs(
        self,
        entities: List[Dict[str, Any]],
        entity_type: str,
        similarity_threshold: float = 0.5,
    ) -> List[Tuple[Dict, Dict]]:
        """Pre-filter entity pairs by name similarity to reduce LLM calls."""
        candidates = []
        n = len(entities)
        for i in range(n):
            name_a = entities[i]["props"].get("name", "")
            for j in range(i + 1, n):
                name_b = entities[j]["props"].get("name", "")
                if name_a == name_b:
                    # Exact match -- already handled by _ensure_node, skip
                    continue
                sim = self._compute_name_similarity(name_a, name_b)
                if sim >= similarity_threshold:
                    candidates.append((entities[i], entities[j]))
        logger.info(
            f"[{entity_type}] Found {len(candidates)} candidate pairs "
            f"from {n} entities (similarity >= {similarity_threshold})"
        )
        return candidates

    def _disambiguate_pair(
        self,
        entity_a: Dict[str, Any],
        entity_b: Dict[str, Any],
        entity_type: str,
    ) -> Dict[str, Any]:
        """Ask LLM whether two entities refer to the same object."""
        props_a = entity_a["props"]
        props_b = entity_b["props"]
        prompt = ENTITY_DISAMBIGUATION_PROMPT.format(
            type_a=entity_type,
            name_a=props_a.get("name", ""),
            props_a=json.dumps({k: v for k, v in props_a.items() if k != "name"}, ensure_ascii=False),
            source_a=props_a.get("source_doc", "unknown"),
            type_b=entity_type,
            name_b=props_b.get("name", ""),
            props_b=json.dumps({k: v for k, v in props_b.items() if k != "name"}, ensure_ascii=False),
            source_b=props_b.get("source_doc", "unknown"),
        )
        try:
            content = self._call_llm(prompt, max_tokens=500)
            return self._parse_json_response(content)
        except Exception as e:
            logger.warning(f"Disambiguation LLM call failed: {e}")
            return {}

    def _merge_nodes(self, keep_id: str, remove_id: str) -> None:
        """Merge remove_id node into keep_id: transfer relationships, then delete."""
        # Re-link each relationship from the old node to the kept node
        rels = self.neo4j.query(
            """
            MATCH (old)-[r]->(target)
            WHERE elementId(old) = $remove_id AND elementId(target) <> $keep_id
            RETURN type(r) AS rtype, properties(r) AS rprops, elementId(target) AS target_id
            """,
            {"remove_id": remove_id, "keep_id": keep_id},
        )
        for rel in rels:
            self.neo4j.create_relationship(keep_id, rel["target_id"], rel["rtype"], dict(rel["rprops"]))

        # Incoming relationships
        in_rels = self.neo4j.query(
            """
            MATCH (source)-[r]->(old)
            WHERE elementId(old) = $remove_id AND elementId(source) <> $keep_id
            RETURN type(r) AS rtype, properties(r) AS rprops, elementId(source) AS source_id
            """,
            {"remove_id": remove_id, "keep_id": keep_id},
        )
        for rel in in_rels:
            self.neo4j.create_relationship(rel["source_id"], keep_id, rel["rtype"], dict(rel["rprops"]))

        # Delete the old node
        self.neo4j.query(
            "MATCH (n) WHERE elementId(n) = $nid DETACH DELETE n",
            {"nid": remove_id},
        )
        logger.info(
            f"Merged node {remove_id} into {keep_id}, "
            f"transferred {len(rels)} outgoing + {len(in_rels)} incoming relationships"
        )

    def disambiguate_entities(
        self,
        entity_type: str,
        target_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Disambiguate entities of a given type.

        Args:
            entity_type: Entity type label (e.g. "片区", "地块")
            target_ids: If provided, only compare these entities against all others
                        (incremental mode). If None, compare all pairs (full mode).

        Returns:
            Summary dict with merge results.
        """
        all_entities = self._get_all_entities_by_type(entity_type)
        if len(all_entities) < 2:
            return {"entity_type": entity_type, "candidates": 0, "merged": 0, "merges": []}

        if target_ids:
            # Incremental: only compare target entities against existing ones
            target_set = set(target_ids)
            targets = [e for e in all_entities if e["id"] in target_set]
            others = [e for e in all_entities if e["id"] not in target_set]
            candidates = []
            for t in targets:
                name_t = t["props"].get("name", "")
                for o in others:
                    name_o = o["props"].get("name", "")
                    if name_t != name_o and self._compute_name_similarity(name_t, name_o) >= 0.5:
                        candidates.append((t, o))
        else:
            # Full: compare all pairs
            candidates = self._find_candidate_pairs(all_entities, entity_type)

        merges = []
        merged_ids: Set[str] = set()

        for entity_a, entity_b in candidates:
            if entity_a["id"] in merged_ids or entity_b["id"] in merged_ids:
                continue

            result = self._disambiguate_pair(entity_a, entity_b, entity_type)
            is_same = result.get("is_same", False)
            confidence = result.get("confidence", 0.0)

            if is_same and confidence >= self.confidence_threshold:
                name_a = entity_a["props"].get("name", "")
                name_b = entity_b["props"].get("name", "")
                logger.info(
                    f"Merging [{entity_type}] '{name_b}' -> '{name_a}' "
                    f"(confidence={confidence}, reason={result.get('reason', '')})"
                )

                # Merge properties before merging nodes
                props_b = {k: v for k, v in entity_b["props"].items() if v and k != "name"}
                if props_b:
                    self.neo4j.query(
                        "MATCH (n) WHERE elementId(n) = $nid SET n += $props",
                        {"nid": entity_a["id"], "props": props_b},
                    )

                # Add alias for traceability
                self.neo4j.query(
                    "MATCH (n) WHERE elementId(n) = $nid "
                    "SET n.aliases = coalesce(n.aliases, []) + $alias",
                    {"nid": entity_a["id"], "alias": name_b},
                )

                self._merge_nodes(entity_a["id"], entity_b["id"])
                merged_ids.add(entity_b["id"])
                merges.append({
                    "kept": name_a,
                    "removed": name_b,
                    "confidence": confidence,
                    "reason": result.get("reason", ""),
                })

        return {
            "entity_type": entity_type,
            "candidates": len(candidates),
            "merged": len(merges),
            "merges": merges,
        }

    # ------------------------------------------------------------------
    # Step 2: Property conflict resolution
    # ------------------------------------------------------------------

    def _find_property_conflicts(self) -> List[Dict[str, Any]]:
        """Find nodes that have aliases (merged) and may have conflicting properties."""
        rows = self.neo4j.query(
            """
            MATCH (n)
            WHERE n.aliases IS NOT NULL AND size(n.aliases) > 0
            RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props
            """
        )
        # For now, conflicts are detected during merge when properties differ.
        # This method returns merged nodes for potential manual review.
        return [
            {"id": r["id"], "type": r["labels"][0] if r["labels"] else "", "props": dict(r["props"])}
            for r in rows
        ]

    def resolve_conflict(
        self,
        entity_id: str,
        entity_type: str,
        entity_name: str,
        property_key: str,
        value_a: str,
        source_a: str,
        value_b: str,
        source_b: str,
    ) -> Dict[str, Any]:
        """Ask LLM to resolve a property conflict between two sources."""
        prompt = CONFLICT_RESOLUTION_PROMPT.format(
            entity_type=entity_type,
            entity_name=entity_name,
            property_key=property_key,
            value_a=value_a,
            source_a=source_a,
            value_b=value_b,
            source_b=source_b,
            context_a=source_a,
            context_b=source_b,
        )
        try:
            content = self._call_llm(prompt, max_tokens=500)
            result = self._parse_json_response(content)
            if result and "chosen_value" in result:
                # Apply the chosen value
                self.neo4j.query(
                    "MATCH (n) WHERE elementId(n) = $nid SET n[$key] = $val",
                    {"nid": entity_id, "key": property_key, "val": result["chosen_value"]},
                )
                logger.info(
                    f"Resolved conflict on {entity_type}:{entity_name}.{property_key} "
                    f"-> {result['chosen_value']} (reason: {result.get('reason', '')})"
                )
            return result
        except Exception as e:
            logger.warning(f"Conflict resolution failed: {e}")
            return {}

    # ------------------------------------------------------------------
    # Step 3: Cross-document relationship discovery
    # ------------------------------------------------------------------

    def _get_existing_relations(self) -> Set[str]:
        """Get a set of existing relationship keys for deduplication."""
        rows = self.neo4j.query(
            """
            MATCH (a)-[r]->(b)
            RETURN a.name AS from_name, type(r) AS rtype, b.name AS to_name
            """
        )
        return {f"{r['from_name']}|{r['rtype']}|{r['to_name']}" for r in rows}

    def _build_entity_groups_text(
        self,
        entity_types: List[str],
        target_ids: Optional[List[str]] = None,
    ) -> str:
        """Build a text representation of entities grouped by type for the LLM prompt."""
        lines = []
        for etype in entity_types:
            entities = self._get_all_entities_by_type(etype)
            if target_ids:
                # In incremental mode, include all entities but mark new ones
                target_set = set(target_ids)
                for e in entities:
                    name = e["props"].get("name", "")
                    source = e["props"].get("source_doc", "")
                    marker = " [NEW]" if e["id"] in target_set else ""
                    lines.append(f"  - [{etype}] {name} (source: {source}){marker}")
            else:
                for e in entities:
                    name = e["props"].get("name", "")
                    source = e["props"].get("source_doc", "")
                    lines.append(f"  - [{etype}] {name} (source: {source})")
        return "\n".join(lines)

    def discover_cross_doc_relations(
        self,
        target_ids: Optional[List[str]] = None,
        batch_size: int = 50,
    ) -> Dict[str, Any]:
        """
        Discover implicit relationships between entities from different documents.

        Args:
            target_ids: If provided, focus on relations involving these entities (incremental).
            batch_size: Max entities per LLM call to avoid token overflow.

        Returns:
            Summary dict with discovered relations.
        """
        entity_types = ["片区", "地块", "空间要素", "法规", "标准", "导则"]
        existing_rels = self._get_existing_relations()

        # Build entity text, potentially in batches
        entity_text = self._build_entity_groups_text(entity_types, target_ids)
        if not entity_text.strip():
            return {"discovered": 0, "relations": []}

        # Split into batches if too many entities
        entity_lines = entity_text.strip().split("\n")
        all_discovered = []

        for batch_start in range(0, len(entity_lines), batch_size):
            batch_lines = entity_lines[batch_start:batch_start + batch_size]
            batch_text = "\n".join(batch_lines)

            prompt = CROSS_DOC_RELATION_PROMPT.format(entity_groups=batch_text)

            try:
                content = self._call_llm(prompt, max_tokens=3000)
                result = self._parse_json_response(content)
                relations = result.get("discovered_relations", [])

                for rel in relations:
                    confidence = rel.get("confidence", 0.0)
                    if confidence < 0.7:
                        continue

                    rel_key = f"{rel['from']}|{rel['type']}|{rel['to']}"
                    if rel_key in existing_rels:
                        continue

                    # Create the relationship in Neo4j
                    from_node = self.neo4j.find_node_by_property(rel["from_type"], "name", rel["from"])
                    to_node = self.neo4j.find_node_by_property(rel["to_type"], "name", rel["to"])

                    if from_node and to_node:
                        self.neo4j.create_relationship(
                            from_node["id"],
                            to_node["id"],
                            rel["type"],
                            {
                                "discovered_by": "fusion",
                                "confidence": confidence,
                                "reason": rel.get("reason", ""),
                            },
                        )
                        existing_rels.add(rel_key)
                        all_discovered.append(rel)
                        logger.info(
                            f"Discovered relation: [{rel['from_type']}]{rel['from']} "
                            f"-[{rel['type']}]-> [{rel['to_type']}]{rel['to']} "
                            f"(confidence={confidence})"
                        )

            except Exception as e:
                logger.warning(f"Cross-doc relation discovery batch failed: {e}")

        return {
            "discovered": len(all_discovered),
            "relations": all_discovered,
        }

    # ------------------------------------------------------------------
    # Main fusion entry points
    # ------------------------------------------------------------------

    def fuse_full(self) -> Dict[str, Any]:
        """
        Full fusion: disambiguate all entity types + discover cross-doc relations.

        Use this when running fusion for the first time on an existing graph.
        """
        logger.info("=== Starting full graph fusion ===")
        entity_types = ["片区", "地块", "空间要素", "法规", "标准", "导则"]

        # Phase 1: Entity disambiguation
        disambiguation_results = []
        total_merged = 0
        for etype in entity_types:
            result = self.disambiguate_entities(etype)
            disambiguation_results.append(result)
            total_merged += result["merged"]
            logger.info(
                f"[{etype}] Disambiguation done: "
                f"{result['candidates']} candidates, {result['merged']} merged"
            )

        # Phase 2: Cross-document relationship discovery
        relation_result = self.discover_cross_doc_relations()

        summary = {
            "mode": "full",
            "disambiguation": {
                "total_merged": total_merged,
                "by_type": disambiguation_results,
            },
            "cross_doc_relations": relation_result,
            "status": "success",
        }
        logger.info(
            f"=== Full fusion complete: {total_merged} entities merged, "
            f"{relation_result['discovered']} relations discovered ==="
        )
        return summary

    def fuse_incremental(self, new_entity_ids: List[str]) -> Dict[str, Any]:
        """
        Incremental fusion: only fuse newly added entities against existing graph.

        Args:
            new_entity_ids: List of Neo4j element IDs for newly created entities.

        Use this when new documents are added to an already-fused graph.
        """
        if not new_entity_ids:
            return {"mode": "incremental", "status": "skipped", "reason": "no new entities"}

        logger.info(f"=== Starting incremental fusion for {len(new_entity_ids)} new entities ===")

        # Group new entities by type
        new_entities = self._get_entities_by_ids(new_entity_ids)
        type_to_ids: Dict[str, List[str]] = {}
        for e in new_entities:
            etype = e["type"]
            if etype:
                type_to_ids.setdefault(etype, []).append(e["id"])

        # Phase 1: Disambiguate new entities against existing ones
        disambiguation_results = []
        total_merged = 0
        for etype, ids in type_to_ids.items():
            result = self.disambiguate_entities(etype, target_ids=ids)
            disambiguation_results.append(result)
            total_merged += result["merged"]

        # Phase 2: Discover cross-doc relations involving new entities
        relation_result = self.discover_cross_doc_relations(target_ids=new_entity_ids)

        summary = {
            "mode": "incremental",
            "new_entities_count": len(new_entity_ids),
            "disambiguation": {
                "total_merged": total_merged,
                "by_type": disambiguation_results,
            },
            "cross_doc_relations": relation_result,
            "status": "success",
        }
        logger.info(
            f"=== Incremental fusion complete: {total_merged} merged, "
            f"{relation_result['discovered']} relations discovered ==="
        )
        return summary


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_fusion_service(neo4j_client: Neo4jClient) -> GraphFusionService:
    """Create fusion service from environment variables."""
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_KG_MODEL", "deepseek-v3")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return GraphFusionService(neo4j_client, base_url, api_key, model)
