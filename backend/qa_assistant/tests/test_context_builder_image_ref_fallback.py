import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.context_builder import build_context_and_sources
from rag.postprocess import images as pp_images


class _DummyMongo:
    def find_by_id(self, collection: str, doc_id: str):
        if collection == "chunks" and doc_id == "doc-1_1":
            return {
                "_id": "doc-1_1",
                "text": "图4.0.3 城市高强度片区类型图例\n![](images/type-chart.jpg)",
                "section_title": "4 城市高强度片区的分类",
            }
        return None


def _parse_page_like(_value):
    return None, None


def _infer_page_range_from_text(_text):
    return None, None


def test_build_context_recovers_image_refs_from_chunk_document_when_result_text_loses_markdown_image():
    retrieval_results = {
        "fused_results": [
            {
                "id": "doc-1_1",
                "source": "vector",
                "text": "城市高强度片区可按类型模板进行分类。",
                "doc_id": "doc-1",
                "metadata": {
                    "file_name": "类型图例.pdf",
                    "has_image": True,
                    "section_title": "4 城市高强度片区的分类",
                },
                "score": 0.9,
            }
        ],
        "vector_results": [],
        "graph_results": [],
        "keyword_results": [],
    }

    context, sources = build_context_and_sources(
        retrieval_results=retrieval_results,
        query="城市高强度片区类型",
        mongo=_DummyMongo(),
        ranked_results_contain_relevant_images=lambda _results, _query: True,
        search_image_chunks_by_text=lambda _query, _limit: [],
        extract_image_refs=pp_images.extract_image_refs,
        extract_image_figure_meta=pp_images.extract_image_figure_meta,
        rewrite_image_urls=pp_images.rewrite_image_urls,
        extract_first_markdown_table=lambda _text: None,
        pdf_is_available=lambda _name: True,
        parse_page_like=_parse_page_like,
        infer_page_range_from_text=_infer_page_range_from_text,
    )

    assert sources, "expected at least one source"
    assert sources[0].get("image_urls") == ["/rag/documents/doc-1/image?ref=images/type-chart.jpg"]
    assert "本片段包含 1 张图片" in context

