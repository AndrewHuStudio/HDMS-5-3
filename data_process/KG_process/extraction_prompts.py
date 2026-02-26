"""
Universal extraction prompts for knowledge graph construction.

Supports flexible document type identification and entity extraction
for different districts and regulatory materials.
"""

from typing import Dict, Any

# ---------------------------------------------------------------------------
# Entity type definitions (Chinese labels)
# ---------------------------------------------------------------------------

ENTITY_TYPE_DEFINITIONS = """
实体类型定义（共6种）：

【空间层级类】
- 片区: 城市规划中的片区或区域单元 (如 "深圳湾超级总部基地", "丽泽金融商务区", "后海中心区")
- 地块: 具体的开发地块单元 (如 "DU01-01", "A地块")
  * 地块属性: area(面积), far(容积率), height_limit(限高), setback(退线), land_use(用地性质)
- 空间要素: 具体的空间构成要素或场所类型 (如 "街道空间", "公共广场", "建筑", "绿地")

【管控规则类】
- 法规: 法律法规、地方条例 (如 "深圳市城市规划条例", "城乡规划法")
  * 法规属性: code(编号), effective_date(生效日期)
- 标准: 国家标准、行业标准、技术规范 (如 "建筑设计防火规范GB50016")
  * 标准属性: code(编号), version(版本)
- 导则: 设计导则、规划指南、技术指引 (如 "空间形态设计导则")
  * 导则属性: scope(适用范围), version(版本)

**重要说明**：
- 容积率、建筑限高、退线距离等指标应作为地块的**属性**，而不是独立实体
- 管控要求的具体内容应作为法规/标准/导则的**属性**，而不是独立实体
"""

# ---------------------------------------------------------------------------
# Relationship type definitions (English)
# ---------------------------------------------------------------------------

RELATIONSHIP_TYPE_DEFINITIONS = """
关系类型定义（共8种，使用英文标识）：

【层级关系】
- PART_OF: 属于/是...的一部分 (如 地块-[PART_OF]->片区, 空间要素-[PART_OF]->地块)
- CONTAINS: 包含关系 (如 片区-[CONTAINS]->地块)

【空间关系】
- ADJACENT_TO: 邻接/相邻 (如 地块-[ADJACENT_TO {direction: "东侧"}]->地块)
- LOCATED_IN: 位于 (如 空间要素-[LOCATED_IN]->地块)

【管控关系】
- APPLIES_TO: 适用于 (如 法规-[APPLIES_TO]->片区, 标准-[APPLIES_TO]->地块, 导则-[APPLIES_TO]->片区)
- REFERENCES: 引用 (如 标准-[REFERENCES {article: "第15条"}]->法规, 导则-[REFERENCES]->标准)

【来源关系】
- DERIVED_FROM: 来源于 (如 地块-[DERIVED_FROM {page: 5}]->文档来源)

【属性关系（可选）】
- HAS_PROPERTY: 有属性 (如 地块-[HAS_PROPERTY {name: "容积率", value: "3.5"}]->属性描述)
  * 注意：通常指标值应直接作为节点属性，此关系仅在需要追溯属性来源时使用
"""

# ---------------------------------------------------------------------------
# Document type definitions
# ---------------------------------------------------------------------------

DOCUMENT_TYPES = {
    "法规条例": "Regulation Document",
    "技术标准": "Standard Document",
    "设计导则": "Guideline Document",
    "管控要求": "Requirement Document",
    "规划文件": "Planning Document",
    "地块清单": "Plot Inventory",
    "其他": "Other",
}

# ---------------------------------------------------------------------------
# Document-level analysis prompt (Phase 1)
# ---------------------------------------------------------------------------

DOCUMENT_ANALYSIS_PROMPT = """你是一个城市规划管控知识图谱构建专家。请分析以下文档片段，识别文档的基本信息。

请从文档中提取：

1. **文档类型** (document_type)：
   - "法规条例" - 法律法规、地方条例
   - "技术标准" - 国家标准、行业标准、技术规范
   - "设计导则" - 设计导则、规划指南、技术指引
   - "管控要求" - 具体的管控要求文件
   - "规划文件" - 规划方案、规划说明
   - "地块清单" - 地块信息清单、开发建设手册
   - "其他" - 其他类型文档

2. **所属片区** (district)：
   - 如果文档明确提到片区名称（如"深圳湾超级总部基地"、"丽泽金融商务区"），提取片区名称
   - 如果没有明确提到，返回 null

3. **所属项目** (project)：
   - 如果文档提到具体项目名称，提取项目名称
   - 如果没有，返回 null

4. **核心概念** (anchor_entities)：
   - 提取文档中最重要的3-5个核心概念（如标准名称、导则名称、主要管控对象）
   - 每个概念包含：type（实体类型，使用中文）、name（名称）、properties（属性，可选）
   - 实体类型必须从以下6种中选择：片区、地块、空间要素、法规、标准、导则
   - 如果是地块，提取其属性（容积率、限高、退线等）作为properties

{entity_definitions}

**输出格式**（必须是有效的JSON）：
{{
  "document_type": "技术标准",
  "district": "深圳湾超级总部基地",
  "project": "深圳湾超级总部基地项目",
  "anchor_entities": [
    {{"type": "标准", "name": "高强度片区环境性能评估标准"}},
    {{"type": "空间要素", "name": "环境性能指标"}}
  ],
  "indicator_categories": ["环境性能指标", "强度指标"]
}}

**文档片段**：
{text}

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""

# ---------------------------------------------------------------------------
# Universal entity extraction prompt (Phase 2)
# ---------------------------------------------------------------------------

UNIVERSAL_EXTRACTION_PROMPT = """你是一个城市规划管控知识图谱构建专家。请从以下文本中提取实体和关系。

**文档上下文**：
- 文档类型：{doc_type}
- 所属片区：{district}
- 所属项目：{project}
{doc_context}

**提取重点**：

1. **空间实体**：
   - 片区：如"深圳湾超级总部基地"、"丽泽金融商务区"、"后海中心区"
   - 地块：如"DU01-01"、"A地块"（注意识别地块编号格式）
     * 地块属性：容积率、建筑限高、退线距离、绿地率、建筑密度、用地面积等
   - 空间要素：如"街道空间"、"公共广场"、"建筑"

2. **管控规则**：
   - 法规：如"深圳市城市规划条例"
   - 标准：如"建筑设计防火规范GB50016"
   - 导则：如"空间形态设计导则"

**关系提取重点**（仅使用以下8种关系类型）：
- PART_OF：地块属于片区、空间要素属于地块
- CONTAINS：片区包含地块
- ADJACENT_TO：地块之间的邻接关系（注意提取方向信息）
- LOCATED_IN：空间要素位于地块或片区
- APPLIES_TO：法规/标准/导则适用于片区/地块/空间要素
- REFERENCES：标准引用法规、导则引用标准（注意提取引用的条款）
- DERIVED_FROM：实体来源于文档（注意提取页码）
- HAS_PROPERTY：仅在需要追溯属性来源时使用，通常指标值应直接作为节点属性

{entity_definitions}

{relationship_definitions}

**输出格式**（必须是有效的JSON）：
{{
  "entities": [
    {{
      "type": "地块",
      "name": "DU01-01",
      "properties": {{
        "area": "5000m2",
        "far": "3.5",
        "height_limit": "100m",
        "setback": "10m"
      }}
    }},
    {{
      "type": "片区",
      "name": "深圳湾超级总部基地",
      "properties": {{}}
    }}
  ],
  "relationships": [
    {{
      "from": "DU01-01",
      "from_type": "地块",
      "to": "深圳湾超级总部基地",
      "to_type": "片区",
      "type": "PART_OF",
      "properties": {{}}
    }}
  ]
}}

**注意事项**：
1. 实体类型必须使用中文（从6种预定义类型中选择：片区、地块、空间要素、法规、标准、导则）
2. 关系类型必须使用英文（从8种预定义类型中选择）
3. 只提取文本中明确提到的实体，不要推测
4. 实体名称要准确，保留原文表述
5. 地块的指标值（容积率、限高等）应作为properties属性，而不是独立实体
6. 关系的from和to必须是已提取的实体
7. 如果文本是表格，注意提取表格中的结构化信息
8. 地块编号格式通常为：DU##-##（如DU01-01）

**质量要求（重要）**：
- ❌ 不要提取：纯数值、单位、泛化词汇（"其他"、"相关"）、描述性短语、单个汉字
- ❌ 不要提取：过于泛化的名称（"片区"、"地块"、"空间"、"要素"、"标准"）
- ✅ 只提取：具体的、有明确指代的实体名称
- ✅ 片区/地块/规则类实体：长度至少4个字符
- ✅ 空间要素：长度至少3个字符
- ✅ 优先提取：包含编号、标识符的实体（如"DU01-01"、"GB50016"）

**文本**：
{text}

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""

# ---------------------------------------------------------------------------
# Table-specific extraction prompt
# ---------------------------------------------------------------------------

TABLE_EXTRACTION_PROMPT = """你是一个城市规划管控知识图谱构建专家。以下文本包含表格信息，请特别注意提取表格中的结构化数据。

**文档上下文**：
- 文档类型：{doc_type}
- 所属片区：{district}
{doc_context}

**表格提取重点**：
1. 识别表格的列标题（通常是指标名称，如容积率、建筑限高）
2. 识别表格的行标题（通常是地块编号）
3. 提取单元格中的数值和单位
4. 将指标值作为地块的属性，而不是独立实体

**示例**：
如果表格是：
| 地块编号 | 容积率 | 建筑限高 | 绿地率 |
| DU01-01 | 3.5   | 100m   | 30%   |

应提取：
- 实体：地块"DU01-01" {far: "3.5", height_limit: "100m", green_ratio: "30%"}
- 如果表格中提到片区，建立关系：DU01-01-[PART_OF]->片区

{entity_definitions}

{relationship_definitions}

**输出格式**（必须是有效的JSON）：
{{
  "entities": [...],
  "relationships": [...]
}}

**表格文本**：
{text}

请严格按照JSON格式输出，不要添加任何其他文字说明。
"""

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def get_document_analysis_prompt(text: str) -> str:
    """Get document-level analysis prompt."""
    return DOCUMENT_ANALYSIS_PROMPT.format(
        text=text,
        entity_definitions=ENTITY_TYPE_DEFINITIONS
    )


def get_extraction_prompt(
    text: str,
    doc_type: str = "其他",
    district: str = "未知",
    project: str = "未知",
    is_table: bool = False,
    doc_context: str = ""
) -> str:
    """
    Get entity extraction prompt.

    Args:
        text: Text to extract from
        doc_type: Document type
        district: District name
        project: Project name
        is_table: Whether the text contains table
        doc_context: Document-level context (JSON string)

    Returns:
        Formatted prompt string
    """
    # Format document context
    context_str = ""
    if doc_context:
        context_str = f"\n- 文档级上下文：{doc_context}"

    # Choose prompt template
    if is_table:
        template = TABLE_EXTRACTION_PROMPT
        return template.format(
            text=text,
            doc_type=doc_type,
            district=district,
            doc_context=context_str,
            entity_definitions=ENTITY_TYPE_DEFINITIONS,
            relationship_definitions=RELATIONSHIP_TYPE_DEFINITIONS
        )
    else:
        template = UNIVERSAL_EXTRACTION_PROMPT
        return template.format(
            text=text,
            doc_type=doc_type,
            district=district,
            project=project,
            doc_context=context_str,
            entity_definitions=ENTITY_TYPE_DEFINITIONS,
            relationship_definitions=RELATIONSHIP_TYPE_DEFINITIONS
        )
