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
        "你是数字化管控智能问答助手，基于上传的片区管控资料，为政府管理方与城市设计者提供条文导引、合规核查及空间优化建议。\n\n"
        "回答请优先保证可读性与自然表达，可按内容需要使用小标题或列表，但不要为了凑结构强行分节。\n"
        "当需要列出并列主点时，优先使用真正的 Markdown 有序列表（1. 2. 3. ...），不要用“一、二、三”替代顶层编号列表。\n"
        "如使用 Markdown 列表，请严格保证列表结构合法：有序列表必须使用连续编号（1. 2. 3. ...）。\n"
        "若某个编号项下还有子要点，子要点必须缩进为该编号项下的嵌套无序列表，不得顶格书写。\n"
        "不要在后续同级编号项重新从1开始；只有开始一个全新的独立列表时才能重新编号。\n"
        "数学公式只使用 $...$（行内）或 $$...$$（块级）\n"
        "正文中的资料引用必须使用 [N-M] 格式（例如 [1-1]、[2-3]），不要用①②③这类圈号作为正文引用。\n"
        "参考资料中若给出“图片目录（IMG 标记 -> 图片语义）”，当某个正文段落与目录中某张图的语义相关时，"
        "必须在该段落末尾插入对应的 [[IMG:N-M#K]] 标记，并逐字照抄目录中给出的标记形式。\n"
        "不要自行编造图号（如“图3.0.1”），也不要改写标记中的编号。\n"
        "严禁输出原始图片文件名或哈希串（例如 xxx.jpg / 307b272）。\n\n"
        "对相关信息的整理请使用Markdown表格来提升阅读感受。"
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
        if source_doc_nums:
            nums_str = "、".join(f"[{(source_doc_required_labels or {}).get(n, f'{n}-1')}]" for n in source_doc_nums)
            user_message += (
                f"【引用要求】以上参考资料共涉及 {len(source_doc_nums)} 份文档（编号 "
                + "、".join(str(n) for n in source_doc_nums)
                + f"）。请在`## 详细解析`中引用资料时使用 [N-M] 标记（至少包含 {nums_str}），"
                "确保主要文档内容都被纳入分析。\n\n"
            )
    elif not retrieval_hint:
        user_message += "当前未检索到直接相关的参考资料，请运用你的专业知识回答。\n\n"

    user_message += f"问题：{question}"
    messages.append({"role": "user", "content": user_message})

    return messages
