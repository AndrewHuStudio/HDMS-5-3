"""
Topic-aware extraction prompts for knowledge graph construction.

Each topic (课题) has a specialized LLM prompt that targets the entity types
and relationship types most relevant to its content domain.
"""

from typing import Dict, Any

# ---------------------------------------------------------------------------
# Topic classification config
# ---------------------------------------------------------------------------

TOPIC_CONFIG: Dict[str, Dict[str, Any]] = {
    "课题1": {
        "name": "高强度片区界定与分类标准",
        "entity_focus": ["Standard", "PerformanceDimension", "Indicator", "ThresholdValue"],
        "relationship_focus": ["DEFINES", "EVALUATES", "HAS_THRESHOLD", "CATEGORIZED_UNDER"],
    },
    "课题2": {
        "name": "热舒适与温度分析研究",
        "entity_focus": ["ResearchFinding", "EvaluationMethod", "Indicator", "SpatialElement"],
        "relationship_focus": ["SUPPORTS", "MEASURED_BY", "DERIVED_FROM", "INFLUENCES"],
    },
    "课题3": {
        "name": "空间形态设计导则",
        "entity_focus": ["DesignGuideline", "SpatialElement", "Requirement", "Function", "Indicator", "ThresholdValue"],
        "relationship_focus": ["PRESCRIBES", "APPLIES_TO", "HAS_THRESHOLD", "INFLUENCES"],
    },
    "课题4": {
        "name": "人本性能研究与设计导则",
        "entity_focus": ["ResearchFinding", "SpatialElement", "Indicator", "PerformanceDimension", "EvaluationMethod", "DesignGuideline"],
        "relationship_focus": ["SUPPORTS", "DERIVED_FROM", "INFLUENCES", "CATEGORIZED_UNDER", "PRESCRIBES", "APPLIES_TO"],
    },
    "课题5": {
        "name": "地块开发建设实施手册",
        "entity_focus": ["Plot", "District", "Indicator", "ThresholdValue", "Function", "Requirement", "Location"],
        "relationship_focus": ["HAS_INDICATOR", "HAS_FUNCTION", "HAS_REQUIREMENT", "LOCATED_IN", "PART_OF", "ADJACENT_TO", "HAS_THRESHOLD"],
    },
}

# ---------------------------------------------------------------------------
# All entity type definitions (shared across prompts)
# ---------------------------------------------------------------------------

ENTITY_TYPE_DEFINITIONS = """
实体类型定义：
- Topic: 课题/研究主题 (如 "高强度片区界定与分类")
- Standard: 标准/规范文件 (如 "环境性能评估与优化指标标准")
- PerformanceDimension: 性能评估维度 (如 "环境性能", "安全性能", "健康性能", "人本性能", "使用效能")
- Indicator: 可量化的指标 (如 "容积率", "建筑限高", "降温率", "安全感", "绿视率", "避难人口潜在容纳率")
- ThresholdValue: 指标的阈值/评级标准 (如 "容积率 A级: >=70%", "建筑密度 >=40%")
- EvaluationMethod: 评估方法/技术工具 (如 "深度学习热舒适预测", "EEG脑电测量", "眼动追踪", "语义分割")
- DesignGuideline: 设计导则/指南 (如 "空间形态设计导则", "人本性能空间优化设计导则")
- SpatialElement: 空间要素/场所类型 (如 "街道空间", "绿地广场", "地下公共空间", "近地空间基面")
- ResearchFinding: 研究发现/结论 (如 "绿视率与安全感正相关(r=0.800)", "建筑信息密度与归属感正相关(r=0.612)")
- Plot: 地块编号 (如 "DU01-01", "DU02-03")
- District: 片区/区域 (如 "深圳湾超级总部基地", "丽泽金融商务区")
- Function: 功能类型 (如 "办公", "商业", "文化", "居住")
- Requirement: 管控要求 (如 "塔楼高度>=490m", "贴线率>=70%")
- Location: 位置名称 (如 "后海中心区", "南山区")
- Document: 文档 (由系统自动创建，不需要提取)
"""

# ---------------------------------------------------------------------------
# All relationship type definitions
# ---------------------------------------------------------------------------

RELATIONSHIP_TYPE_DEFINITIONS = """
关系类型定义：
- DEFINES: Standard -> Indicator (标准定义了某个指标, 属性: threshold, condition)
- EVALUATES: Standard -> PerformanceDimension (标准评估某个性能维度)
- HAS_THRESHOLD: Indicator -> ThresholdValue (指标有阈值/评级标准)
- CATEGORIZED_UNDER: Indicator -> PerformanceDimension (指标归属于某个性能维度)
- MEASURED_BY: Indicator -> EvaluationMethod (指标通过某种方法测量)
- PRESCRIBES: DesignGuideline -> Requirement (导则规定了某项要求)
- APPLIES_TO: DesignGuideline -> SpatialElement (导则适用于某类空间要素)
- SUPPORTS: ResearchFinding -> Indicator (研究发现支撑了某个指标, 属性: evidence_strength, r_value)
- DERIVED_FROM: ResearchFinding -> Document (研究发现来源于某文档)
- INFLUENCES: Indicator -> Indicator (指标之间的影响关系, 属性: direction[正/负], strength)
- HAS_INDICATOR: Plot -> Indicator (地块拥有某指标, 属性: value, unit)
- HAS_FUNCTION: Plot -> Function (地块具有某功能)
- HAS_REQUIREMENT: Plot -> Requirement (地块有管控要求)
- LOCATED_IN: Plot -> Location (地块位于某位置)
- PART_OF: Plot -> District (地块属于某片区)
- ADJACENT_TO: Plot -> Plot (地块相邻)
- BELONGS_TO: Document -> Topic (文档属于某课题)
"""

# ---------------------------------------------------------------------------
# Topic-specific extraction prompts
# ---------------------------------------------------------------------------

TOPIC_PROMPTS: Dict[str, str] = {}

# -- 课题1: 标准与分类 --
TOPIC_PROMPTS["课题1"] = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

本文档属于"高强度片区界定与分类标准"类别，重点关注：
1. 标准/规范名称 (Standard)
2. 性能评估维度 (PerformanceDimension): 如环境性能、安全性能、健康性能
3. 可量化指标 (Indicator): 如容积率、建筑密度、轨交站等效密度、避难人口容纳率、降温率
4. 阈值/评级 (ThresholdValue): 如 "A级: >=70%", "容积率>=3.8"
5. 评估方法 (EvaluationMethod): 如果文中提到了评估计算方法

{entity_definitions}

重点提取的关系：
- DEFINES: 标准 -> 指标 (标准定义了哪些指标)
- EVALUATES: 标准 -> 性能维度 (标准评估哪个维度)
- HAS_THRESHOLD: 指标 -> 阈值 (指标的评级标准)
- CATEGORIZED_UNDER: 指标 -> 性能维度 (指标属于哪个维度)
- MEASURED_BY: 指标 -> 评估方法

{output_format}

文本：
{text}"""

# -- 课题2: 热舒适研究 --
TOPIC_PROMPTS["课题2"] = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

本文档属于"热舒适与温度分析研究"类别，重点关注：
1. 研究发现 (ResearchFinding): 如 "GAN模型预测SSIM达89.3%", "建筑密度影响风道形成"
2. 评估方法/工具 (EvaluationMethod): 如 "pix2pix算法", "UTCI模拟", "Ladybug Tools", "ENVI-met"
3. 指标 (Indicator): 如 "UTCI", "平均辐射温度", "建筑密度", "绿化覆盖率"
4. 空间要素 (SpatialElement): 如 "街道空间", "建筑布局", "绿化布局"

{entity_definitions}

重点提取的关系：
- SUPPORTS: 研究发现 -> 指标 (发现支撑了哪个指标的重要性)
- MEASURED_BY: 指标 -> 评估方法 (指标用什么方法测量)
- INFLUENCES: 指标 -> 指标 (如 "建筑密度" 影响 "UTCI", direction="负")

{output_format}

文本：
{text}"""

# -- 课题3: 设计导则 --
TOPIC_PROMPTS["课题3"] = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

本文档属于"空间形态设计导则"类别，重点关注：
1. 设计导则名称 (DesignGuideline): 如 "空间形态设计导则", "全时利用导则"
2. 空间要素 (SpatialElement): 如 "地块", "近地空间基面", "步行网络", "立体景观"
3. 管控要求 (Requirement): 如 "地块面积5000-20000m2", "路网密度8-10km/km2", "公共物业比例15-30%"
4. 功能类型 (Function): 如 "办公", "商业", "文化", "居住", "公共服务"
5. 指标 (Indicator): 如 "容积率", "路网密度", "公共物业比例", "MPER连通效率"
6. 阈值 (ThresholdValue): 具体的数值要求

{entity_definitions}

重点提取的关系：
- PRESCRIBES: 导则 -> 要求 (导则规定了什么要求)
- APPLIES_TO: 导则 -> 空间要素 (导则适用于什么空间)
- HAS_THRESHOLD: 指标 -> 阈值 (指标的具体数值要求)
- INFLUENCES: 指标 -> 指标 (指标间的影响关系)

{output_format}

文本：
{text}"""

# -- 课题4: 人本性能研究 --
TOPIC_PROMPTS["课题4"] = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

本文档属于"人本性能研究与设计导则"类别，重点关注：
1. 研究发现 (ResearchFinding): 如 "绿视率与安全感正相关(r=0.800)", "建筑信息密度与归属感正相关"
   - 务必提取相关系数(r值)、样本量等量化信息作为属性
2. 空间要素 (SpatialElement): 如 "街道空间", "绿地广场", "公共空间", "步行道"
3. 指标 (Indicator): 如 "安全感", "归属感", "绿视率", "天空视率", "建筑视率", "标识设施密度"
4. 性能维度 (PerformanceDimension): 如 "人本性能", "识别性", "可达性", "包容性", "参与性", "共享性", "地域性"
5. 评估方法 (EvaluationMethod): 如 "EEG脑电测量", "眼动追踪", "问卷调查", "语义分割"
6. 设计导则 (DesignGuideline): 如 "人本性能空间优化设计导则"
7. 管控要求 (Requirement): 具体的设计要求

{entity_definitions}

重点提取的关系：
- SUPPORTS: 研究发现 -> 指标 (发现支撑了哪个指标, 属性: r_value, evidence_strength)
- INFLUENCES: 指标 -> 指标 (如 "绿视率" 正向影响 "安全感", direction="正", strength="强")
- CATEGORIZED_UNDER: 指标 -> 性能维度
- MEASURED_BY: 指标 -> 评估方法
- PRESCRIBES: 导则 -> 要求
- APPLIES_TO: 导则 -> 空间要素

{output_format}

文本：
{text}"""

# -- 课题5: 地块实施手册 --
TOPIC_PROMPTS["课题5"] = """你是一个城市规划知识图谱构建专家。请从以下文本中提取实体和关系。

本文档属于"地块开发建设实施手册"类别，重点关注：
1. 地块编号 (Plot): 如 DU01-01, DU02-03, DU06-05-1
2. 片区名称 (District): 如 "深圳湾超级总部基地", "后海中心区"
3. 指标 (Indicator): 如 "容积率", "建筑限高", "建筑密度", "绿地率", "退线距离", "停车位"
4. 阈值 (ThresholdValue): 具体的指标数值, 如 "容积率<=23.0", "限高<=120m"
5. 功能类型 (Function): 如 "办公", "商业", "文化", "居住", "酒店"
6. 管控要求 (Requirement): 如 "塔楼高度>=490m", "贴线率>=70%", "活力界面比例>=80%"
   - 区分强制性(应/须/不应/不可)和建议性(可/宜/不宜)要求
7. 位置 (Location): 地理位置名称

{entity_definitions}

重点提取的关系：
- HAS_INDICATOR: 地块 -> 指标 (属性: value, unit)
- HAS_THRESHOLD: 指标 -> 阈值 (具体数值)
- HAS_FUNCTION: 地块 -> 功能
- HAS_REQUIREMENT: 地块 -> 要求 (属性: mandatory=true/false)
- LOCATED_IN: 地块 -> 位置
- PART_OF: 地块 -> 片区
- ADJACENT_TO: 地块 -> 地块 (相邻地块)

{output_format}

文本：
{text}"""

# ---------------------------------------------------------------------------
# Table extraction prompt (shared, with topic-specific instructions injected)
# ---------------------------------------------------------------------------

TABLE_EXTRACTION_PROMPT = """你是一个城市规划知识图谱构建专家。以下文本包含一个结构化表格。
请从表格中提取实体和关系。

表格解析规则：
1. 识别行标题（通常是地块编号、指标名称、评估维度、空间要素等）
2. 识别列标题（通常是属性名称如"容积率"、"建筑限高"、等级如"A/B/C"等）
3. 对于每个有意义的单元格，提取行实体、列实体、以及它们之间的关系（单元格值作为关系属性）

{topic_specific_instructions}

{entity_definitions}

{output_format}

表格文本：
{text}"""

TABLE_TOPIC_INSTRUCTIONS: Dict[str, str] = {
    "课题1": """本表格可能包含：
- 指标评分表：指标名 -> 评级(A/B/C) -> 阈值范围
- 分类矩阵：维度 -> 强度等级 -> 片区类型
请重点提取 Indicator -> ThresholdValue 关系，以及 Indicator -> PerformanceDimension 归属关系。""",

    "课题2": """本表格可能包含：
- 模型性能对比表：方法名 -> 指标(SSIM/MAE/RMSE) -> 数值
- 城市参数表：城市 -> 建筑密度/容积率/绿化率 -> 数值
请重点提取 EvaluationMethod 和 Indicator 实体及其关系。""",

    "课题3": """本表格可能包含：
- 地块尺寸推荐表：用地类型 -> 推荐面积范围
- 功能混合比例表：片区类型 -> 公共物业比例
- 设计要素矩阵：空间要素 -> 设计要求
请重点提取 SpatialElement、Requirement、ThresholdValue 及其关系。""",

    "课题4": """本表格可能包含：
- 空间要素与性能维度关联矩阵：设计要素 x 性能维度
- 相关性分析表：空间变量 -> 相关系数 -> 显著性
- 眼动指标表：空间要素 -> 注视时长/次数/信息密度
请重点提取 ResearchFinding（含r值）、Indicator、SpatialElement 及 SUPPORTS/INFLUENCES 关系。""",

    "课题5": """本表格可能包含：
- 地块指标控制表：地块编号 -> 用地面积/容积率/限高/退线/停车位
- 管控要求矩阵：管控要素 -> 具体要求 -> 强制/建议
请重点提取 Plot -> HAS_INDICATOR -> Indicator（含value属性）关系，以及 Requirement（含mandatory属性）。""",
}

# ---------------------------------------------------------------------------
# Document-level context extraction prompt
# ---------------------------------------------------------------------------

DOCUMENT_CONTEXT_PROMPT = """你是一个城市规划知识图谱构建专家。请分析以下文档的开头部分，提取文档级别的关键信息。

请识别：
1. 文档类型：标准(Standard)、设计导则(DesignGuideline)、研究论文(ResearchFinding的来源)、实施手册(Plot相关)
2. 文档的核心主题实体（如标准名称、导则名称、研究主题）
3. 文档涉及的主要性能维度或研究领域

请以JSON格式返回：
{{
  "doc_type": "standard|guideline|research|manual",
  "anchor_entities": [
    {{"type": "Standard|DesignGuideline|District", "name": "实体名称", "properties": {{}}}}
  ],
  "topic_hint": "课题1|课题2|课题3|课题4|课题5",
  "main_dimensions": ["维度1", "维度2"]
}}

文档开头：
{text}"""

# ---------------------------------------------------------------------------
# Output format template (shared)
# ---------------------------------------------------------------------------

OUTPUT_FORMAT = """请以JSON格式返回，只返回JSON，不要其他文字：
{
  "entities": [
    {"type": "实体类型", "name": "实体名称", "properties": {"key": "value"}}
  ],
  "relationships": [
    {"from": "源实体名", "from_type": "源类型", "to": "目标实体名", "to_type": "目标类型", "type": "关系类型", "properties": {"key": "value"}}
  ]
}

注意：
1. name 应简洁明确，避免过长描述
2. 同一实体在不同地方出现时，name 应保持一致
3. properties 中包含有价值的属性（如数值、单位、等级、相关系数等）
4. 不要编造文本中没有的信息"""


def get_extraction_prompt(topic: str, text: str, is_table: bool = False,
                          doc_context: str = "") -> str:
    """
    Get the appropriate extraction prompt for a given topic and text.

    Args:
        topic: Topic identifier (e.g., "课题1")
        text: Text to extract from
        is_table: Whether the text contains a table
        doc_context: Optional document-level context to inject

    Returns:
        Formatted prompt string
    """
    if is_table:
        topic_instructions = TABLE_TOPIC_INSTRUCTIONS.get(topic, "")
        prompt = TABLE_EXTRACTION_PROMPT.format(
            topic_specific_instructions=topic_instructions,
            entity_definitions=ENTITY_TYPE_DEFINITIONS,
            output_format=OUTPUT_FORMAT,
            text=text[:3000],
        )
    else:
        template = TOPIC_PROMPTS.get(topic, TOPIC_PROMPTS["课题5"])
        prompt = template.format(
            entity_definitions=ENTITY_TYPE_DEFINITIONS,
            output_format=OUTPUT_FORMAT,
            text=text[:3000],
        )

    if doc_context:
        prompt = f"文档上下文信息：{doc_context}\n\n{prompt}"

    return prompt


def get_document_context_prompt(text: str) -> str:
    """
    Get the document-level context extraction prompt.

    Args:
        text: First portion of the document text

    Returns:
        Formatted prompt string
    """
    return DOCUMENT_CONTEXT_PROMPT.format(text=text[:3000])


def classify_topic_from_path(file_path: str) -> str:
    """
    Classify topic from file path.

    Args:
        file_path: File path containing topic folder name

    Returns:
        Topic identifier (e.g., "课题1"), defaults to "课题5"
    """
    for topic_key in TOPIC_CONFIG:
        if topic_key in file_path:
            return topic_key
    return "课题5"
