import re
from typing import List, Optional, Tuple
from urllib.parse import quote


# Figure label matching used to align answer paragraphs with the correct images.
_FIGURE_LABEL_RE = re.compile(r"(?:图|Fig\.?)\s*([0-9]+(?:[.\-][0-9]+){1,3})", flags=re.IGNORECASE)


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
