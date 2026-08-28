import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

from core import config as app_config


def _truncate_text(value: str, limit: int) -> str:
    if limit <= 0 or len(value) <= limit:
        return value

    clipped = value[:limit]
    last_img_start = clipped.rfind("![")
    if last_img_start != -1 and clipped.find(")", last_img_start) == -1:
        clipped = clipped[:last_img_start].rstrip()
    return f"{clipped}..."


def _looks_like_opaque_image_name(value: str) -> bool:
    s = str(value or "").strip()
    if not s:
        return False
    base = s.replace("\\", "/").split("/")[-1]
    stem = base.rsplit(".", 1)[0]
    if len(stem) < 20:
        return False
    return bool(
        re.match(r"^[A-Fa-f0-9-]{20,}$", stem)
        or re.match(r"^[A-Za-z0-9_]{24,}$", stem)
    )


def build_context_and_sources(
    *,
    retrieval_results: Dict[str, Any],
    query: str,
    mongo,
    ranked_results_contain_relevant_images: Callable[[List[Dict[str, Any]], str], bool],
    search_image_chunks_by_text: Callable[[str, int], List[Dict[str, Any]]],
    extract_image_refs: Callable[[str], List[str]],
    extract_image_figure_meta: Callable[[str], tuple[list[str], list[str]]],
    extract_image_descriptions: Callable[[str], List[str]],
    build_image_semantic_hint: Callable[..., str],
    rewrite_image_urls: Callable[[str, str], str],
    extract_first_markdown_table: Callable[[str], Optional[str]],
    pdf_is_available: Callable[[str], bool],
    parse_page_like: Callable[[object], Tuple[Optional[int], Optional[int]]],
    infer_page_range_from_text: Callable[[str], Tuple[Optional[int], Optional[int]]],
) -> Tuple[str, List[Dict[str, Any]]]:
    """Build aligned context and citation sources from retrieval results."""
    ranked_results = retrieval_results.get("fused_results") or []
    if not ranked_results:
        ranked_results = [
            *retrieval_results.get("vector_results", []),
            *retrieval_results.get("graph_results", []),
            *retrieval_results.get("keyword_results", []),
        ]

    if query and not ranked_results_contain_relevant_images(ranked_results, query):
        boost_limit = max(1, int(getattr(app_config, "QA_IMAGE_BOOST_LIMIT", 4)))
        boosted = search_image_chunks_by_text(query, boost_limit)
        if boosted:
            ranked_results = [*ranked_results, *boosted]

    seen_doc_keys: set[str] = set()
    seen_graph_keys: set[str] = set()
    doc_blocks: List[str] = []
    graph_blocks: List[str] = []
    sources: List[Dict[str, Any]] = []
    doc_group_map: Dict[str, Dict[str, Any]] = {}
    doc_group_order: List[str] = []
    graph_idx = 1
    chunk_doc_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    for result in ranked_results:
        source_type = str(result.get("source") or "")
        result_type = str(result.get("type") or "")

        if result_type in ("subgraph", "concept_match"):
            continue

        is_graph = source_type == "graph" or result_type in {"plot_info", "indicator_search"}

        if is_graph:
            if result_type == "plot_info":
                plot_name = str(result.get("plot_name") or "").strip()
                if not plot_name or plot_name in seen_graph_keys:
                    continue
                seen_graph_keys.add(plot_name)

                data = result.get("data", {}) or {}
                lines = [f"[{graph_idx}] 地块 {plot_name}："]
                indicators = data.get("indicators", []) if isinstance(data, dict) else []
                if indicators:
                    lines.append("指标：")
                    for ind in indicators[:6]:
                        if ind.get("indicator"):
                            lines.append(f"  - {ind['indicator']}: {ind.get('value', '未指定')}")

                graph_blocks.append("\n".join(lines))
                sources.append(
                    {
                        "type": "plot",
                        "name": plot_name,
                        "citation_label": str(graph_idx),
                        "section": None,
                        "source": "knowledge_graph",
                        "chunk_id": None,
                        "doc_id": None,
                        "chunk_index": None,
                        "page": None,
                        "page_end": None,
                        "score": None,
                        "quote": None,
                        "pdf_url": None,
                        "image_url": None,
                        "image_name": None,
                    }
                )
                graph_idx += 1
                continue

            indicator = str(result.get("indicator") or "").strip()
            graph_key = f"indicator:{indicator}" if indicator else f"graph:{len(graph_blocks)}"
            if graph_key in seen_graph_keys:
                continue
            seen_graph_keys.add(graph_key)

            data = result.get("data", [])
            lines = [f"[{graph_idx}] 指标查询：{indicator or '图谱结果'}"]
            if isinstance(data, list):
                for item in data[:5]:
                    if not isinstance(item, dict):
                        continue
                    plot_name = item.get("plot_name")
                    value = item.get("value")
                    if plot_name:
                        lines.append(f"  - {plot_name}: {value if value is not None else '未指定'}")

            graph_blocks.append("\n".join(lines))
            sources.append(
                {
                    "type": "graph",
                    "name": indicator or "图谱结果",
                    "citation_label": str(graph_idx),
                    "section": None,
                    "source": "knowledge_graph",
                    "chunk_id": None,
                    "doc_id": None,
                    "chunk_index": None,
                    "page": None,
                    "page_end": None,
                    "score": None,
                    "quote": None,
                    "pdf_url": None,
                    "image_url": None,
                    "image_name": None,
                }
            )
            graph_idx += 1
            continue

        text = str(result.get("text", "") or "").strip()
        if not text:
            continue

        chunk_id = str(result.get("id") or result.get("_id") or "").strip()
        dedup_key = chunk_id or text[:120]
        if dedup_key in seen_doc_keys:
            continue
        seen_doc_keys.add(dedup_key)

        metadata = result.get("metadata", {}) or {}
        doc_id = result.get("doc_id")
        file_name = metadata.get("file_name") or result.get("file_name") or "未知文档"

        chunk_doc: Optional[Dict[str, Any]] = None
        if chunk_id:
            if chunk_id in chunk_doc_cache:
                chunk_doc = chunk_doc_cache[chunk_id]
            else:
                chunk_doc = None
                if mongo is not None:
                    try:
                        chunk_doc = mongo.find_by_id("chunks", chunk_id)
                    except Exception:
                        chunk_doc = None
                chunk_doc_cache[chunk_id] = chunk_doc

        if not doc_id:
            doc_id = (
                metadata.get("doc_id")
                or metadata.get("source_doc_id")
                or (chunk_doc.get("doc_id") if isinstance(chunk_doc, dict) else None)
                or (chunk_doc.get("source_doc_id") if isinstance(chunk_doc, dict) else None)
            )
        if doc_id is not None:
            doc_id = str(doc_id).strip() or None

        section = (
            metadata.get("section_title")
            or result.get("section_title")
            or (chunk_doc.get("section_title") if isinstance(chunk_doc, dict) else "")
            or ""
        )

        require_local_pdf = bool(getattr(app_config, "QA_REQUIRE_LOCAL_PDF_FOR_SOURCES", False))
        if (
            require_local_pdf
            and isinstance(file_name, str)
            and file_name
            and not pdf_is_available(file_name)
        ):
            continue

        raw_page = (
            metadata.get("page")
            or metadata.get("page_number")
            or metadata.get("page_num")
            or result.get("page")
            or result.get("page_number")
            or (chunk_doc.get("page") if isinstance(chunk_doc, dict) else None)
            or (chunk_doc.get("page_number") if isinstance(chunk_doc, dict) else None)
            or (chunk_doc.get("page_num") if isinstance(chunk_doc, dict) else None)
        )
        page, page_end_from_raw_page = parse_page_like(raw_page)

        raw_page_end = (
            metadata.get("page_end")
            or result.get("page_end")
            or (chunk_doc.get("page_end") if isinstance(chunk_doc, dict) else None)
        )
        parsed_end_start, parsed_end = parse_page_like(raw_page_end)
        page_end: Optional[int] = None
        if parsed_end is not None:
            page_end = parsed_end
        elif parsed_end_start is not None and page is not None and parsed_end_start > page:
            page_end = parsed_end_start
        elif page_end_from_raw_page is not None:
            page_end = page_end_from_raw_page

        if page is None:
            inferred_page, inferred_page_end = infer_page_range_from_text(text)
            page = inferred_page
            if page_end is None:
                page_end = inferred_page_end

        raw_score = result.get("weighted_score", result.get("score"))
        score: Optional[float] = None
        if isinstance(raw_score, (int, float)):
            score = float(raw_score)

        pdf_url = (
            metadata.get("pdf_url")
            or metadata.get("pdf_path")
            or metadata.get("source_pdf_url")
            or metadata.get("source_pdf_path")
            or (f"/rag/documents/{doc_id}/pdf" if doc_id else None)
        )

        image_ref_text = text
        image_refs = extract_image_refs(image_ref_text)
        if not image_refs and isinstance(chunk_doc, dict):
            # Retrieval text can lose markdown image tokens after rerank/packing;
            # fall back to the persisted chunk body in Mongo to recover refs.
            fallback_text = str(chunk_doc.get("text") or chunk_doc.get("enhanced_text") or "").strip()
            if fallback_text:
                fallback_refs = extract_image_refs(fallback_text)
                if fallback_refs:
                    image_ref_text = fallback_text
                    image_refs = fallback_refs
        image_urls: List[str] = []
        image_names: List[str] = []
        image_figures: List[str] = []
        image_captions: List[str] = []
        for ref in image_refs:
            if doc_id:
                image_urls.append(f"/rag/documents/{doc_id}/image?ref={quote(ref)}")
                image_names.append(ref.split("/")[-1])
        image_url = image_urls[0] if image_urls else None
        image_name = image_names[0] if image_names else None

        image_descriptions: List[str] = []
        if image_refs:
            figs, caps = extract_image_figure_meta(image_ref_text)
            image_figures = figs[: len(image_refs)]
            image_captions = caps[: len(image_refs)]

            # Vision-model descriptions live only on the persisted chunk's
            # enhanced_text.  Ingestion de-duplicates them by description text,
            # so a count mismatch means we cannot tell which image each one
            # belongs to — drop them all rather than mislabel a figure.
            if isinstance(chunk_doc, dict):
                parsed = extract_image_descriptions(chunk_doc.get("enhanced_text") or "")
                if len(parsed) == len(image_refs):
                    image_descriptions = parsed

        rewritten_text = rewrite_image_urls(text, doc_id) if doc_id else text
        table_markdown = extract_first_markdown_table(rewritten_text)
        has_table = bool(
            metadata.get("has_table")
            or (chunk_doc.get("has_table") if isinstance(chunk_doc, dict) else False)
            or table_markdown
        )

        source_name = "vector_search" if source_type == "vector" else ("keyword_search" if source_type == "keyword" else "document_search")

        doc_group_key = doc_id or file_name
        if doc_group_key not in doc_group_map:
            doc_group_map[doc_group_key] = {
                "file_name": file_name,
                "doc_id": doc_id,
                "pdf_url": pdf_url,
                "source_name": source_name,
                "chunks": [],
            }
            doc_group_order.append(doc_group_key)

        doc_group_map[doc_group_key]["chunks"].append(
            {
                "text": rewritten_text,
                "chunk_id": chunk_id,
                "section": section,
                "page": page,
                "page_end": page_end,
                "score": score,
                "has_table": has_table,
                "table_markdown": table_markdown,
                "image_url": image_url,
                "image_name": image_name,
                "image_urls": image_urls,
                "image_names": image_names,
                "image_figures": image_figures,
                "image_captions": image_captions,
                "image_descriptions": image_descriptions,
            }
        )

    doc_num = 1
    for group_key in doc_group_order:
        group = doc_group_map[group_key]
        chunks = group["chunks"]
        chunk_limit = int(getattr(app_config, "QA_CONTEXT_CHUNK_MAX_CHARS", 0))
        quote_limit = int(getattr(app_config, "QA_CONTEXT_QUOTE_MAX_CHARS", 0))

        for chunk_seq, chunk in enumerate(chunks, start=1):
            label = f"{doc_num}-{chunk_seq}"

            display_text = _truncate_text(chunk["text"], chunk_limit)

            section_label = f" - {chunk['section']}" if chunk.get("section") else ""

            # One condensed semantic hint per image, shared by the prompt's
            # image catalog and the frontend's figure captions.  Raw vision
            # descriptions run ~800 chars, so only the hint goes on the wire.
            image_hints: List[str] = []
            figures = chunk.get("image_figures") or []
            captions = chunk.get("image_captions") or []
            names = chunk.get("image_names") or []
            descriptions = chunk.get("image_descriptions") or []
            for idx in range(len(chunk.get("image_urls") or [])):
                fig = str(figures[idx]).strip() if idx < len(figures) else ""
                cap = str(captions[idx]).strip() if idx < len(captions) else ""
                name = str(names[idx]).strip() if idx < len(names) else ""
                description = str(descriptions[idx]) if idx < len(descriptions) else ""
                image_hints.append(
                    build_image_semantic_hint(
                        description=description,
                        figure=fig,
                        caption=cap,
                        name=name,
                        ordinal=idx + 1,
                        caption_is_usable=not _looks_like_opaque_image_name(cap),
                        name_is_usable=not _looks_like_opaque_image_name(name),
                    )
                )

            image_hint = ""
            if chunk.get("image_urls"):
                hint_lines = [
                    f"  - [[IMG:{label}#{idx + 1}]] {hint}"
                    for idx, hint in enumerate(image_hints[:5])
                ]
                img_count = len(hint_lines)
                image_hint = (
                    f"\n[本片段包含 {img_count} 张图片；相关段落请优先使用如下 IMG 标记引用，不要输出图片文件名]\n"
                    + "图片目录（IMG 标记 -> 图片语义）：\n"
                    + "\n".join(hint_lines)
                    + "\n"
                )

            doc_blocks.append(f"[{label}] 来源：{group['file_name']}{section_label}{image_hint}\n{display_text}")

            quote_text = _truncate_text(chunk["text"], quote_limit)

            sources.append(
                {
                    "type": "document",
                    "name": group["file_name"],
                    "citation_label": label,
                    "doc_num": doc_num,
                    "chunk_seq": chunk_seq,
                    "section": chunk.get("section") or None,
                    "source": group["source_name"],
                    "chunk_id": chunk["chunk_id"] or None,
                    "chunk_ids": [chunk["chunk_id"]] if chunk["chunk_id"] else [],
                    "doc_id": group["doc_id"],
                    "chunk_index": None,
                    "page": chunk["page"],
                    "page_end": chunk["page_end"],
                    "score": chunk["score"],
                    "quote": quote_text,
                    "pdf_url": group["pdf_url"],
                    "has_table": bool(chunk.get("has_table")),
                    "table_markdown": chunk.get("table_markdown"),
                    "image_url": chunk["image_url"],
                    "image_name": chunk["image_name"],
                    "image_urls": chunk["image_urls"],
                    "image_names": chunk["image_names"],
                    "image_figures": chunk.get("image_figures") or [],
                    "image_captions": chunk.get("image_captions") or [],
                    "image_descriptions": chunk.get("image_descriptions") or [],
                    "image_hints": image_hints,
                }
            )

        doc_num += 1

    context = ""
    if doc_blocks:
        context += "## 相关文档内容\n\n"
        context += "\n\n".join(doc_blocks)
        context += "\n\n"

    if graph_blocks:
        context += "## 知识图谱信息\n\n"
        context += "\n\n".join(graph_blocks)
        context += "\n\n"

    return context, sources
