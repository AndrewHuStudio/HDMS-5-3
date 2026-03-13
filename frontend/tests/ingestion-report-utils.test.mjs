import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIngestionScopeDirs,
  mergeIngestionReports,
} from "../features/data-upload/ingestion-report-utils.mjs";

test("buildIngestionScopeDirs keeps all unique OCR scope directories", () => {
  const dirs = buildIngestionScopeDirs([
    { markdown_path: "/data/ocr_output/A/doc1/doc1.md" },
    { markdown_path: "/data/ocr_output/B/doc2/doc2.md" },
    { markdown_path: "/data/ocr_output/A/doc3/doc3.md" },
  ]);

  assert.deepEqual(dirs, ["/data/ocr_output/A", "/data/ocr_output/B"]);
});

test("mergeIngestionReports preserves previous documents when new batch is added", () => {
  const merged = mergeIngestionReports([
    {
      total: 1,
      not_started: 0,
      in_progress: 0,
      complete: 1,
      failed: 0,
      documents: [
        {
          file_name: "历史文档A",
          markdown_path: "/data/ocr_output/A/docA/docA.md",
          status: "complete",
          chunks_count: 20,
          images_processed: 1,
        },
      ],
    },
    {
      total: 1,
      not_started: 1,
      in_progress: 0,
      complete: 0,
      failed: 0,
      documents: [
        {
          file_name: "新文档B",
          markdown_path: "/data/ocr_output/B/docB/docB.md",
          status: "not_started",
          chunks_count: 0,
          images_processed: 0,
        },
      ],
    },
  ]);

  assert.equal(merged.total, 2, "新增批次后，历史文档不应消失");
  assert.equal(merged.complete, 1);
  assert.equal(merged.not_started, 1);
  assert.ok(merged.documents.some((doc) => doc.file_name === "历史文档A"));
  assert.ok(merged.documents.some((doc) => doc.file_name === "新文档B"));
});
