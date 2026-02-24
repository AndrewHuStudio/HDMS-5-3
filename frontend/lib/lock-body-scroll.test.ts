import { describe, expect, it } from "vitest";

import { lockBodyScroll } from "./lock-body-scroll";

function makeStubEnv({
  innerWidth,
  clientWidth,
  computedPaddingRight = "0px",
}: {
  innerWidth: number;
  clientWidth: number;
  computedPaddingRight?: string;
}) {
  const bodyStyle: Record<string, string> = { overflow: "", paddingRight: "" };
  const body = { style: bodyStyle } as unknown as HTMLBodyElement;

  const doc = {
    body,
    documentElement: { clientWidth } as unknown as HTMLElement,
  } as unknown as Document;

  const win = {
    innerWidth,
    getComputedStyle: () => ({ paddingRight: computedPaddingRight }),
  } as unknown as Window;

  return { doc, win, bodyStyle };
}

describe("lockBodyScroll", () => {
  it("locks overflow and adds padding-right equal to scrollbar width, then restores previous inline styles", () => {
    const { doc, win, bodyStyle } = makeStubEnv({
      innerWidth: 1000,
      clientWidth: 980,
      computedPaddingRight: "0px",
    });

    bodyStyle.overflow = "auto";
    bodyStyle.paddingRight = "";

    const unlock = lockBodyScroll({ doc, win });
    expect(bodyStyle.overflow).toBe("hidden");
    expect(bodyStyle.paddingRight).toBe("20px");

    unlock();
    expect(bodyStyle.overflow).toBe("auto");
    expect(bodyStyle.paddingRight).toBe("");
  });

  it("preserves existing computed padding when reserving scrollbar width", () => {
    const { doc, win, bodyStyle } = makeStubEnv({
      innerWidth: 1200,
      clientWidth: 1180,
      computedPaddingRight: "10px",
    });

    const unlock = lockBodyScroll({ doc, win });
    expect(bodyStyle.paddingRight).toBe("30px");

    unlock();
    expect(bodyStyle.paddingRight).toBe("");
  });

  it("does not touch padding-right when there is no scrollbar width delta", () => {
    const { doc, win, bodyStyle } = makeStubEnv({
      innerWidth: 1000,
      clientWidth: 1000,
      computedPaddingRight: "12px",
    });

    bodyStyle.paddingRight = "5px";
    const unlock = lockBodyScroll({ doc, win });

    expect(bodyStyle.overflow).toBe("hidden");
    // No scrollbar => keep inline padding untouched.
    expect(bodyStyle.paddingRight).toBe("5px");

    unlock();
    expect(bodyStyle.overflow).toBe("");
    expect(bodyStyle.paddingRight).toBe("5px");
  });
});

