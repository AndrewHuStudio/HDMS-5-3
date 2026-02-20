import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


_PDF_KEY_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff]+")


def _normalize_pdf_key(name: str) -> str:
    base = Path(str(name or "")).name
    stem = base[:-4] if base.lower().endswith(".pdf") else Path(base).stem
    return _PDF_KEY_RE.sub("", stem).lower()


def collect_document_names(sources: List[Dict[str, Any]]) -> List[str]:
    if not sources:
        return []

    names: List[str] = []
    seen: set[str] = set()

    def _canonical_name(name: str) -> str:
        raw = str(name or "").strip()
        if not raw:
            return ""
        base = raw.replace("\\", "/").split("/")[-1].strip() or raw
        if base.lower().endswith(".pdf"):
            base = base[:-4] + ".pdf"
        return base

    def _sort_key(src: Dict[str, Any]) -> tuple:
        doc_num = src.get("doc_num")
        chunk_seq = src.get("chunk_seq")
        chunk_idx = chunk_seq if isinstance(chunk_seq, int) else 9999
        if isinstance(doc_num, int):
            return (0, doc_num, chunk_idx, str(src.get("name") or ""))
        return (1, 9999, chunk_idx, str(src.get("name") or ""))

    for src in sorted(sources, key=_sort_key):
        if str(src.get("type") or "") != "document":
            continue
        name = _canonical_name(str(src.get("name") or ""))
        if not name:
            continue
        dedupe_key = _normalize_pdf_key(name) or name.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        names.append(name)

    return names


def collect_document_summary_items(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not sources:
        return []

    items: List[Dict[str, Any]] = []
    seen: set[str] = set()

    def _canonical_name(name: str) -> str:
        raw = str(name or "").strip()
        if not raw:
            return ""
        base = raw.replace("\\", "/").split("/")[-1].strip() or raw
        if base.lower().endswith(".pdf"):
            base = base[:-4] + ".pdf"
        return base

    def _sort_key(src: Dict[str, Any]) -> tuple:
        doc_num = src.get("doc_num")
        chunk_seq = src.get("chunk_seq")
        chunk_idx = chunk_seq if isinstance(chunk_seq, int) else 9999
        if isinstance(doc_num, int):
            return (0, doc_num, chunk_idx, str(src.get("name") or ""))
        return (1, 9999, chunk_idx, str(src.get("name") or ""))

    for src in sorted(sources, key=_sort_key):
        if str(src.get("type") or "") != "document":
            continue
        name = _canonical_name(str(src.get("name") or ""))
        if not name:
            continue
        dedupe_key = _normalize_pdf_key(name) or name.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        items.append(
            {
                "name": name,
                "section": str(src.get("section") or "").strip(),
                "page": src.get("page"),
                "score": src.get("score"),
            }
        )

    return items


def format_document_reason(item: Dict[str, Any]) -> str:
    parts: List[str] = []
    section = str(item.get("section") or "").strip()
    if section:
        parts.append(f"命中章节“{section}”")
    page = item.get("page")
    if isinstance(page, int) and page > 0:
        parts.append(f"定位到第{page}页")
    if not parts:
        return "提供与问题直接相关的原文依据"
    return "；".join(parts)


def extract_first_json_object(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def build_summary_analysis_block(
    summary_items: List[Dict[str, Any]],
    *,
    llm_reason_overrides: Optional[List[str]] = None,
    llm_summary_override: Optional[str] = None,
) -> str:
    circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"]

    def _idx(i: int) -> str:
        return circled[i - 1] if 1 <= i <= len(circled) else f"{i}."

    def _display_name(raw: str) -> str:
        cleaned = re.sub(r"(?i)\.pdf$", "", (raw or "").strip())
        return cleaned or raw

    def _escape_markdown_text(text: str) -> str:
        return re.sub(r"([\\`*_{}\[\]()#+\-.!|])", r"\\\1", text)

    def _styled_doc_name(raw: str, idx: int) -> str:
        escaped = _escape_markdown_text(_display_name(raw))
        return f"*{escaped}*"

    doc_names = "；".join(
        f"{_idx(i)}{_styled_doc_name(item['name'], i)}" for i, item in enumerate(summary_items, start=1)
    )
    reason_parts: List[str] = []
    for idx, item in enumerate(summary_items, start=1):
        reason_text = (
            llm_reason_overrides[idx - 1].strip()
            if llm_reason_overrides and idx - 1 < len(llm_reason_overrides)
            else format_document_reason(item)
        )
        reason_parts.append(f"{_idx(idx)}{reason_text}")
    merged_reasons = "；".join(reason_parts)
    natural_summary = (llm_summary_override or "").strip()
    if not natural_summary:
        natural_summary = "上述资料共同构成了本次回答的依据链条。"
    block = (
        "> 检索资料清单与引用分析："
        f"检索资料清单：{doc_names}。"
        f"引用定位：{merged_reasons}。"
        f"{natural_summary}"
    )
    return block


def inject_summary_document_names(
    answer: str,
    sources: List[Dict[str, Any]],
    *,
    llm_reason_overrides: Optional[List[str]] = None,
    llm_summary_override: Optional[str] = None,
) -> str:
    if answer and ("涉及资料" in answer or "检索资料清单" in answer):
        return answer

    summary_items = collect_document_summary_items(sources)
    if not summary_items:
        return answer

    block = build_summary_analysis_block(
        summary_items,
        llm_reason_overrides=llm_reason_overrides,
        llm_summary_override=llm_summary_override,
    )
    if not answer:
        return f"## 检索综述\n\n{block.strip()}"

    summary_heading_re = re.compile(r"^##\s*(?:[一二三四五六七八九十]+、\s*)?检索综述\s*$", re.MULTILINE)
    m = summary_heading_re.search(answer)
    if m:
        rest = answer[m.end() :]
        stripped = rest.lstrip("\n")
        skipped = len(rest) - len(stripped)
        para_end = stripped.find("\n\n")
        if para_end == -1:
            para_end = len(stripped)
        insert_at = m.end() + skipped + para_end
        return f"{answer[:insert_at]}\n\n{block}{answer[insert_at:]}"

    return f"## 检索综述\n\n{block}\n\n{answer}"
