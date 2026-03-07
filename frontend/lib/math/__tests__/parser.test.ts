/**
 * 公式解析器测试
 */

import { extractMathBlocks, isMathComplete, hasMath } from '../parser';

describe('extractMathBlocks', () => {
  test('提取行内公式', () => {
    const text = '这是一个公式 $x^2 + y^2 = 1$ 很简单';
    const blocks = extractMathBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('inline');
    expect(blocks[0].content).toBe('x^2 + y^2 = 1');
  });

  test('提取块级公式', () => {
    const text = '这是块级公式：\n$$\nx^2 + y^2 = 1\n$$\n结束';
    const blocks = extractMathBlocks(text);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('block');
    expect(blocks[0].content).toContain('x^2 + y^2 = 1');
  });

  test('提取多个公式', () => {
    const text = '公式1 $a + b$ 和公式2 $c + d$ 结束';
    const blocks = extractMathBlocks(text);

    expect(blocks).toHaveLength(2);
    expect(blocks[0].content).toBe('a + b');
    expect(blocks[1].content).toBe('c + d');
  });

  test('忽略空公式', () => {
    const text = '空公式 $$ 和 $ $ 应该被忽略';
    const blocks = extractMathBlocks(text);

    expect(blocks).toHaveLength(0);
  });
});

describe('isMathComplete', () => {
  test('完整的公式', () => {
    expect(isMathComplete('$x^2$')).toBe(true);
    expect(isMathComplete('$$x^2$$')).toBe(true);
    expect(isMathComplete('$a$ 和 $b$')).toBe(true);
  });

  test('不完整的公式', () => {
    expect(isMathComplete('$x^2')).toBe(false);
    expect(isMathComplete('$$x^2')).toBe(false);
    expect(isMathComplete('$a$ 和 $b')).toBe(false);
  });
});

describe('hasMath', () => {
  test('检测公式存在', () => {
    expect(hasMath('$x^2$')).toBe(true);
    expect(hasMath('$$x^2$$')).toBe(true);
    expect(hasMath('没有公式')).toBe(false);
  });
});
