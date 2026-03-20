from __future__ import annotations

from typing import Any, Dict, List

from data_process.vector_process.ingestion.pipeline import IngestionPipeline


class _FakeMilvus:
    def __init__(self) -> None:
        self.deleted_collections: List[str] = []
        self.created: List[tuple[str, int]] = []

    def delete_collection(self, collection_name: str) -> None:
        self.deleted_collections.append(collection_name)

    def create_collection(
        self,
        collection_name: str,
        dimension: int,
        recreate_on_mismatch: bool = False,
        strict: bool = True,
    ) -> None:
        self.created.append((collection_name, dimension))


class _FakeMongo:
    def __init__(self) -> None:
        self.delete_calls: List[tuple[str, Dict[str, Any]]] = []

    def delete_many(self, collection: str, query: Dict[str, Any]) -> int:
        self.delete_calls.append((collection, dict(query)))
        return {"documents": 3, "chunks": 10, "document_versions": 2}.get(collection, 0)


class _FakeEmbedder:
    pass


class _FakeVision:
    pass


class _FakeChunker:
    pass


def test_clear_all_documents_clears_mongo_and_recreates_milvus_collection() -> None:
    milvus = _FakeMilvus()
    mongo = _FakeMongo()
    pipeline = IngestionPipeline(
        milvus_client=milvus,  # type: ignore[arg-type]
        mongodb_client=mongo,  # type: ignore[arg-type]
        embedding_service=_FakeEmbedder(),  # type: ignore[arg-type]
        vision_service=_FakeVision(),  # type: ignore[arg-type]
        chunker=_FakeChunker(),  # type: ignore[arg-type]
        neo4j_client=None,
    )

    result = pipeline.clear_all_documents()

    assert result["status"] == "success"
    assert result["deleted_documents"] == 3
    assert result["deleted_chunks"] == 10
    assert result["deleted_versions"] == 2
    assert milvus.deleted_collections
    assert milvus.created
