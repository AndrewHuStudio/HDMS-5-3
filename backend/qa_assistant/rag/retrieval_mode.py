from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


_DISABLED_MODES = {"none", "off", "disabled"}
_VECTOR_MODES = {"vector", "vector_only", "vector_keyword", "keyword_vector", "hybrid", "all"}
_GRAPH_MODES = {"hybrid", "all"}
_KEYWORD_MODES = {"vector_keyword", "keyword_vector", "hybrid", "all"}


@dataclass(frozen=True)
class RetrievalSelection:
    mode: str
    enabled: bool
    use_vector: bool
    use_graph: bool
    use_keyword: bool


def normalize_retrieval_mode(
    raw_mode: str | None,
    *,
    allowed_modes: Iterable[str],
    default_mode: str = "hybrid",
) -> str:
    mode = (raw_mode or "").strip().lower()
    allowed = {str(item).strip().lower() for item in allowed_modes if str(item).strip()}
    if default_mode not in allowed:
        allowed.add(default_mode)
    if not mode:
        return default_mode
    return mode if mode in allowed else default_mode


def resolve_retrieval_selection(
    *,
    use_retrieval: bool,
    raw_mode: str | None,
    allowed_modes: Iterable[str],
    default_mode: str = "hybrid",
    allow_keyword: bool = False,
) -> RetrievalSelection:
    mode = normalize_retrieval_mode(raw_mode, allowed_modes=allowed_modes, default_mode=default_mode)
    if (not use_retrieval) or (mode in _DISABLED_MODES):
        return RetrievalSelection(
            mode=mode,
            enabled=False,
            use_vector=False,
            use_graph=False,
            use_keyword=False,
        )

    wants_keyword = mode in _KEYWORD_MODES
    return RetrievalSelection(
        mode=mode,
        enabled=True,
        use_vector=mode in _VECTOR_MODES,
        use_graph=mode in _GRAPH_MODES,
        use_keyword=allow_keyword and wants_keyword,
    )
