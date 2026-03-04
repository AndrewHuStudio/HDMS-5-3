from __future__ import annotations

from typing import Any, Dict, List, Optional

from data_process.KG_process.graph_store import GraphStoreService
from data_process.core.database.neo4j_client import Neo4jClient


class _FakeNeo4j:
    def __init__(self) -> None:
        self.merge_calls: List[Dict[str, Any]] = []
        self._node_seq = 0

    def merge_document(
        self,
        doc_id: str,
        file_name: str = "",
        file_path: str = "",
        kg_status: str = "in_progress",
        extra_props: Optional[Dict[str, Any]] = None,
    ) -> str:
        self.merge_calls.append(
            {
                "doc_id": doc_id,
                "file_name": file_name,
                "file_path": file_path,
                "kg_status": kg_status,
                "extra_props": dict(extra_props or {}),
            }
        )
        return "doc-node-id"

    def find_node_by_property(self, label: str, property_name: str, property_value: Any) -> Optional[Dict[str, Any]]:
        return None

    def create_node(self, label: str, properties: Dict[str, Any]) -> str:
        self._node_seq += 1
        return f"node-{self._node_seq}"

    def batch_merge_relationships(self, rel_type: str, rels: List[Dict[str, Any]]) -> int:
        return len(rels)


def test_graph_store_updates_chunk_progress_and_finishes_at_100() -> None:
    neo4j = _FakeNeo4j()
    service = GraphStoreService(
        neo4j_client=neo4j,  # type: ignore[arg-type]
        llm_base_url="http://example.invalid",
        llm_api_key="x",
        llm_model="mock",
    )

    chunks = [{"text": "DU01-01 容积率 3.5"} for _ in range(6)]
    result = service.build_graph_from_document(
        doc_id="doc-1",
        chunks=chunks,
        use_llm=False,
        file_name="test.md",
        file_path="/tmp/test.md",
    )

    assert result["status"] == "success"
    assert result["doc_id"] == "doc-1"

    # Intermediate in-progress snapshot should be emitted around chunk 5.
    in_progress = [c for c in neo4j.merge_calls if c["kg_status"] == "in_progress"]
    assert any(c["extra_props"].get("kg_processed_chunks") == 5 for c in in_progress)

    # Final success snapshot must report completion.
    success_calls = [c for c in neo4j.merge_calls if c["kg_status"] == "success"]
    assert success_calls
    final = success_calls[-1]["extra_props"]
    assert final["kg_total_chunks"] == 6
    assert final["kg_processed_chunks"] == 6
    assert final["kg_progress"] == 100
    assert final["kg_phase"] == "completed"


def test_list_document_statuses_includes_progress_fields() -> None:
    client = Neo4jClient("bolt://unused", "neo4j", "pass")
    client.query = lambda *_args, **_kwargs: [  # type: ignore[assignment]
        {
            "doc_id": "doc-1",
            "file_name": "sample.md",
            "kg_status": "in_progress",
            "entities_count": 12,
            "relationships_count": 34,
            "phase": "extracting",
            "progress": 48,
            "processed_chunks": 24,
            "total_chunks": 50,
            "error": None,
        }
    ]

    statuses = client.list_document_statuses()
    assert statuses == [
        {
            "doc_id": "doc-1",
            "file_name": "sample.md",
            "kg_status": "in_progress",
            "entities_count": 12,
            "relationships_count": 34,
            "phase": "extracting",
            "progress": 48,
            "processed_chunks": 24,
            "total_chunks": 50,
            "error": None,
        }
    ]
