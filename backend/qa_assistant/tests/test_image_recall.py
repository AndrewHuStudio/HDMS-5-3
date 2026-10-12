import sys
import unittest
from pathlib import Path


QA_ROOT = Path(__file__).resolve().parents[1]
if str(QA_ROOT) not in sys.path:
    sys.path.insert(0, str(QA_ROOT))

from rag.retrieval_helpers import search_image_chunks_by_text


class EmptyTextSearchMongo:
    def __init__(self):
        self.fallback_queries = []

    def text_search(self, collection, query, *, limit, filter_query):
        self.text_search_args = (collection, query, limit, filter_query)
        return []

    def find_by_query(self, collection, query, *, limit, projection):
        self.fallback_queries.append((collection, query, limit, projection))
        return [
            {
                "_id": "image-chunk-1",
                "doc_id": "doc-1",
                "text": "高密度城市建筑退线控制。\n\n![](images/setback.png)",
                "section_title": "退线控制",
                "has_image": True,
                "page": 18,
            }
        ]


class ImageRecallTests(unittest.TestCase):
    def test_empty_text_search_continues_to_bounded_image_fallback(self):
        mongo = EmptyTextSearchMongo()

        results = search_image_chunks_by_text(
            mongo=mongo,
            query="高密度城市的退线距离如何计算",
            limit=4,
        )

        self.assertEqual(["image-chunk-1"], [item["id"] for item in results])
        self.assertEqual(1, len(mongo.fallback_queries))
        _collection, query, limit, _projection = mongo.fallback_queries[0]
        self.assertEqual(4, limit)
        self.assertTrue(query["has_image"])
        self.assertGreaterEqual(len(query["$or"]), 2)


if __name__ == "__main__":
    unittest.main()
