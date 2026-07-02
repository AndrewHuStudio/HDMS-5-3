import sys
import unittest
from pathlib import Path

QA_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[3]
for path in (QA_ROOT, PROJECT_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from routes import qa as qa_routes


class _FakeMongo:
    def find_by_id(self, collection, item_id):
        if collection == "chunks" and item_id == "chunk-1":
            return {
                "_id": "chunk-1",
                "doc_id": "doc-1",
                "text": "这是引用来源原文。",
                "page": 12,
                "section_title": "章节",
                "has_table": False,
                "has_image": False,
            }
        if collection == "documents" and item_id == "doc-1":
            return {
                "_id": "doc-1",
                "file_name": "深圳湾科技生态园空间控制图.pdf",
                "category": "管控资料",
                "pages": 80,
                "metadata": {},
            }
        return None


class SourceDetailFastPathTests(unittest.TestCase):
    def test_source_details_do_not_scan_pdf_pages_by_default(self):
        calls = []
        resolve_pdf_calls = []
        original_initialized = qa_routes.db_manager._initialized
        original_mongodb = qa_routes.db_manager.mongodb
        original_resolve_pdf_path = qa_routes._resolve_pdf_path
        original_search_page = qa_routes._search_page_in_pdf
        try:
            qa_routes.db_manager._initialized = True
            qa_routes.db_manager.mongodb = _FakeMongo()

            def fake_resolve_pdf_path(document):
                resolve_pdf_calls.append(document)
                return Path("slow.pdf")

            qa_routes._resolve_pdf_path = fake_resolve_pdf_path

            def fake_search_page(pdf_path, chunk_text):
                calls.append((pdf_path, chunk_text))
                return 37

            qa_routes._search_page_in_pdf = fake_search_page

            detail = qa_routes.get_source_details("chunk-1", q="")
        finally:
            qa_routes.db_manager._initialized = original_initialized
            qa_routes.db_manager.mongodb = original_mongodb
            qa_routes._resolve_pdf_path = original_resolve_pdf_path
            qa_routes._search_page_in_pdf = original_search_page

        self.assertEqual([], resolve_pdf_calls)
        self.assertEqual([], calls)
        self.assertEqual(12, detail["page_hint"])
        self.assertEqual("/rag/documents/doc-1/pdf", detail["document"]["pdf_url"])

    def test_source_details_can_opt_in_to_precise_pdf_page_scan(self):
        calls = []
        original_initialized = qa_routes.db_manager._initialized
        original_mongodb = qa_routes.db_manager.mongodb
        original_resolve_pdf_path = qa_routes._resolve_pdf_path
        original_search_page = qa_routes._search_page_in_pdf
        try:
            qa_routes.db_manager._initialized = True
            qa_routes.db_manager.mongodb = _FakeMongo()
            qa_routes._resolve_pdf_path = lambda document: Path("slow.pdf")

            def fake_search_page(pdf_path, chunk_text):
                calls.append((pdf_path, chunk_text))
                return 37

            qa_routes._search_page_in_pdf = fake_search_page

            detail = qa_routes.get_source_details("chunk-1", q="", resolve_page=True)
        finally:
            qa_routes.db_manager._initialized = original_initialized
            qa_routes.db_manager.mongodb = original_mongodb
            qa_routes._resolve_pdf_path = original_resolve_pdf_path
            qa_routes._search_page_in_pdf = original_search_page

        self.assertEqual(1, len(calls))
        self.assertEqual(37, detail["page_hint"])


if __name__ == "__main__":
    unittest.main()
