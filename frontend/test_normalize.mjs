import { normalizeAnswerMarkdownArtifacts } from './lib/normalize-answer-markdown-artifacts.ts';

const testText = `这是测试文本

![test image](/rag/documents/doc-123/image?ref=abc123)

见图3.0.1所示。`;

console.log('=== Input ===');
console.log(testText);
console.log('\n=== Streaming output ===');
const streamingOut = normalizeAnswerMarkdownArtifacts(testText, { streaming: true });
console.log(streamingOut);
console.log('\n=== Final output ===');
const finalOut = normalizeAnswerMarkdownArtifacts(testText, { streaming: false });
console.log(finalOut);
console.log('\n=== Image preserved? ===');
console.log('Streaming:', /!\[.*?\]\(.*?\)/.test(streamingOut));
console.log('Final:', /!\[.*?\]\(.*?\)/.test(finalOut));
