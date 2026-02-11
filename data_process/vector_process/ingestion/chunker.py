"""
Document chunker for semantic text segmentation.
"""

import re
from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class DocumentChunker:
    """Chunks documents using semantic segmentation strategies."""

    _IMAGE_MARKER = "!["
    _TABLE_SEPARATOR_RE = re.compile(
        r"^\s*\|?\s*:?[-]{3,}\s*:?(\s*\|\s*:?[-]{3,}\s*:?\s*)+\|?\s*$"
    )

    def __init__(self, chunk_size: int = 800, overlap: int = 100):
        """
        Initialize document chunker.

        Args:
            chunk_size: Target chunk size in tokens (approximate)
            overlap: Number of tokens to overlap between chunks
        """
        if chunk_size <= 0:
            raise ValueError("chunk_size must be > 0")
        if overlap < 0:
            raise ValueError("overlap must be >= 0")
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_markdown(
        self,
        markdown_text: str,
        doc_id: str,
        metadata: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Chunk markdown document by semantic sections.

        Strategy:
        - Split by headers (# ## ###)
        - Split tables into manageable chunks
        - Maintain chunk size with overlap

        Args:
            markdown_text: Markdown content
            doc_id: Document identifier
            metadata: Document metadata

        Returns:
            List of chunk dictionaries with text, metadata, and flags
        """
        chunks = []

        # Split by headers
        sections = self._split_by_headers(markdown_text)

        for section in sections:
            section_title = section.get("title", "")
            section_content = section.get("content", "")

            blocks = self._split_section_into_blocks(section_content)
            for block in blocks:
                block_text = block.get("text", "")
                if not block_text.strip():
                    continue

                if block.get("is_table"):
                    table_chunks = self._split_table_block(block_text, section_title)
                    for table_chunk in table_chunks:
                        chunks.append({
                            "doc_id": doc_id,
                            "chunk_index": len(chunks),
                            "text": table_chunk,
                            "section_title": section_title,
                            "has_table": True,
                            "has_image": self._contains_image(table_chunk),
                            "metadata": metadata
                        })
                else:
                    sub_chunks = self._split_by_tokens(block_text, section_title)
                    for sub_chunk in sub_chunks:
                        chunks.append({
                            "doc_id": doc_id,
                            "chunk_index": len(chunks),
                            "text": sub_chunk,
                            "section_title": section_title,
                            "has_table": False,
                            "has_image": self._contains_image(sub_chunk),
                            "metadata": metadata
                        })

        logger.info(f"Chunked document {doc_id} into {len(chunks)} chunks")
        return chunks

    def _split_by_headers(self, text: str) -> List[Dict[str, str]]:
        """
        Split markdown by headers (# ## ###).

        Args:
            text: Markdown text

        Returns:
            List of sections with title and content
        """
        sections = []
        lines = text.split("\n")
        current_section = {"title": "", "content": ""}

        for line in lines:
            # Match headers (# ## ###)
            if re.match(r"^#{1,3}\s+", line):
                # Save previous section
                if current_section["content"].strip():
                    sections.append(current_section)
                # Start new section
                current_section = {
                    "title": line.strip("# ").strip(),
                    "content": ""
                }
            else:
                current_section["content"] += line + "\n"

        # Add last section
        if current_section["content"].strip():
            sections.append(current_section)

        return sections

    def _split_by_tokens(self, text: str, title: str) -> List[str]:
        """
        Split text into chunks by approximate token count.

        Uses word-based approximation for non-CJK text, and character-based
        splitting for mostly-CJK text.

        Args:
            text: Text to split
            title: Section title to prepend

        Returns:
            List of text chunks
        """
        # Prepend title if exists
        if title:
            text = f"## {title}\n\n{text}"

        if self._is_mostly_cjk(text):
            return self._split_by_chars(text)

        overlap = min(self.overlap, max(self.chunk_size - 1, 0))
        if self.overlap >= self.chunk_size:
            logger.debug(
                "overlap (%s) >= chunk_size (%s), clamping overlap to %s",
                self.overlap,
                self.chunk_size,
                overlap,
            )

        tokens = text.split()
        chunks: List[str] = []
        current_chunk: List[str] = []
        current_length = 0

        for token in tokens:
            current_chunk.append(token)
            current_length += 1

            if current_length >= self.chunk_size:
                chunks.append(" ".join(current_chunk))
                current_chunk = current_chunk[-overlap:] if overlap else []
                current_length = len(current_chunk)

        # Add remaining tokens
        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    def _contains_table(self, text: str) -> bool:
        """Check if text contains a markdown table separator."""
        return any(self._is_table_separator(line) for line in text.splitlines())

    def _contains_image(self, text: str) -> bool:
        """Check if text contains image references."""
        return next(self._iter_image_refs(text), None) is not None

    def _is_table_separator(self, line: str) -> bool:
        return bool(self._TABLE_SEPARATOR_RE.match(line.strip()))

    def _count_table_columns(self, line: str) -> int:
        stripped = line.strip()
        if not stripped or "|" not in stripped:
            return 0
        if stripped.startswith("|"):
            stripped = stripped[1:]
        if stripped.endswith("|"):
            stripped = stripped[:-1]
        if not stripped:
            return 0
        return len(stripped.split("|"))

    def _is_table_row(self, line: str, expected_columns: Optional[int] = None) -> bool:
        stripped = line.strip()
        if not stripped or "|" not in stripped:
            return False

        has_border_pipes = stripped.startswith("|") or stripped.endswith("|")
        has_multiple_pipes = stripped.count("|") >= 2
        if not (has_border_pipes or has_multiple_pipes):
            return False

        columns = self._count_table_columns(stripped)
        if columns < 2:
            return False

        if expected_columns and expected_columns >= 2:
            return columns == expected_columns
        return True

    def _split_section_into_blocks(self, text: str) -> List[Dict[str, Any]]:
        """
        Split section into table and non-table blocks.
        """
        lines = text.splitlines()
        blocks: List[Dict[str, Any]] = []
        buffer: List[str] = []
        i = 0

        while i < len(lines):
            line = lines[i]
            if self._is_table_separator(line):
                header_line = None
                expected_columns = self._count_table_columns(line)
                if i - 1 >= 0 and self._is_table_row(lines[i - 1]):
                    header_line = lines[i - 1]
                    if buffer and buffer[-1] == header_line:
                        buffer.pop()
                    expected_columns = self._count_table_columns(header_line) or expected_columns
                if buffer:
                    block_text = "\n".join(buffer).strip()
                    if block_text:
                        blocks.append({"text": block_text, "is_table": False})
                    buffer = []

                table_lines = []
                if header_line:
                    table_lines.append(header_line)
                table_lines.append(line)
                i += 1
                while i < len(lines) and self._is_table_row(lines[i], expected_columns):
                    table_lines.append(lines[i])
                    i += 1
                block_text = "\n".join(table_lines).strip()
                if block_text:
                    blocks.append({"text": block_text, "is_table": True})
                continue

            buffer.append(line)
            i += 1

        if buffer:
            block_text = "\n".join(buffer).strip()
            if block_text:
                blocks.append({"text": block_text, "is_table": False})

        return blocks

    def _split_table_block(self, text: str, title: str) -> List[str]:
        """
        Split a markdown table block into multiple chunks.
        """
        lines = [line for line in text.splitlines() if line.strip()]
        sep_idx = None
        for idx, line in enumerate(lines):
            if self._is_table_separator(line):
                sep_idx = idx
                break

        if sep_idx is None:
            return self._split_by_tokens(text, title)

        header_lines = lines[:sep_idx + 1]
        rows = lines[sep_idx + 1:]

        prefix = f"## {title}\n\n" if title else ""
        header_text = "\n".join(header_lines)
        base_text = f"{prefix}{header_text}"
        base_tokens = self._count_tokens(base_text)

        chunks: List[str] = []
        current_rows: List[str] = []
        current_tokens = base_tokens

        for row in rows:
            row_tokens = self._count_tokens(row)
            if current_rows and current_tokens + row_tokens > self.chunk_size:
                joined_rows = "\n".join(current_rows)
                chunks.append(f"{base_text}\n{joined_rows}")
                current_rows = [row]
                current_tokens = base_tokens + row_tokens
            else:
                current_rows.append(row)
                current_tokens += row_tokens

        if current_rows:
            joined_rows = "\n".join(current_rows)
            chunks.append(f"{base_text}\n{joined_rows}")
        elif not rows:
            chunks.append(base_text)

        return chunks

    def _split_by_chars(self, text: str) -> List[str]:
        chars = list(text)
        chunks: List[str] = []
        start = 0
        length = len(chars)
        overlap = min(self.overlap, max(self.chunk_size - 1, 0))
        step = max(self.chunk_size - overlap, 1)

        while start < length:
            end = min(length, start + self.chunk_size)
            chunks.append("".join(chars[start:end]))
            if end >= length:
                break
            start += step

        return chunks

    def _is_mostly_cjk(self, text: str) -> bool:
        if not text:
            return False
        cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
        if cjk == 0:
            return False
        whitespace = len(re.findall(r"\s", text))
        ratio_cjk = cjk / max(len(text), 1)
        ratio_ws = whitespace / max(len(text), 1)
        return ratio_cjk >= 0.2 and ratio_ws < 0.2

    def _count_tokens(self, text: str) -> int:
        if not text:
            return 0
        if self._is_mostly_cjk(text):
            return len([ch for ch in text if not ch.isspace()])
        return len(text.split())

    def extract_image_refs(self, markdown: str) -> List[str]:
        """
        Extract image references from markdown.
        """
        refs: List[str] = []
        for raw_ref in self._iter_image_refs(markdown):
            ref = self._strip_image_ref(raw_ref)
            if ref:
                refs.append(ref)
        seen = set()
        ordered: List[str] = []
        for ref in refs:
            if ref in seen:
                continue
            seen.add(ref)
            ordered.append(ref)
        return ordered

    def _iter_image_refs(self, markdown: str):
        idx = 0
        length = len(markdown)

        while idx < length:
            marker_idx = markdown.find(self._IMAGE_MARKER, idx)
            if marker_idx == -1:
                break

            alt_start = marker_idx + 1
            alt_end = self._find_matching_bracket(markdown, alt_start, "[", "]")
            if alt_end == -1:
                idx = marker_idx + len(self._IMAGE_MARKER)
                continue

            pos = alt_end + 1
            while pos < length and markdown[pos].isspace():
                pos += 1

            if pos >= length or markdown[pos] != "(":
                idx = marker_idx + len(self._IMAGE_MARKER)
                continue

            raw_ref, next_idx = self._extract_parenthesized(markdown, pos)
            if raw_ref is None:
                idx = marker_idx + len(self._IMAGE_MARKER)
                continue

            yield raw_ref
            idx = next_idx

    def _find_matching_bracket(self, text: str, start: int, opener: str, closer: str) -> int:
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

    def _extract_parenthesized(self, text: str, start: int):
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

    def normalize_image_ref(self, ref: str) -> str:
        """
        Normalize image reference for matching.
        """
        if not ref:
            return ""
        ref = self._strip_image_ref(ref)
        ref = ref.replace("\\", "/")
        if ref.startswith("./"):
            ref = ref[2:]
        return ref

    def _strip_image_ref(self, ref: str) -> str:
        cleaned = ref.strip()
        if not cleaned:
            return ""

        # CommonMark allows destinations with spaces when wrapped by <...>.
        if cleaned.startswith("<"):
            end = cleaned.find(">")
            if end != -1:
                cleaned = cleaned[1:end]
            else:
                cleaned = cleaned[1:]
        else:
            # Preserve spaces in file names and only strip an optional quoted title.
            title_match = re.match(r"^(.*?)(?:\s+[\"'][^\"']*[\"'])\s*$", cleaned)
            if title_match:
                cleaned = title_match.group(1)

        cleaned = cleaned.strip().strip("\"'")
        cleaned = cleaned.replace("\\(", "(").replace("\\)", ")")
        cleaned = cleaned.replace("\\ ", " ").replace("\\\\", "\\")
        cleaned = cleaned.split("#", 1)[0]
        cleaned = cleaned.split("?", 1)[0]
        return cleaned.strip()

    def extract_image_context(
        self,
        markdown: str,
        img_ref: str,
        window: int = 200
    ) -> str:
        """
        Extract surrounding text around image reference.

        Args:
            markdown: Full markdown text
            img_ref: Image reference path
            window: Number of characters before/after

        Returns:
            Context text around image
        """
        candidates = [img_ref, self.normalize_image_ref(img_ref)]
        candidates.append(candidates[-1].replace("/", "\\"))

        for candidate in candidates:
            if not candidate:
                continue
            idx = markdown.find(candidate)
            if idx != -1:
                start = max(0, idx - window)
                end = min(len(markdown), idx + window)
                return markdown[start:end]

        return ""
