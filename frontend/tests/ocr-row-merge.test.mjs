import test from "node:test";
import assert from "node:assert/strict";

import { buildMergedOcrRows } from "../features/data-upload/ocr-rows.mjs";

test("shows summary rows when there is no active selection", () => {
  const rows = buildMergedOcrRows({
    selectedFiles: [],
    jobFiles: [],
    summaryDocuments: [{ name: "历史文档A", pages: 12, markdown_path: "/tmp/a.md" }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fileName, "历史文档A");
  assert.equal(rows[0].source, "summary");
  assert.equal(rows[0].ocrFile?.status, "done");
});

test("keeps historical summary rows visible after adding a new file", () => {
  const rows = buildMergedOcrRows({
    selectedFiles: [{ name: "new-upload.pdf", size: 2048 }],
    jobFiles: [],
    summaryDocuments: [{ name: "历史文档A", pages: 12, markdown_path: "/tmp/a.md" }],
  });

  assert.equal(rows.length, 2, "新文件加入后，历史条目不应消失");
  assert.ok(rows.some((row) => row.fileName === "new-upload.pdf"));
  assert.ok(rows.some((row) => row.fileName === "历史文档A"));
});
