import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

async function main() {
  const frontendRoot = process.cwd();
  const componentPath = path.join(frontendRoot, "components", "site-filing-link.tsx");
  const layoutPath = path.join(frontendRoot, "app", "layout.tsx");

  assert.ok(existsSync(componentPath), "site filing link component should exist");

  const componentModule = await import(pathToFileURL(componentPath).href);
  const markup = renderToStaticMarkup(componentModule.SiteFilingLink());

  assert.match(markup, />赣ICP备2026022319号-1<\/a>/);
  assert.match(markup, /href="https:\/\/beian\.miit\.gov\.cn\/"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /\bz-10\b/, "filing link should remain below dialogs and overlays");
  assert.doesNotMatch(markup, /\bz-\[100\]\b/);
  assert.match(markup, /\bleft-2\b/, "filing link should sit at the bottom-left edge");
  assert.doesNotMatch(markup, /\binset-x-0\b|\bjustify-center\b/);

  const layoutSource = readFileSync(layoutPath, "utf8");
  assert.match(layoutSource, /import \{ SiteFilingLink \} from "@\/components\/site-filing-link"/);
  assert.match(layoutSource, /<SiteFilingLink \/>/);

  console.log("site filing link regression passed");
}

void main();
