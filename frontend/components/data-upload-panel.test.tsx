import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DataUploadPanel } from "@/components/data-upload-panel";

vi.mock("@/features/data-upload/ocr-upload-panel", () => ({
  OCRUploadPanel: () => <div data-panel="ocr" />,
}));

vi.mock("@/features/data-upload/vector-upload-panel", () => ({
  VectorUploadPanel: () => <div data-panel="vector" />,
}));

vi.mock("@/features/data-upload/graph-upload-panel", () => ({
  GraphUploadPanel: () => <div data-panel="graph" />,
}));

vi.mock("@/features/data-upload/verification-panel", () => ({
  VerificationPanel: () => <div data-panel="verification" />,
}));

describe("DataUploadPanel layout", () => {
  it("uses fixed narrow side padding without a max-width wrapper", () => {
    const html = renderToStaticMarkup(<DataUploadPanel />);

    expect(html).toContain("px-4");
    expect(html).not.toContain("max-w-7xl");
    expect(html).not.toContain("mx-auto");
  });
});
