import re
from typing import Any, Dict, List, Optional, Tuple


_BRIEF_GREETING_RE = re.compile(r"[\s!,\.\?~\uFF01\uFF0C\u3002\uFF1F\uFF5E]+")


def is_brief_greeting(question: str) -> bool:
    normalized = _BRIEF_GREETING_RE.sub("", (question or "").strip().lower())
    if not normalized:
        return False
    return normalized in {
        "你好",
        "您好",
        "你好呀",
        "您好呀",
        "嗨",
        "哈喽",
        "在吗",
        "在不在",
        "hello",
        "hi",
        "hey",
    }


def is_identity_query(question: str) -> bool:
    normalized = _BRIEF_GREETING_RE.sub("", (question or "").strip().lower())
    if not normalized:
        return False

    return any(
        token in normalized
        for token in {
            "你是谁",
            "你是做什么的",
            "你能做什么",
            "你的能力",
            "你会什么",
            "whoareyou",
            "whoyouare",
            "whatcanyoudo",
            "yourability",
        }
    )


def build_history_summary(history: Optional[List[Dict[str, str]]]) -> str:
    if not history:
        return ""
    user_msgs = [
        msg["content"][:50]
        for msg in history[-4:]
        if msg.get("role") == "user" and msg.get("content", "").strip()
    ]
    return "|".join(user_msgs[-2:])


def build_doc_required_labels(sources: List[Dict[str, Any]]) -> Dict[int, str]:
    chosen: Dict[int, Tuple[int, str]] = {}
    for src in sources or []:
        doc_num = src.get("doc_num")
        label = str(src.get("citation_label") or "").strip()
        if not isinstance(doc_num, int) or doc_num <= 0:
            continue
        if "-" not in label:
            continue
        left, right = label.split("-", 1)
        if left != str(doc_num):
            continue
        try:
            chunk_idx = int(right)
        except Exception:
            continue
        prev = chosen.get(doc_num)
        if prev is None or chunk_idx < prev[0]:
            chosen[doc_num] = (chunk_idx, label)

    return {doc: item[1] for doc, item in chosen.items()}


def build_prompt(
    *,
    question: str,
    context: str,
    history: Optional[List[Dict[str, str]]] = None,
    retrieval_hint: Optional[str] = None,
    source_doc_nums: Optional[List[int]] = None,
    source_doc_required_labels: Optional[Dict[int, str]] = None,
) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []

    system_prompt = (
    "你是一位专业的数字化管控智能问答助手。你的核心任务是基于上传的片区管控资料，"
    "为政府管理方与城市设计者提供精准的条文导引、合规性核查以及空间优化建议。"
    "在输出内容时，请严格遵守以下规则："
    "1. 优先采用逻辑清晰、内容连贯的段落式表达，以简洁明快的短句为主，确保阅读节奏流畅，避免过度使用分点列表。"
    "2. 严禁直接输出未被正确解析的 LaTeX 渲染代码（如 \\text{} 或 \\geq），所有指标、数值、公式应以直观易读的文本或符号格式呈现。"
    "4. 当参考资料中包含图表或图像信息时，请在相关的描述段落中自然地进行引用说明。"
    "5. 根据内容逻辑自然排版，可使用小标题引导，严禁为了凑结构而强行分节。"
    )

    messages.append({"role": "system", "content": system_prompt})

    if history:
        for msg in history[-8:]:
            messages.append(
                {
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                }
            )

    user_message = ""

    if retrieval_hint:
        user_message += retrieval_hint + "\n\n"

    if context:
        user_message += f"参考资料：\n\n{context}\n\n---\n\n"
        if source_doc_nums and len(source_doc_nums) > 1:
            nums_str = "、".join(f"[{(source_doc_required_labels or {}).get(n, f'{n}-1')}]" for n in source_doc_nums)
            user_message += (
                f"【引用要求】以上参考资料共涉及 {len(source_doc_nums)} 份文档（编号 "
                + "、".join(str(n) for n in source_doc_nums)
                + f"）。请在`## 详细解析`中对每份文档至少引用一次（{nums_str} 均需出现），"
                "确保所有文档的内容都被纳入分析。\n\n"
            )
    elif not retrieval_hint:
        user_message += "当前未检索到直接相关的参考资料，请运用你的专业知识回答。\n\n"

    user_message += f"问题：{question}"
    messages.append({"role": "user", "content": user_message})

    return messages
