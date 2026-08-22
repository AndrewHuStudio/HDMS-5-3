"""
Local PDF availability index.

Citation sources must be backed by a PDF that actually exists on disk, otherwise
the frontend renders a citation the user cannot open.  This module builds a lazy,
process-wide index of normalized PDF stems under the project's data roots.
"""

import re
import threading
from pathlib import Path
from typing import Optional

_PDF_KEY_RE = re.compile(r"[^0-9A-Za-z一-鿿]+")
_PDF_INDEX_LOCK = threading.Lock()
_PDF_AVAILABLE_KEYS: Optional[set[str]] = None


def find_project_root() -> Path:
    """Walk up from this file to find the directory containing .env."""
    for parent in Path(__file__).resolve().parents:
        if (parent / ".env").exists():
            return parent
    return Path(__file__).resolve().parent


def normalize_pdf_key(name: str) -> str:
    """Reduce a filename to a comparable key (strip extension, punctuation, case)."""
    base = Path(str(name or "")).name
    stem = base[:-4] if base.lower().endswith(".pdf") else Path(base).stem
    return _PDF_KEY_RE.sub("", stem).lower()


def build_pdf_index(project_root: Path) -> set[str]:
    """
    Build a set of normalized keys for all PDFs present on disk.

    Used to ensure a strict invariant: any numbered citation source must have a local PDF.
    """
    roots = [
        project_root / "data" / "orginal_input",  # intentionally misspelled
        project_root / "data" / "original_input",
        project_root / "data" / "documents",
        project_root / "data" / "uploads",
    ]
    keys: set[str] = set()
    for root in roots:
        if not root.is_dir():
            continue
        try:
            for pdf in root.rglob("*.pdf"):
                if pdf.is_file():
                    keys.add(normalize_pdf_key(pdf.name))
        except Exception:
            # Skip unreadable roots; caller will simply see fewer available PDFs.
            continue
    return keys


def pdf_is_available(file_name: str) -> bool:
    """Return True if a local PDF matching the given filename is present in data roots."""
    global _PDF_AVAILABLE_KEYS
    key = normalize_pdf_key(file_name)
    if not key:
        return False

    if _PDF_AVAILABLE_KEYS is None:
        with _PDF_INDEX_LOCK:
            if _PDF_AVAILABLE_KEYS is None:
                _PDF_AVAILABLE_KEYS = build_pdf_index(find_project_root())

    return key in (_PDF_AVAILABLE_KEYS or set())
