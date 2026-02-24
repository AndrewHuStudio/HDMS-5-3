import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { QA_REMARK_PLUGINS } from "./qa-markdown-plugins";

describe("QA_REMARK_PLUGINS", () => {
  it("keeps single-tilde numeric ranges as plain text (no <del>)", () => {
    const markdown = "地上容积率：3.3~5.2（1分）/5.3~7.3（2分）";
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={QA_REMARK_PLUGINS}>{markdown}</ReactMarkdown>
    );

    expect(html).toContain("3.3~5.2");
    expect(html).toContain("5.3~7.3");
    expect(html).not.toContain("<del>");
  });

  it("documents why we override remark-gfm default behavior", () => {
    const markdown = "3.3~5.2/5.3~7.3";
    const html = renderToStaticMarkup(
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    );

    expect(html).toContain("<del>");
  });
});
