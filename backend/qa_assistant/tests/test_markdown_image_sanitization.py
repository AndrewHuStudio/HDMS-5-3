import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent))

from rag.postprocess import answer as pp_answer


def test_postprocess_strips_empty_or_local_markdown_images():
    text = "\n".join([
        "A ![x]()",  # empty URL -> broken icon
        "B ![y](images/a.png)",  # local path -> broken in web UI
        "C ![ok](/rag/documents/doc-1/image?ref=images/a.png)",  # allowed
    ])

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "![x]" not in out
    assert "![y]" not in out
    assert "![ok]" in out


def test_postprocess_does_not_touch_images_in_code_blocks():
    text = "```md\n![x](images/a.png)\n```"

    out, _ = pp_answer.postprocess_answer(text, valid_labels=None)

    assert "![x](images/a.png)" in out
