import re
from typing import Any, Dict, List


def extract_query_keywords_for_image_boost(query: str) -> List[str]:
    """Extract a few high-signal keywords from a Chinese query."""
    s = re.sub(r"[\s，,。.!！?？;；:：()（）\\[\\]{}<>《》\"'`/\\\\|]+", " ", (query or "").strip())
    s = re.sub(
        r"(请问|请|帮我|一下|麻烦|能否|可以|是否|什么是|是什么|指什么|什么意思|如何|为什么|多少|怎么|定义|含义)",
        " ",
        s,
    )
    s = s.replace("的", " ")
    parts = [p.strip() for p in s.split() if p.strip()]

    kws: List[str] = []
    for p in parts:
        for m in re.findall(r"[\u4e00-\u9fff]{2,}", p):
            kws.append(m)
        for m in re.findall(r"[A-Za-z0-9]{2,}", p):
            kws.append(m)

    uniq = sorted(set(kws), key=lambda x: (-len(x), x))
    return uniq[:10]


def ranked_results_contain_relevant_images(results: List[Dict[str, Any]], query: str) -> bool:
    """Return True when there is at least one image-bearing result likely relevant to the query."""
    kws = extract_query_keywords_for_image_boost(query or "")
    if not kws:
        kws = []

    for r in results or []:
        try:
            meta = r.get("metadata", {}) or {}
            text = str(r.get("text") or "")
            has_img = meta.get("has_image") is True or "![" in text
            if not has_img:
                continue
            if not kws:
                return True

            hay = (text or "").replace(" ", "")
            if any(kw in hay for kw in kws[:6]):
                return True
        except Exception:
            continue
    return False


def search_image_chunks_by_text(*, mongo, query: str, limit: int = 2) -> List[Dict[str, Any]]:
    """Best-effort Mongo text search over chunks, restricted to has_image=True."""
    q = (query or "").strip()
    if not q or mongo is None:
        return []

    docs = []
    try:
        docs = mongo.text_search("chunks", q, limit=limit, filter_query={"has_image": True})
    except Exception:
        try:
            keywords = extract_query_keywords_for_image_boost(q)
            if keywords:
                or_clauses = []
                for kw in keywords[:4]:
                    safe = re.escape(kw)
                    or_clauses.append({"text": {"$regex": safe}})
                    or_clauses.append({"enhanced_text": {"$regex": safe}})
                docs = mongo.find_by_query(
                    "chunks",
                    {"has_image": True, "$or": or_clauses},
                    limit=limit,
                    projection={
                        "_id": 1,
                        "doc_id": 1,
                        "chunk_index": 1,
                        "text": 1,
                        "enhanced_text": 1,
                        "section_title": 1,
                        "has_image": 1,
                        "has_table": 1,
                        "file_name": 1,
                        "category": 1,
                        "page": 1,
                        "page_end": 1,
                    },
                )
        except Exception:
            return []

    boosted: List[Dict[str, Any]] = []
    for doc in docs or []:
        chunk_id = str(doc.get("_id") or "").strip()
        text = str(doc.get("text") or doc.get("enhanced_text") or "").strip()
        if not chunk_id or not text:
            continue

        boosted.append(
            {
                "id": chunk_id,
                "source": "keyword",
                "text": text,
                "doc_id": doc.get("doc_id"),
                "chunk_index": doc.get("chunk_index"),
                "metadata": {
                    "file_name": doc.get("file_name", ""),
                    "category": doc.get("category", ""),
                    "section_title": doc.get("section_title", ""),
                    "has_table": bool(doc.get("has_table")),
                    "has_image": bool(doc.get("has_image")),
                    "page": doc.get("page"),
                    "page_end": doc.get("page_end"),
                },
                "score": float(doc.get("score") or 0.65),
            }
        )

    return boosted
