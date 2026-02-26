import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ViewControls } from "@/components/view-controls";

describe("ViewControls quick buttons", () => {
  it("renders plan and perspective quick buttons", () => {
    const html = renderToStaticMarkup(
      <ViewControls currentView="plan" onViewChange={vi.fn()} />
    );

    expect(html).toContain("title=\"平面视图快捷按钮\"");
    expect(html).toContain("title=\"透视视图快捷按钮\"");
  });
});

