import unittest

from data_process.vector_process.ingestion.chunker import DocumentChunker


class DocumentChunkerRegressionTests(unittest.TestCase):
    def test_extract_image_refs_supports_parentheses_and_spaces(self):
        chunker = DocumentChunker()
        markdown = """
![a](images/Quarter 1.png)
![b](<images/Quarter 2.png>)
![c](images/plot(1).png)
![d](images/plot(2).png "title")
"""

        refs = chunker.extract_image_refs(markdown)

        self.assertIn("images/Quarter 1.png", refs)
        self.assertIn("images/Quarter 2.png", refs)
        self.assertIn("images/plot(1).png", refs)
        self.assertIn("images/plot(2).png", refs)
        self.assertTrue(chunker._contains_image("![x](images/plot(1).png)"))

    def test_table_split_keeps_plain_pipe_text_outside_table(self):
        chunker = DocumentChunker(chunk_size=100, overlap=10)
        markdown = """# T
|A|B|
|---|---|
|1|2|
plain text | not a table row
next plain line
"""

        chunks = chunker.chunk_markdown(markdown, doc_id="doc-1", metadata={})
        table_chunks = [chunk for chunk in chunks if chunk["has_table"]]
        non_table_text = "\n".join(chunk["text"] for chunk in chunks if not chunk["has_table"])

        self.assertEqual(len(table_chunks), 1)
        self.assertNotIn("plain text | not a table row", table_chunks[0]["text"])
        self.assertIn("plain text | not a table row", non_table_text)

    def test_token_split_clamps_overlap_to_avoid_oversized_chunks(self):
        chunker = DocumentChunker(chunk_size=5, overlap=8)
        text = " ".join(f"w{i}" for i in range(20))

        chunks = chunker._split_by_tokens(text, title="")

        self.assertGreater(len(chunks), 0)
        self.assertLessEqual(len(chunks), 20)
        self.assertTrue(all(len(chunk.split()) <= 5 for chunk in chunks))


if __name__ == "__main__":
    unittest.main()
