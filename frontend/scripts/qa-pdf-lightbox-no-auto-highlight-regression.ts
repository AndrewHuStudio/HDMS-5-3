import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lightboxPath = resolve(process.cwd(), "components", "pdf-lightbox.tsx");
const source = readFileSync(lightboxPath, "utf8");

assert.equal(
  source.includes("scheduleAutoPdfHighlight"),
  false,
  "PdfLightbox should not schedule automatic PDF highlighting on open",
);

assert.equal(
  source.includes("buildPdfSearchCandidates"),
  false,
  "PdfLightbox should not build automatic search candidates on open",
);

assert.equal(
  source.includes("highlightAndStayOnPage"),
  false,
  "PdfLightbox should not invoke search-plugin highlighting on open",
);

console.log("qa-pdf-lightbox-no-auto-highlight-regression passed");
