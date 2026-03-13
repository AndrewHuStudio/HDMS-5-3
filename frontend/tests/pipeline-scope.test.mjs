import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVectorSourceDocs,
  pickGraphEligibleDocs,
} from "../features/data-upload/pipeline-scope.mjs";

test("vector source docs only include OCR done files from current job", () => {
  const docs = buildVectorSourceDocs({
    currentJob: {
      files: [
        {
          file_name: "A.pdf",
          status: "done",
          markdown_path: "/data/ocr_output/默认/A/A.md",
          pages: 9,
        },
        {
          file_name: "B.pdf",
          status: "processing",
          markdown_path: "",
          pages: 0,
        },
      ],
    },
    summary: {
      documents: [
        { name: "A", category: "默认", markdown_path: "/data/ocr_output/默认/A/A.md", pages: 9, images: 2 },
        { name: "历史文档X", category: "默认", markdown_path: "/data/ocr_output/默认/X/X.md", pages: 30, images: 10 },
      ],
    },
  });

  assert.equal(docs.length, 1);
  assert.equal(docs[0].name, "A");
});

test("graph eligible docs are strictly based on vector complete docs", () => {
  const docs = pickGraphEligibleDocs(
    [{ name: "A", markdown_path: "/data/ocr_output/默认/A/A.md" }, { name: "B", markdown_path: "/data/ocr_output/默认/B/B.md" }],
    [
      { file_name: "A", markdown_path: "/data/ocr_output/默认/A/A.md", status: "complete" },
      { file_name: "B", markdown_path: "/data/ocr_output/默认/B/B.md", status: "not_started" },
      { file_name: "历史文档X", markdown_path: "/data/ocr_output/默认/X/X.md", status: "complete" },
    ],
  );

  assert.equal(docs.length, 1);
  assert.equal(docs[0].file_name, "A");
});
