"""
Entity filtering module for reducing long-tail nodes in knowledge graph.

Provides multiple filtering strategies:
1. Heuristic rules (length, stopwords, patterns)
2. Entity importance scoring (frequency, connectivity)
3. Post-construction cleanup (isolated nodes, low-degree nodes)
"""

import re
from typing import List, Dict, Any, Set, Optional
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stopwords and noise patterns
# ---------------------------------------------------------------------------

# Common stopwords that should not be entities
ENTITY_STOPWORDS = {
    # 通用词
    "其他", "等", "包括", "如下", "以下", "上述", "相关", "有关", "关于",
    "主要", "重要", "必须", "应当", "可以", "需要", "进行", "实施", "执行",

    # 描述性词汇
    "要求", "规定", "标准", "指标", "内容", "方式", "方法", "措施", "原则",
    "目标", "任务", "工作", "管理", "建设", "开发", "设计", "规划",

    # 数量词
    "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
    "第一", "第二", "第三", "第四", "第五",

    # 时间词
    "年", "月", "日", "期间", "阶段", "时期",
}

# Patterns that indicate noise entities
NOISE_PATTERNS = [
    r'^[\d\s\.\-]+$',           # 纯数字和符号
    r'^[a-zA-Z\s]+$',           # 纯英文字母（除非是标准编号）
    r'^[\u4e00-\u9fa5]{1}$',    # 单个汉字
    r'^\d+[米m]$',              # 纯数值+单位（应该是属性）
    r'^\d+%$',                  # 纯百分比（应该是属性）
    r'^\d+\.?\d*$',             # 纯数字
    r'^[、，。；：！？]+$',      # 纯标点
]

# Valid standard/regulation code patterns
VALID_CODE_PATTERNS = [
    r'GB\d+',                   # 国标
    r'JGJ\d+',                  # 行业标准
    r'CJJ\d+',                  # 城建标准
    r'DB\d+',                   # 地方标准
    r'DU\d{2}-\d{2}',          # 地块编号
]

# ---------------------------------------------------------------------------
# Entity quality filters
# ---------------------------------------------------------------------------

class EntityFilter:
    """Filter for removing low-quality entities during extraction."""

    def __init__(
        self,
        min_name_length: int = 2,
        max_name_length: int = 50,
        enable_stopword_filter: bool = True,
        enable_pattern_filter: bool = True,
    ):
        self.min_name_length = min_name_length
        self.max_name_length = max_name_length
        self.enable_stopword_filter = enable_stopword_filter
        self.enable_pattern_filter = enable_pattern_filter

    def is_valid_entity(self, entity: Dict[str, Any]) -> bool:
        """
        Check if an entity passes quality filters.

        Returns:
            True if entity should be kept, False if it should be filtered out.
        """
        etype = entity.get("type", "")
        ename = entity.get("name", "").strip()

        if not ename:
            return False

        # Length check
        if len(ename) < self.min_name_length or len(ename) > self.max_name_length:
            logger.debug(f"Filtered by length: {ename} (len={len(ename)})")
            return False

        # Stopword check
        if self.enable_stopword_filter and ename in ENTITY_STOPWORDS:
            logger.debug(f"Filtered by stopword: {ename}")
            return False

        # Pattern check
        if self.enable_pattern_filter:
            # Check if it's a valid code (exception to noise patterns)
            is_valid_code = any(re.search(p, ename) for p in VALID_CODE_PATTERNS)

            if not is_valid_code:
                # Check noise patterns
                for pattern in NOISE_PATTERNS:
                    if re.match(pattern, ename):
                        logger.debug(f"Filtered by noise pattern: {ename}")
                        return False

        # Type-specific checks
        if etype == "地块":
            # 地块名称必须包含编号或明确标识
            if not (re.search(r'DU\d{2}-\d{2}', ename) or
                    re.search(r'[A-Z]\d+', ename) or
                    "地块" in ename):
                logger.debug(f"Filtered invalid plot name: {ename}")
                return False

        elif etype == "片区":
            # 片区名称不应该是纯描述性词汇
            if ename in ["片区", "区域", "地区", "范围"]:
                logger.debug(f"Filtered generic district name: {ename}")
                return False

        elif etype in ["法规", "标准", "导则"]:
            # 规则类实体名称应该有一定长度和结构
            if len(ename) < 4:
                logger.debug(f"Filtered short rule name: {ename}")
                return False

        elif etype == "空间要素":
            # 空间要素不应该是过于泛化的词
            generic_spatial = {"空间", "要素", "部分", "区域", "位置", "地方"}
            if ename in generic_spatial:
                logger.debug(f"Filtered generic spatial element: {ename}")
                return False

        return True

    def filter_entities(self, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Filter a list of entities, returning only valid ones."""
        valid = [e for e in entities if self.is_valid_entity(e)]
        filtered_count = len(entities) - len(valid)
        if filtered_count > 0:
            logger.info(f"Filtered {filtered_count}/{len(entities)} low-quality entities")
        return valid


# ---------------------------------------------------------------------------
# Entity importance scoring
# ---------------------------------------------------------------------------

class EntityImportanceScorer:
    """Score entities by importance to prioritize high-value nodes."""

    def __init__(self):
        self.entity_frequency: Dict[str, int] = {}
        self.entity_types: Dict[str, str] = {}

    def update_frequency(self, entities: List[Dict[str, Any]]) -> None:
        """Update entity frequency counts from a batch of entities."""
        for entity in entities:
            key = f"{entity['type']}:{entity['name']}"
            self.entity_frequency[key] = self.entity_frequency.get(key, 0) + 1
            self.entity_types[key] = entity['type']

    def get_importance_score(self, entity_type: str, entity_name: str) -> float:
        """
        Calculate importance score for an entity.

        Score components:
        - Type weight (0-1): 片区/地块 > 法规/标准/导则 > 空间要素
        - Frequency bonus (0-1): log-scaled frequency
        - Name quality (0-1): based on name characteristics

        Returns:
            Score between 0-3 (higher is more important)
        """
        key = f"{entity_type}:{entity_name}"

        # Type weight
        type_weights = {
            "片区": 1.0,
            "地块": 1.0,
            "法规": 0.8,
            "标准": 0.8,
            "导则": 0.8,
            "空间要素": 0.5,
        }
        type_score = type_weights.get(entity_type, 0.3)

        # Frequency bonus (log-scaled to avoid over-weighting)
        freq = self.entity_frequency.get(key, 1)
        import math
        freq_score = min(1.0, math.log(freq + 1) / math.log(10))

        # Name quality
        name_score = self._score_name_quality(entity_type, entity_name)

        total_score = type_score + freq_score + name_score
        return total_score

    def _score_name_quality(self, entity_type: str, entity_name: str) -> float:
        """Score name quality based on characteristics."""
        score = 0.0

        # Longer names (within reason) are usually more specific
        if 4 <= len(entity_name) <= 20:
            score += 0.3
        elif len(entity_name) > 20:
            score += 0.1

        # Names with codes/numbers are usually more specific
        if re.search(r'[A-Z]{2,}\d+|DU\d{2}-\d{2}', entity_name):
            score += 0.4

        # Names with specific keywords
        if entity_type == "片区" and any(kw in entity_name for kw in ["基地", "中心区", "商务区", "片区"]):
            score += 0.3

        if entity_type in ["法规", "标准", "导则"] and any(kw in entity_name for kw in ["规范", "标准", "导则", "条例", "办法"]):
            score += 0.3

        return min(1.0, score)

    def filter_by_importance(
        self,
        entities: List[Dict[str, Any]],
        min_score: float = 1.0
    ) -> List[Dict[str, Any]]:
        """Filter entities by minimum importance score."""
        valid = []
        for entity in entities:
            score = self.get_importance_score(entity['type'], entity['name'])
            if score >= min_score:
                valid.append(entity)
            else:
                logger.debug(
                    f"Filtered by importance: {entity['type']}:{entity['name']} "
                    f"(score={score:.2f})"
                )

        filtered_count = len(entities) - len(valid)
        if filtered_count > 0:
            logger.info(
                f"Filtered {filtered_count}/{len(entities)} entities "
                f"by importance (min_score={min_score})"
            )
        return valid


# ---------------------------------------------------------------------------
# Post-construction cleanup
# ---------------------------------------------------------------------------

class GraphCleaner:
    """Clean up long-tail nodes after graph construction."""

    def __init__(self, neo4j_client):
        self.neo4j = neo4j_client

    def remove_isolated_nodes(self, min_degree: int = 1) -> int:
        """
        Remove nodes with degree less than min_degree.

        Args:
            min_degree: Minimum number of relationships (default 1 = remove isolated)

        Returns:
            Number of nodes removed
        """
        # Find nodes with low degree
        cypher = """
        MATCH (n)
        WHERE NOT n:Document
        WITH n, size((n)--()) as degree
        WHERE degree < $min_degree
        RETURN elementId(n) as id, labels(n)[0] as label, n.name as name, degree
        """

        low_degree_nodes = self.neo4j.query(cypher, {"min_degree": min_degree})

        if not low_degree_nodes:
            logger.info("No low-degree nodes to remove")
            return 0

        # Delete them
        node_ids = [n["id"] for n in low_degree_nodes]
        self.neo4j.query(
            "UNWIND $ids AS nid MATCH (n) WHERE elementId(n) = nid DETACH DELETE n",
            {"ids": node_ids}
        )

        logger.info(
            f"Removed {len(node_ids)} nodes with degree < {min_degree}"
        )

        # Log some examples
        for node in low_degree_nodes[:5]:
            logger.debug(
                f"  Removed: [{node['label']}] {node['name']} (degree={node['degree']})"
            )

        return len(node_ids)

    def remove_nodes_by_frequency(self, min_frequency: int = 2) -> int:
        """
        Remove entities that appear in fewer than min_frequency documents.

        Assumes entities have a 'source_doc' property.
        """
        cypher = """
        MATCH (n)
        WHERE NOT n:Document AND n.source_doc IS NOT NULL
        WITH n, count(DISTINCT n.source_doc) as doc_count
        WHERE doc_count < $min_freq
        RETURN elementId(n) as id, labels(n)[0] as label, n.name as name, doc_count
        """

        rare_nodes = self.neo4j.query(cypher, {"min_freq": min_frequency})

        if not rare_nodes:
            logger.info("No rare nodes to remove")
            return 0

        node_ids = [n["id"] for n in rare_nodes]
        self.neo4j.query(
            "UNWIND $ids AS nid MATCH (n) WHERE elementId(n) = nid DETACH DELETE n",
            {"ids": node_ids}
        )

        logger.info(
            f"Removed {len(node_ids)} nodes appearing in < {min_frequency} documents"
        )

        return len(node_ids)

    def merge_similar_names(self, similarity_threshold: float = 0.9) -> int:
        """
        Merge entities with very similar names (likely duplicates with typos).

        Uses simple character-level Jaccard similarity.
        """
        # Get all entities by type
        from ..KG_process.graph_store import VALID_ENTITY_TYPES

        total_merged = 0

        for entity_type in VALID_ENTITY_TYPES:
            cypher = f"""
            MATCH (n:{entity_type})
            RETURN elementId(n) as id, n.name as name
            """

            nodes = self.neo4j.query(cypher)

            if len(nodes) < 2:
                continue

            # Find similar pairs
            merged_ids = set()

            for i in range(len(nodes)):
                if nodes[i]["id"] in merged_ids:
                    continue

                name_i = nodes[i]["name"]

                for j in range(i + 1, len(nodes)):
                    if nodes[j]["id"] in merged_ids:
                        continue

                    name_j = nodes[j]["name"]

                    # Compute similarity
                    sim = self._jaccard_similarity(name_i, name_j)

                    if sim >= similarity_threshold:
                        # Merge j into i
                        logger.info(
                            f"Merging similar entities: '{name_j}' -> '{name_i}' "
                            f"(similarity={sim:.2f})"
                        )

                        self._merge_nodes(nodes[i]["id"], nodes[j]["id"])
                        merged_ids.add(nodes[j]["id"])
                        total_merged += 1

        if total_merged > 0:
            logger.info(f"Merged {total_merged} similar entities")

        return total_merged

    def _jaccard_similarity(self, a: str, b: str) -> float:
        """Compute character-level Jaccard similarity."""
        set_a = set(a)
        set_b = set(b)
        intersection = set_a & set_b
        union = set_a | set_b
        return len(intersection) / len(union) if union else 0.0

    def _merge_nodes(self, keep_id: str, remove_id: str) -> None:
        """Merge remove_id into keep_id."""
        # Transfer outgoing relationships
        self.neo4j.query(
            """
            MATCH (old)-[r]->(target)
            WHERE elementId(old) = $remove_id AND elementId(target) <> $keep_id
            MATCH (keep) WHERE elementId(keep) = $keep_id
            MERGE (keep)-[r2:type(r)]->(target)
            SET r2 += properties(r)
            """,
            {"remove_id": remove_id, "keep_id": keep_id}
        )

        # Transfer incoming relationships
        self.neo4j.query(
            """
            MATCH (source)-[r]->(old)
            WHERE elementId(old) = $remove_id AND elementId(source) <> $keep_id
            MATCH (keep) WHERE elementId(keep) = $keep_id
            MERGE (source)-[r2:type(r)]->(keep)
            SET r2 += properties(r)
            """,
            {"remove_id": remove_id, "keep_id": keep_id}
        )

        # Delete old node
        self.neo4j.query(
            "MATCH (n) WHERE elementId(n) = $nid DETACH DELETE n",
            {"nid": remove_id}
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_entity_filter(
    min_name_length: int = 2,
    max_name_length: int = 50,
) -> EntityFilter:
    """Create entity filter with default settings."""
    return EntityFilter(
        min_name_length=min_name_length,
        max_name_length=max_name_length,
        enable_stopword_filter=True,
        enable_pattern_filter=True,
    )


def create_importance_scorer() -> EntityImportanceScorer:
    """Create entity importance scorer."""
    return EntityImportanceScorer()


def create_graph_cleaner(neo4j_client) -> GraphCleaner:
    """Create graph cleaner."""
    return GraphCleaner(neo4j_client)
