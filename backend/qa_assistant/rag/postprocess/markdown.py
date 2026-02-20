import re


# Matches section numbers like （2.2）, (3.0.3), （3.0.2第3款） etc.
_SECTION_PAREN_RE = re.compile(
    r"[（(]\s*\d+(?:\.\d+){1,}(?:\s*(?:说明|详见|详述|条款|条|节|项|第\s*\d+\s*[条款节项]))?\s*[)）]"
)
# Matches mixed citation tokens like [1-1/3.0.3] and keeps only the [N-M] part.
_CITE_WITH_SECTION_RE = re.compile(r"\[(\d+-\d+)/(?:\d+(?:\.\d+){1,})\]")
# Strip leaked reasoning tags from the answer.
_THINK_TAG_RE = re.compile(r"</?think>", re.IGNORECASE)
# Ensure a blank line before list items that follow a non-blank line.
_LIST_NEEDS_BLANK_RE = re.compile(r"(\S[^\n]*)\n([ \t]*[-*\d]+[.)]\s)")
# Heading level normalization: top-level `#` → `##` (reserve h1 for page title).
_H1_RE = re.compile(r"^#\s", re.MULTILINE)
# Known top-level section titles that should stay as level-2 headings.
_MAJOR_SECTION_TITLE_RE = re.compile(r"^(?:检索综述|详细解析|相关概念|核心结论|结论|总结|小结)(?:\s*[:：].*)?$")
# Match subheadings (### and deeper).
_SUB_HEADING_RE = re.compile(r"^(#{3,})\s+(.+?)\s*$")
# Setext underline markers that can accidentally promote the previous body line to h2/h1.
_SETEXT_UNDERLINE_RE = re.compile(r"^\s*(?:={3,}|-{3,})\s*$")
# Best-effort markdown table detection (header + separator line).
_MD_TABLE_SEP_LINE_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")


def _strip_inline_md_wrappers(value: str) -> str:
    s = (value or "").strip()
    for wrapper in ("**", "__", "*", "_"):
        if s.startswith(wrapper) and s.endswith(wrapper) and len(s) > len(wrapper) * 2:
            s = s[len(wrapper):-len(wrapper)].strip()
    return s


def _normalize_heading_title(value: str) -> str:
    s = _strip_inline_md_wrappers(value)
    s = s.replace("\u3000", " ").strip()
    return s


def _extract_markdown_heading(line: str) -> tuple[int, str] | None:
    s = (line or "").strip()
    while s.startswith(">"):
        s = s[1:].lstrip()
    m = re.match(r"^#{1,6}\s+(.+?)\s*$", s)
    if not m:
        return None
    level = len(s.split(" ", 1)[0])
    return level, m.group(1).strip()


def _ensure_related_concepts_section(text: str) -> str:
    """
    Ensure `## 相关概念` exists between `## 检索综述` and `## 详细解析`.

    Some model outputs skip this heading and jump directly to an h2 concept title
    or plain text, which makes the section appear missing in UI.
    """
    lines = text.splitlines()
    if not lines:
        return text

    headings: list[tuple[int, int, str]] = []
    for idx, line in enumerate(lines):
        parsed = _extract_markdown_heading(line)
        if not parsed:
            continue
        level, raw_title = parsed
        title = _normalize_heading_title(raw_title)
        headings.append((idx, level, title))

    has_related = any(level == 2 and title.startswith("相关概念") for _, level, title in headings)
    if has_related:
        return text

    overview_idx = next((idx for idx, level, title in headings if level == 2 and title.startswith("检索综述")), None)
    detailed_idx = next((idx for idx, level, title in headings if level == 2 and title.startswith("详细解析")), None)
    if overview_idx is None or detailed_idx is None or detailed_idx <= overview_idx:
        return text

    # Look for an h2 heading between the two sections that isn't a known major title.
    insert_at: int | None = None
    for idx, level, title in headings:
        if idx <= overview_idx or idx >= detailed_idx or level != 2:
            continue
        if _MAJOR_SECTION_TITLE_RE.match(title):
            continue
        insert_at = idx
        break

    # Fallback: if no stray h2 heading found, look for the first non-blank
    # content line after 检索综述's block (skip the blockquote summary).
    if insert_at is None:
        scanning = False
        passed_overview_content = False
        for idx in range(overview_idx + 1, detailed_idx):
            stripped = lines[idx].strip()
            if not scanning:
                # Skip blank lines right after the heading.
                if not stripped:
                    scanning = True
                    continue
                scanning = True
            if not stripped:
                if passed_overview_content:
                    # Second blank region after overview content — good insertion point.
                    insert_at = idx
                    break
                continue
            if stripped.startswith(">") or stripped.startswith("检索资料清单"):
                passed_overview_content = True
                continue
            # Non-blank, non-blockquote line — this is concept content.
            insert_at = idx
            break

    if insert_at is None:
        return text

    # Insert heading + blank line so the next line is parsed as a separate
    # paragraph (not swallowed into the heading node by the markdown parser).
    lines.insert(insert_at, "")
    lines.insert(insert_at, "## 相关概念")
    return "\n".join(lines)


def _normalize_related_concepts_body(text: str) -> str:
    """
    Keep "相关概念" explanation in body/paragraph style.

    Demote ALL heading lines inside the section to plain text so the frontend
    renders them as normal body font instead of blue section titles.
    Exit when hitting a known major section boundary (## 详细解析, ## 结论, etc.)
    or any h2 heading that is a recognized major section.
    """
    lines = text.splitlines()
    in_related_concepts = False

    for i, line in enumerate(lines):
        stripped = line.strip()
        heading = _extract_markdown_heading(stripped)
        if heading:
            heading_level, raw_title = heading
            title = _normalize_heading_title(raw_title)
        else:
            heading_level = 0
            title = ""

        # Detect entry into the section.
        if heading and title.startswith("相关概念"):
            in_related_concepts = True
            continue

        if not in_related_concepts:
            continue

        if not stripped:
            continue

        # Exit on major section boundary (h2 with known title).
        if heading and heading_level == 2 and _MAJOR_SECTION_TITLE_RE.match(title):
            in_related_concepts = False
            continue

        # Demote any heading inside the section to plain text.
        if heading:
            lines[i] = title
            continue

        # Strip leading blockquote markers from body text.
        content = stripped
        while content.startswith(">"):
            content = content[1:].lstrip()

        # Prevent setext underlines from turning the previous body line into a heading.
        if _SETEXT_UNDERLINE_RE.match(content):
            lines[i] = ""
            continue

        match = _SUB_HEADING_RE.match(content)
        if match:
            lines[i] = _normalize_heading_title(match.group(2))
            continue

        if content != stripped:
            lines[i] = content

    return "\n".join(lines)


def sanitize_answer(text: str) -> str:
    """Structural cleanup of LLM output before citation/math processing."""
    if not text:
        return text

    # Remove leaked "section index" noise like （2.2）, (3.0.3).
    text = _SECTION_PAREN_RE.sub("", text)
    # Normalize mixed tokens like [1-1/3.0.3] → [1-1].
    text = _CITE_WITH_SECTION_RE.sub(r"[\1]", text)

    # Remove leaked <think> / </think> tags.
    text = _THINK_TAG_RE.sub("", text)

    # Demote h1 → h2 so the answer doesn't clash with the page title.
    text = _H1_RE.sub("## ", text)
    # Recover missing "相关概念" section heading for model outputs that skipped it.
    text = _ensure_related_concepts_section(text)
    # Ensure related concepts are presented as body text, not heading blocks.
    text = _normalize_related_concepts_body(text)

    # Ensure blank line before list items (markdown requires it for proper parsing).
    text = _LIST_NEEDS_BLANK_RE.sub(r"\1\n\n\2", text)

    return text


def extract_first_markdown_table(text: str):
    """Extract the first GFM-style markdown table block from text (if any)."""
    if not text:
        return None

    lines = str(text).splitlines()
    for i in range(len(lines) - 1):
        header = lines[i] or ""
        sep = lines[i + 1] or ""
        if "|" not in header:
            continue
        if not _MD_TABLE_SEP_LINE_RE.match(sep.strip()):
            continue

        j = i + 2
        while j < len(lines):
            row = lines[j] or ""
            if not row.strip():
                break
            if "|" not in row:
                break
            j += 1

        block = "\n".join(lines[i:j]).strip()
        if block:
            return block

    return None


_MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)]*)\)")


def strip_disallowed_markdown_images(text: str) -> str:
    """
    Strip markdown images that are likely to be broken in the web UI.

    Allowed src prefixes:
    - /rag/documents/   (our API)
    - http://, https://
    - data:

    Keeps code blocks/inline code untouched.
    """
    if not text:
        return text

    parts = re.split(r"(```[\s\S]*?```|`[^`\n]*`)", text)
    out: list[str] = []

    def _allowed(url: str) -> bool:
        u = (url or "").strip()
        if not u:
            return False
        if u.startswith("<") and u.endswith(">"):
            u = u[1:-1].strip()
        # Strip optional title after whitespace.
        u = u.split(None, 1)[0].strip()
        return u.startswith(("/rag/documents/", "http://", "https://", "data:"))

    def _repl(m: re.Match) -> str:
        alt = (m.group(1) or "").strip()
        raw = (m.group(2) or "").strip()
        if _allowed(raw):
            return m.group(0)
        # Replace broken image with plain alt text (no broken icon).
        return alt if alt else ""

    for i, seg in enumerate(parts):
        if i % 2 == 1:
            out.append(seg)
        else:
            out.append(_MD_IMAGE_RE.sub(_repl, seg))

    return "".join(out)
