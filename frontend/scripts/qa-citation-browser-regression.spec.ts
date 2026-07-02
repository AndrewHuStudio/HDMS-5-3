// @ts-nocheck
import { test, expect } from "@playwright/test";

test.setTimeout(240_000);

test("citation click triggers in-app jump instead of inert hash-only navigation", async ({ page }) => {
  await page.goto("http://127.0.0.1:8021/qa-new", { waitUntil: "domcontentloaded" });

  const textarea = page.getByPlaceholder("有什么我能帮你的吗？");
  await textarea.fill("什么是立体空间开发控制？");
  await textarea.press("Enter");

  await page.locator("[data-citation-label]").first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(4_000);

  const before = await page.evaluate(() => {
    const chat = document.querySelector(".qa-scrollbar") as HTMLElement | null;
    const firstCitation = document.querySelector("[data-citation-label]") as HTMLElement | null;
    const firstTarget = document.querySelector("[data-citation-target-label]") as HTMLElement | null;
    return {
      hash: window.location.hash,
      chatScrollTop: chat?.scrollTop ?? null,
      citationCount: document.querySelectorAll("[data-citation-label]").length,
      targetCount: document.querySelectorAll("[data-citation-target-label]").length,
      firstCitationLabel: firstCitation?.getAttribute("data-citation-label") ?? null,
      firstTargetId: firstTarget?.id ?? null,
      firstTargetLabel: firstTarget?.getAttribute("data-citation-target-label") ?? null,
    };
  });

  const firstCitation = page.locator("[data-citation-label]").first();
  await firstCitation.click();
  await page.waitForTimeout(1_500);

  const after = await page.evaluate(() => {
    const chat = document.querySelector(".qa-scrollbar") as HTMLElement | null;
    const flashed = Array.from(document.querySelectorAll(".qa-source-flash")).map((element) => ({
      id: (element as HTMLElement).id,
      label: (element as HTMLElement).getAttribute("data-citation-target-label"),
    }));
    const selected = Array.from(document.querySelectorAll("[data-citation-target-label]")).filter((element) =>
      String((element as HTMLElement).className).includes("ring-2"),
    ).map((element) => ({
      id: (element as HTMLElement).id,
      label: (element as HTMLElement).getAttribute("data-citation-target-label"),
    }));
    return {
      hash: window.location.hash,
      chatScrollTop: chat?.scrollTop ?? null,
      flashed,
      selected,
    };
  });

  console.log("before:", JSON.stringify(before));
  console.log("after:", JSON.stringify(after));

  expect(before.citationCount).toBeGreaterThan(0);
  expect(before.targetCount).toBeGreaterThan(0);
  expect(after.chatScrollTop).not.toBe(before.chatScrollTop);
  expect(after.flashed.length > 0 || after.selected.length > 0).toBeTruthy();
});
