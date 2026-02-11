from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_navigation_has_data_upload_as_first_primary_item():
    text = (ROOT / "frontend/lib/navigation-config.ts").read_text(encoding="utf-8")
    data_upload_index = text.find('id: "data-upload"')
    qa_index = text.find('id: "qa-assistant"')
    assert data_upload_index != -1, "main navigation should include data-upload item"
    assert qa_index != -1, "main navigation should still include qa-assistant"
    assert data_upload_index < qa_index, "data-upload should appear before qa-assistant"


def test_active_view_supports_data_upload():
    text = (ROOT / "frontend/lib/navigation-types.ts").read_text(encoding="utf-8")
    assert '"data-upload"' in text, "ActiveView should include data-upload"


def test_page_has_data_upload_layout_branch():
    text = (ROOT / "frontend/app/page.tsx").read_text(encoding="utf-8")
    assert "DataUploadPanel" in text, "page should import/render DataUploadPanel"
    assert "isDataUploadView" in text, "page should branch layout for data-upload view"
