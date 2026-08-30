import assert from "node:assert/strict";
import { GET } from "../app/api/rag/documents/[docId]/pdf/route";

async function main(): Promise<void> {
  const previousBaseUrl = process.env.HDMS_QA_BASE_URL;
  const upstream = "http://127.0.0.1:1";
  process.env.HDMS_QA_BASE_URL = upstream;

  try {
    const response = await GET(new Request("http://localhost/api/rag/documents/doc-1/pdf"), {
      params: Promise.resolve({ docId: "doc-1" }),
    });

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.deepEqual(await response.json(), {
      error: "upstream unreachable",
      upstream: `${upstream}/rag/documents/doc-1/pdf`,
    });
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.HDMS_QA_BASE_URL;
    } else {
      process.env.HDMS_QA_BASE_URL = previousBaseUrl;
    }
  }
}

void main().then(() => {
  console.log("qa-pdf-proxy-upstream-regression passed");
});
