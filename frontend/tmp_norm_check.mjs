import { normalizeAnswerMarkdownArtifacts } from './lib/normalize-answer-markdown-artifacts.ts';
const input = ### 一、核心定位
客户经理是公司客户开发中的第一责任人，核心目标是开拓市场，维护客户关系，驱动销售增长。;
console.log(normalizeAnswerMarkdownArtifacts(input));
