import re
from typing import List, Optional, Tuple
from urllib.parse import quote


# Figure label matching used to align answer paragraphs with the correct images.
_FIGURE_LABEL_RE = re.compile(r"(?:图|Fig\.?)\s*([0-9]+(?:[.\-][0-9]+){1,3})", flags=re.IGNORECASE)
_STRUCTURED_IMG_MARKER_RE = re.compile(r"\[\[\s*IMG\s*:\s*(\d{1,2}-\d{1,2})(?:#(\d{1,2}))?\s*\]\]", flags=re.IGNORECASE)
_DOC_FILE_IMAGE_MENTION_RE = re.compile(
    r"(?:见|参考|参见|详见)?\s*文档\s*(\d{1,2}-\d{1,2})[^。\n，；;）)]{0,80}?"
    r"[A-Za-z0-9_-]{4,}\.(?:png|jpe?g|webp|gif|bmp|svg)\b",
    flags=re.IGNORECASE,
)
_DOC_HASH_IMAGE_MENTION_RE = re.compile(
    r"(?:见|参考|参见|详见)?\s*文档\s*(\d{1,2}-\d{1,2})[^。\n，；;）)]{0,60}?"
    r"[A-Fa-f0-9]{6,}(?:\.(?:png|jpe?g|webp|gif|bmp|svg))?",
    flags=re.IGNORECASE,
)


def find_matching_bracket(text: str, start: int, opener: str, closer: str) -> int:
    if start >= len(text) or text[start] != opener:
        return -1

    depth = 1
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def extract_parenthesized(text: str, start: int):
    if start >= len(text) or text[start] != "(":
        return None, start

    depth = 1
    i = start + 1
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    return None, start + 1


def strip_image_ref(ref: str) -> str:
    cleaned = ref.strip()
    if not cleaned:
        return ""

    if cleaned.startswith("<"):
        end = cleaned.find(">")
        cleaned = cleaned[1:end] if end != -1 else cleaned[1:]
    else:
        title_match = re.match(r'^(.*?)(?:\s+["\'][^"\']*["\'])\s*$', cleaned)
        if title_match:
            cleaned = title_match.group(1)

    cleaned = cleaned.strip().strip("\"'")
    cleaned = cleaned.replace("\\ ", " ").replace("\\\\", "\\")
    cleaned = cleaned.split("#", 1)[0]
    cleaned = cleaned.split("?", 1)[0]
    return cleaned.strip()


def extract_image_refs(markdown_text: str) -> List[str]:
    refs: List[str] = []
    seen = set()

    idx = 0
    markdown = markdown_text or ""
    marker = "!["
    length = len(markdown)
    while idx < length:
        marker_idx = markdown.find(marker, idx)
        if marker_idx == -1:
            break

        alt_end = find_matching_bracket(markdown, marker_idx + 1, "[", "]")
        if alt_end == -1:
            idx = marker_idx + len(marker)
            continue

        pos = alt_end + 1
        while pos < length and markdown[pos].isspace():
            pos += 1

        if pos >= length or markdown[pos] != "(":
            idx = marker_idx + len(marker)
            continue

        raw_ref, next_idx = extract_parenthesized(markdown, pos)
        if raw_ref is None:
            idx = marker_idx + len(marker)
            continue

        ref = strip_image_ref(raw_ref)
        if ref and not ref.lower().startswith(("http://", "https://", "data:")) and ref not in seen:
            seen.add(ref)
            refs.append(ref)

        idx = next_idx

    return refs


def extract_primary_image_ref(text: str) -> Optional[str]:
    refs = extract_image_refs(text)
    return refs[0] if refs else None


def extract_image_figure_meta(text: str) -> Tuple[list[str], list[str]]:
    lines = (text or "").splitlines()
    figures: list[str] = []
    captions: list[str] = []

    refs = extract_image_refs(text or "")
    for ref in refs:
        i = 0
        for idx, line in enumerate(lines):
            if ref in line:
                i = idx
                break

        figure_label = ""
        caption_line = ""
        start = max(0, i - 2)
        end = min(len(lines), i + 3)
        for j in range(start, end):
            m = _FIGURE_LABEL_RE.search(lines[j])
            if not m:
                continue
            num = (m.group(1) or "").strip().replace("-", ".")
            if not num:
                continue
            figure_label = f"图{num}"
            caption_line = lines[j].strip()
            break

        figures.append(figure_label)
        captions.append(caption_line)

    return figures, captions


def rewrite_image_urls(text: str, doc_id: str) -> str:
    if not text or not doc_id:
        return text

    result_parts: list[str] = []
    idx = 0
    markdown = text
    marker = "!["
    length = len(markdown)

    while idx < length:
        marker_idx = markdown.find(marker, idx)
        if marker_idx == -1:
            result_parts.append(markdown[idx:])
            break

        result_parts.append(markdown[idx:marker_idx])

        alt_end = find_matching_bracket(markdown, marker_idx + 1, "[", "]")
        if alt_end == -1:
            result_parts.append(marker)
            idx = marker_idx + len(marker)
            continue

        alt_text = markdown[marker_idx + 2:alt_end]

        pos = alt_end + 1
        while pos < length and markdown[pos].isspace():
            pos += 1

        if pos >= length or markdown[pos] != "(":
            result_parts.append(markdown[marker_idx:pos])
            idx = pos
            continue

        raw_ref, next_idx = extract_parenthesized(markdown, pos)
        if raw_ref is None:
            result_parts.append(markdown[marker_idx:next_idx])
            idx = next_idx
            continue

        ref = strip_image_ref(raw_ref)

        if ref and not ref.lower().startswith(("http://", "https://", "data:")):
            api_url = f"/rag/documents/{doc_id}/image?ref={quote(ref)}"
            result_parts.append(f"![{alt_text}]({api_url})")
        else:
            result_parts.append(markdown[marker_idx:next_idx])

        idx = next_idx

    return "".join(result_parts)


def _format_structured_img_marker(
    label: str,
    raw_ordinal: Optional[str],
    valid_labels: Optional[set[str]],
) -> str:
    normalized_label = str(label or "").strip()
    if not normalized_label:
        return ""
    if valid_labels is not None and normalized_label not in valid_labels:
        return ""

    ordinal = 1
    try:
        parsed = int(str(raw_ordinal or "").strip())
        if parsed >= 1:
            ordinal = parsed
    except Exception:
        ordinal = 1
    return f"[[IMG:{normalized_label}#{ordinal}]]"


def normalize_image_reference_markers(text: str, valid_labels: Optional[set[str]] = None) -> str:
    """
    Normalize free-form document-image mentions into structured IMG markers.

    Examples:
    - 见文档3-1中的307b272.jpg -> [[IMG:3-1#1]]
    - [[img:3-1]] -> [[IMG:3-1#1]]
    """
    if not text:
        return text

    parts = re.split(r"(```[\s\S]*?```|`[^`\n]*`)", text)
    out: List[str] = []

    for idx, seg in enumerate(parts):
        if idx % 2 == 1:
            out.append(seg)
            continue

        def _marker_repl(match: re.Match) -> str:
            return _format_structured_img_marker(match.group(1), match.group(2), valid_labels)

        normalized = _STRUCTURED_IMG_MARKER_RE.sub(_marker_repl, seg)
        normalized = _DOC_FILE_IMAGE_MENTION_RE.sub(
            lambda m: _format_structured_img_marker(m.group(1), "1", valid_labels),
            normalized,
        )
        normalized = _DOC_HASH_IMAGE_MENTION_RE.sub(
            lambda m: _format_structured_img_marker(m.group(1), "1", valid_labels),
            normalized,
        )

        normalized = re.sub(
            r"(\[\[IMG:\d{1,2}-\d{1,2}#\d{1,2}\]\])(?:\s*\1)+",
            r"\1",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = (
            normalized
            .replace("（ ）", "")
            .replace("( )", "")
            .replace("（  ）", "")
            .replace("(  )", "")
        )
        out.append(normalized)

    return "".join(out)
