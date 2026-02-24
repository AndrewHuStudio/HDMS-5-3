import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.postprocess import sources as pp_sources


def test_filter_sources_drops_uncited_non_image_sources_by_default():
    sources = [
        {"citation_label": "1-1", "image_urls": []},
        {"citation_label": "1-2", "image_urls": []},
    ]
    kept = pp_sources.filter_sources_to_referenced(
        sources,
        referenced_labels={"1-1"},
    )
    assert [s["citation_label"] for s in kept] == ["1-1"]


def test_filter_sources_keeps_uncited_image_sources_when_enabled():
    sources = [
        {"citation_label": "1-1", "image_urls": []},
        {"citation_label": "1-2", "image_urls": ["/rag/documents/doc-1/image?ref=images/fig.png"]},
        {"citation_label": "2", "type": "graph"},
    ]
    kept = pp_sources.filter_sources_to_referenced(
        sources,
        referenced_labels={"1-1"},
        keep_image_sources=True,
    )
    # Keep cited chunk + one extra image-bearing chunk + graph source.
    assert [s["citation_label"] for s in kept] == ["1-1", "1-2", "2"]
