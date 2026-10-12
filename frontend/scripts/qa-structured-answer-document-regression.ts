import assert from "node:assert/strict";

import { composeAnswerDocumentMarkdown } from "../features/qa/structured-answer-markdown";


const markdown = composeAnswerDocumentMarkdown({
  sections: [
    {
      id: "section-1",
      markdown: "建筑退线应结合道路等级控制。[1-1]",
      source_labels: ["1-1"],
      images: [
        { id: "img-a", url: "/a.png", caption: "退线示意图", source_label: "1-1" },
        { id: "img-b", url: "/b.png", caption: "道路断面图", source_label: "1-1" },
        { id: "img-wrong", url: "/wrong.png", caption: "错误归属", source_label: "9-9" },
      ],
    },
    {
      id: "section-2",
      markdown: "街道界面应保持连续。[2-1]",
      source_labels: ["2-1"],
      images: [
        { id: "img-a", url: "/a.png", caption: "重复图片", source_label: "2-1" },
        { id: "img-c", url: "/c.png", caption: "街道界面图", source_label: "2-1" },
      ],
    },
  ],
});

const firstText = markdown.indexOf("建筑退线");
const firstImage = markdown.indexOf("![退线示意图](/a.png)");
const secondImage = markdown.indexOf("![道路断面图](/b.png)");
const secondText = markdown.indexOf("街道界面");
const thirdImage = markdown.indexOf("![街道界面图](/c.png)");

assert(firstText >= 0 && firstText < firstImage, "first section text should precede its images");
assert(firstImage < secondImage && secondImage < secondText, "multiple images should stay in their owning section");
assert(secondText < thirdImage, "second section image should follow second section text");
assert(markdown.includes("*退线示意图*"), "each image should retain a visible identifying caption");
assert.equal(markdown.match(/\/a\.png/g)?.length, 1, "image IDs should be globally deduplicated");
assert(!markdown.includes("wrong.png"), "images not owned by the section evidence must be rejected");
assert(!markdown.includes("[[IMG:"), "legacy image anchors must not be emitted");

console.log("qa-structured-answer-document-regression passed");
