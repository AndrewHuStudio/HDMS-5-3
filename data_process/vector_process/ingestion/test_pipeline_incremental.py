import unittest

from data_process.vector_process.ingestion.pipeline import IngestionPipeline


class _DummyMilvus:
    pass


class _DummyMongo:
    pass


class _DummyEmbedder:
    pass


class _DummyVision:
    pass


class _DummyChunker:
    pass


class PipelineIncrementalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pipeline = IngestionPipeline(
            milvus_client=_DummyMilvus(),
            mongodb_client=_DummyMongo(),
            embedding_service=_DummyEmbedder(),
            vision_service=_DummyVision(),
            chunker=_DummyChunker(),
            neo4j_client=None,
        )

    def test_diff_chunks_detects_changed_and_removed(self):
        new_chunks = [
            {"_id": "doc_0", "chunk_index": 0, "chunk_hash": "h0-new"},
            {"_id": "doc_2", "chunk_index": 2, "chunk_hash": "h2"},
        ]
        old_chunks = [
            {"_id": "doc_0", "chunk_index": 0, "chunk_hash": "h0-old"},
            {"_id": "doc_1", "chunk_index": 1, "chunk_hash": "h1"},
        ]

        diff = self.pipeline._diff_chunks(new_chunks, old_chunks)

        self.assertEqual(diff["unchanged"], 0)
        self.assertEqual(diff["removed"], 1)
        self.assertEqual(sorted(diff["remove_ids"]), ["doc_0", "doc_1"])
        self.assertEqual([chunk["_id"] for chunk in diff["upsert_chunks"]], ["doc_0", "doc_2"])

    def test_diff_chunks_keeps_unchanged(self):
        new_chunks = [
            {"_id": "doc_0", "chunk_index": 0, "chunk_hash": "same"},
            {"_id": "doc_1", "chunk_index": 1, "chunk_hash": "same-1"},
        ]
        old_chunks = [
            {"_id": "doc_0", "chunk_index": 0, "chunk_hash": "same"},
            {"_id": "doc_1", "chunk_index": 1, "chunk_hash": "same-1"},
        ]

        diff = self.pipeline._diff_chunks(new_chunks, old_chunks)

        self.assertEqual(diff["unchanged"], 2)
        self.assertEqual(diff["removed"], 0)
        self.assertEqual(diff["remove_ids"], [])
        self.assertEqual(diff["upsert_chunks"], [])


if __name__ == "__main__":
    unittest.main()
