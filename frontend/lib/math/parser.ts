/**
 * 公式解析器
 * 从 Markdown 文本中提取和解析数学公式
 */

export interface MathBlock {
  type: 'inline' | 'block';
  content: string;
  start: number;
  end: number;
  raw: string;
}

/**
 * 从文本中提取所有数学公式
 * @param text - 原始文本
 * @returns 公式块数组
 */
export function extractMathBlocks(text: string): MathBlock[] {
  const blocks: MathBlock[] = [];
  let i = 0;

  while (i < text.length) {
    // 检测块级公式 $$...$$
    if (text[i] === '$' && text[i + 1] === '$') {
      const start = i;
      i += 2;
      let end = i;

      // 查找配对的 $$
      while (end < text.length - 1) {
        if (text[end] === '$' && text[end + 1] === '$') {
          const content = text.slice(i, end);
          blocks.push({
            type: 'block',
            content,
            start,
            end: end + 2,
            raw: text.slice(start, end + 2),
          });
          i = end + 2;
          break;
        }
        end++;
      }

      // 如果没有找到配对，跳过这个 $$
      if (end >= text.length - 1) {
        i = start + 2;
      }
      continue;
    }

    // 检测行内公式 $...$
    if (text[i] === '$') {
      const start = i;
      i += 1;
      let end = i;

      // 查找配对的 $
      while (end < text.length) {
        // 跳过转义的 $
        if (text[end] === '\\' && text[end + 1] === '$') {
          end += 2;
          continue;
        }

        if (text[end] === '$') {
          const content = text.slice(i, end);
          // 忽略空公式或只有空格的公式
          if (content.trim()) {
            blocks.push({
              type: 'inline',
              content,
              start,
              end: end + 1,
              raw: text.slice(start, end + 1),
            });
          }
          i = end + 1;
          break;
        }
        end++;
      }

      // 如果没有找到配对，跳过这个 $
      if (end >= text.length) {
        i = start + 1;
      }
      continue;
    }

    i++;
  }

  return blocks;
}

/**
 * 检查公式是否完整（有配对的分隔符）
 * @param text - 文本片段
 * @returns 是否完整
 */
export function isMathComplete(text: string): boolean {
  // 检查块级公式
  const blockMatches = text.match(/\$\$/g);
  if (blockMatches && blockMatches.length % 2 !== 0) {
    return false;
  }

  // 检查行内公式（排除已经被块级公式包含的部分）
  let cleanText = text;
  const blockRegex = /\$\$[\s\S]*?\$\$/g;
  cleanText = cleanText.replace(blockRegex, '');

  const inlineMatches = cleanText.match(/(?<!\\)\$/g);
  if (inlineMatches && inlineMatches.length % 2 !== 0) {
    return false;
  }

  return true;
}

/**
 * 检测文本中是否包含数学公式
 * @param text - 文本
 * @returns 是否包含公式
 */
export function hasMath(text: string): boolean {
  return /\$[\s\S]*?\$/.test(text);
}
