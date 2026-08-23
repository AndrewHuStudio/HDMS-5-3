import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from rag.postprocess.citation_labels import apply_citation_remap_to_sources
from rag.postprocess.citations import normalize_citations


def labels_of(sources):
    return [s["citation_label"] for s in sources]


class CitationLabelRemapCollisionTests(unittest.TestCase):
    def test_uncited_source_does_not_collide_with_remapped_cited_source(self):
        """The regression: answer cites 1-2 and 1-3, so remap is {1-2:1-1, 1-3:1-2}.

        Applying it naively left the uncited 1-1 untouched, producing two 1-1
        entries and losing 1-3 in the UI.
        """
        sources = [
            {"citation_label": "1-1", "chunk_id": "c1", "page": None},
            {"citation_label": "1-2", "chunk_id": "c2", "page": 6},
            {"citation_label": "1-3", "chunk_id": "c3", "page": None},
        ]
        remap = {"1-2": "1-1", "1-3": "1-2"}

        apply_citation_remap_to_sources(sources, remap)

        labels = labels_of(sources)
        self.assertEqual(len(labels), len(set(labels)), f"duplicate labels: {labels}")
        # Cited sources keep the labels the answer actually uses.
        self.assertEqual("1-1", sources[1]["citation_label"])
        self.assertEqual("1-2", sources[2]["citation_label"])
        # The uncited source is pushed onto the next free index.
        self.assertEqual("1-3", sources[0]["citation_label"])
        # Page metadata stays attached to its own chunk.
        self.assertEqual(6, next(s for s in sources if s["chunk_id"] == "c2")["page"])

    def test_labels_stay_unique_against_real_normalize_citations_output(self):
        sources = [
            {"citation_label": "1-1", "chunk_id": "c1"},
            {"citation_label": "1-2", "chunk_id": "c2"},
            {"citation_label": "1-3", "chunk_id": "c3"},
            {"citation_label": "2-1", "chunk_id": "c4"},
        ]
        valid = {s["citation_label"] for s in sources}
        answer = "结论A [1-2]，结论B [1-3]，结论C [2-1]。"

        _processed, remap = normalize_citations(answer, valid)
        apply_citation_remap_to_sources(sources, remap)

        labels = labels_of(sources)
        self.assertEqual(len(labels), len(set(labels)), f"duplicate labels: {labels}")

    def test_swapped_remap_does_not_lose_a_label(self):
        """A remap that swaps two labels must not collapse them onto one."""
        sources = [
            {"citation_label": "1-1", "chunk_id": "c1"},
            {"citation_label": "1-2", "chunk_id": "c2"},
        ]
        remap = {"1-1": "1-2", "1-2": "1-1"}

        apply_citation_remap_to_sources(sources, remap)

        self.assertEqual(["1-2", "1-1"], labels_of(sources))

    def test_graph_sources_and_empty_remap_are_untouched(self):
        sources = [
            {"citation_label": "1", "chunk_id": None},
            {"citation_label": "1-1", "chunk_id": "c1"},
        ]

        apply_citation_remap_to_sources(sources, {})

        self.assertEqual(["1", "1-1"], labels_of(sources))

    def test_graph_label_survives_document_remap(self):
        sources = [
            {"citation_label": "1", "chunk_id": None},
            {"citation_label": "1-1", "chunk_id": "c1"},
            {"citation_label": "1-2", "chunk_id": "c2"},
        ]

        apply_citation_remap_to_sources(sources, {"1-2": "1-1"})

        labels = labels_of(sources)
        self.assertEqual("1", labels[0])
        self.assertEqual(len(labels), len(set(labels)), f"duplicate labels: {labels}")


if __name__ == "__main__":
    unittest.main()
