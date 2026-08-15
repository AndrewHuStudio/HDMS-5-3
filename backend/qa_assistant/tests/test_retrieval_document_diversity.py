import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from rag.retriever import MultiSourceRetriever


def _chunk(doc_id: str, idx: int, score: float) -> dict:
    return {
        "id": f"{doc_id}-{idx}",
        "doc_id": doc_id,
        "file_name": f"{doc_id}.pdf",
        "text": f"{doc_id} relevant passage {idx}",
        "score": score,
        "source": "vector",
    }


class _StaticReranker:
    def rerank(self, *, query, documents, top_n):
        preferred_order = ["doc-a-1", "doc-a-2", "doc-a-3", "doc-a-4", "doc-a-5"]
        remaining = [doc for doc in documents if doc["id"] not in preferred_order]
        by_id = {doc["id"]: doc for doc in documents}
        ordered = [by_id[doc_id] for doc_id in preferred_order if doc_id in by_id]
        ordered.extend(remaining)
        return ordered[:top_n]


class _DiverseRetriever(MultiSourceRetriever):
    def __init__(self, reranker=None):
        super().__init__(
            milvus_client=None,
            mongodb_client=None,
            graph_store=None,
            embedder=None,
            reranker=reranker,
        )
        self.vector_limits = []
        self.keyword_limits = []

    def _vector_search(self, query, top_k):
        self.vector_limits.append(top_k)
        return [
            _chunk("doc-a", 1, 1.00),
            _chunk("doc-a", 2, 0.99),
            _chunk("doc-a", 3, 0.98),
            _chunk("doc-a", 4, 0.97),
            _chunk("doc-a", 5, 0.96),
            _chunk("doc-b", 1, 0.95),
            _chunk("doc-c", 1, 0.94),
        ][:top_k]

    def _keyword_search(self, query, top_k):
        self.keyword_limits.append(top_k)
        return []

    def _graph_search(self, query):
        return []


class RetrievalDocumentDiversityTests(unittest.TestCase):
    def test_fusion_keeps_other_documents_when_one_document_has_many_top_chunks(self):
        retriever = _DiverseRetriever()

        fused = retriever._fuse_results(
            vector_results=[
                _chunk("doc-a", 1, 1.00),
                _chunk("doc-a", 2, 0.99),
                _chunk("doc-a", 3, 0.98),
                _chunk("doc-a", 4, 0.97),
                _chunk("doc-a", 5, 0.96),
                _chunk("doc-b", 1, 0.95),
                _chunk("doc-c", 1, 0.94),
            ],
            graph_results=[],
            keyword_results=[],
            top_k=5,
            query="综合分析公共空间设计要求",
        )

        doc_ids = {item.get("doc_id") for item in fused}
        self.assertLessEqual(len(fused), 5)
        self.assertIn("doc-a", doc_ids)
        self.assertIn("doc-b", doc_ids)
        self.assertIn("doc-c", doc_ids)

    def test_retrieve_fetches_extra_candidates_and_preserves_diversity_after_rerank(self):
        retriever = _DiverseRetriever(reranker=_StaticReranker())

        results = retriever.retrieve(
            query="综合分析公共空间设计要求",
            top_k=5,
            use_vector=True,
            use_graph=False,
            use_keyword=True,
            enable_rerank=True,
        )

        doc_ids = {item.get("doc_id") for item in results["fused_results"]}
        self.assertGreater(retriever.vector_limits[0], 5)
        self.assertGreater(retriever.keyword_limits[0], 5)
        self.assertLessEqual(len(results["fused_results"]), 5)
        self.assertIn("doc-a", doc_ids)
        self.assertIn("doc-b", doc_ids)
        self.assertIn("doc-c", doc_ids)


if __name__ == "__main__":
    unittest.main()
