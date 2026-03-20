import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  isIngestionReportComplete,
  normalizeIngestionReportForRefresh,
} from "../features/data-upload/ingestion-report-utils.mjs";

const projectRoot = process.cwd();

function readProjectFile(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  assert.ok(fs.existsSync(fullPath), `expected file to exist: ${relativePath}`);
  return fs.readFileSync(fullPath, "utf8");
}

test("normalizeIngestionReportForRefresh turns failed documents back into not_started", () => {
  const normalized = normalizeIngestionReportForRefresh({
    total: 3,
    not_started: 0,
    in_progress: 0,
    complete: 1,
    failed: 2,
    documents: [
      {
        file_name: "ok.md",
        markdown_path: "/tmp/ok.md",
        status: "complete",
        chunks_count: 12,
        images_processed: 1,
      },
      {
        file_name: "bad-a.md",
        markdown_path: "/tmp/bad-a.md",
        status: "failed",
        chunks_count: 0,
        images_processed: 0,
        ingest_error: "HTTP 502",
      },
      {
        file_name: "bad-b.md",
        markdown_path: "/tmp/bad-b.md",
        status: "failed",
        chunks_count: 0,
        images_processed: 0,
        ingest_error: "timeout",
      },
    ],
  });

  assert.equal(normalized.complete, 1);
  assert.equal(normalized.failed, 0);
  assert.equal(normalized.not_started, 2);
  assert.equal(normalized.documents[1].status, "not_started");
  assert.equal(normalized.documents[1].ingest_error, undefined);
  assert.equal(normalized.documents[2].status, "not_started");
});

test("isIngestionReportComplete returns false for null reports", () => {
  assert.equal(isIngestionReportComplete(null), false);
});

test("data upload panels use destructive confirmation and reset APIs", () => {
  const ocrPanel = readProjectFile("features/data-upload/ocr-upload-panel.tsx");
  const vectorPanel = readProjectFile("features/data-upload/vector-upload-panel.tsx");
  const graphPanel = readProjectFile("features/data-upload/graph-upload-panel.tsx");
  const verificationPanel = readProjectFile("features/data-upload/verification-panel.tsx");
  const apiFile = readProjectFile("features/data-upload/api.ts");

  assert.match(ocrPanel, /window\.confirm/, "OCR reset should require user confirmation");
  assert.match(vectorPanel, /window\.confirm/, "vector reset should require user confirmation");
  assert.match(graphPanel, /window\.confirm/, "graph reset should require user confirmation");
  assert.match(verificationPanel, /window\.confirm/, "all-in-one reset should require user confirmation");

  assert.match(apiFile, /export async function clearIngestionData/, "frontend API should expose vector reset");
  assert.match(apiFile, /export async function clearGraphData/, "frontend API should expose graph reset");
});
