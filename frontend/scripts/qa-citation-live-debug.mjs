import { chromium } from "playwright";

const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const browser = await chromium.launch({
  channel: undefined,
  executablePath: edgePath,
  headless: true,
});

const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
});

page.on("console", (msg) => {
  console.log("[browser-console]", msg.type(), msg.text());
});

await page.goto("http://127.0.0.1:8021/assistant", { waitUntil: "domcontentloaded" });

await page.waitForSelector('textarea[placeholder="有什么我能帮你的吗？"]', { timeout: 30000 });
await page.evaluate(() => {
  const textarea = document.querySelector('textarea[placeholder="有什么我能帮你的吗？"]');
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error("textarea not found");
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, "什么是立体空间开发控制？");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(500);

const composerState = await page.evaluate(() => {
  const textarea = document.querySelector('textarea[placeholder="有什么我能帮你的吗？"]');
  const sendButton = document.querySelector('button[title="发送"]');
  return {
    textareaValue: textarea instanceof HTMLTextAreaElement ? textarea.value : null,
    sendDisabled: sendButton instanceof HTMLButtonElement ? sendButton.disabled : null,
    sendButtonHtml: sendButton?.outerHTML ?? null,
  };
});

if (composerState.sendDisabled) {
  console.log(JSON.stringify({ composerState }, null, 2));
  await browser.close();
  process.exit(3);
}

await page.getByTitle("发送").click();
await page.waitForTimeout(25000);

const snapshot = await page.evaluate(() => {
  const markdown = document.querySelector(".qa-markdown");
  const sources = Array.from(document.querySelectorAll("[data-citation-target-label]")).map((element) => ({
    id: element instanceof HTMLElement ? element.id : null,
    label: element.getAttribute("data-citation-target-label"),
  }));
  return {
    bodyText: document.body.innerText.slice(0, 4000),
    markdownHtml: markdown?.innerHTML?.slice(0, 4000) ?? null,
    citationCount: document.querySelectorAll("[data-citation-label]").length,
    targetCount: document.querySelectorAll("[data-citation-target-label]").length,
    sources,
  };
});

if (snapshot.citationCount === 0) {
  console.log(JSON.stringify({ snapshot }, null, 2));
  await browser.close();
  process.exit(2);
}

const before = await page.evaluate(() => {
  const chat = document.querySelector(".qa-scrollbar");
  const firstCitation = document.querySelector("[data-citation-label]");
  const firstTarget = document.querySelector("[data-citation-target-label]");
  return {
    hash: window.location.hash,
    href: firstCitation?.getAttribute("href") ?? null,
    chatScrollTop: chat instanceof HTMLElement ? chat.scrollTop : null,
    citationCount: document.querySelectorAll("[data-citation-label]").length,
    targetCount: document.querySelectorAll("[data-citation-target-label]").length,
    firstCitationLabel: firstCitation?.getAttribute("data-citation-label") ?? null,
    firstTargetId: firstTarget instanceof HTMLElement ? firstTarget.id : null,
    firstTargetLabel: firstTarget?.getAttribute("data-citation-target-label") ?? null,
  };
});

await page.locator("[data-citation-label]").first().click();
await page.waitForTimeout(1800);

const after = await page.evaluate(() => {
  const chat = document.querySelector(".qa-scrollbar");
  const selected = Array.from(document.querySelectorAll("[data-citation-target-label]"))
    .filter((element) => String((element instanceof HTMLElement ? element.className : "")).includes("ring-2"))
    .map((element) => ({
      id: element instanceof HTMLElement ? element.id : null,
      label: element.getAttribute("data-citation-target-label"),
    }));
  const flashed = Array.from(document.querySelectorAll(".qa-source-flash")).map((element) => ({
    id: element instanceof HTMLElement ? element.id : null,
    label: element.getAttribute("data-citation-target-label"),
  }));
  return {
    hash: window.location.hash,
    activeElementTag: document.activeElement?.tagName ?? null,
    chatScrollTop: chat instanceof HTMLElement ? chat.scrollTop : null,
    selected,
    flashed,
  };
});

console.log(JSON.stringify({ before, after }, null, 2));

await browser.close();
