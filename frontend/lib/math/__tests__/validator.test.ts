/**
 * 公式验证器测试
 */

import {
  sanitizeFormula,
  validateFormula,
  fixMathInText,
  ensureBlockMathSpacing,
  fixUnpairedDelimiters,
} from '../validator';
import { extractMathBlocks } from '../parser';

describe('sanitizeFormula', () => {
  test('保留下划线（LaTeX 下标）', () => {
    const result = sanitizeFormula('x_2 + y_3');
    expect(result).toBe('x_2 + y_3');
  });

  test('保留星号', () => {
    const result = sanitizeFormula('x*y + z*w');
    expect(result).toBe('x*y + z*w');
  });

  test('转换 align 环境', () => {
    const result = sanitizeFormula('\\begin{align} x = 1 \\end{align}');
    expect(result).toBe('\\begin{aligned} x = 1 \\end{aligned}');
  });

  test('移除 equation 环境', () => {
    const result = sanitizeFormula('\\begin{equation} x = 1 \\end{equation}');
    expect(result).toBe('x = 1');
  });

  test('移除多余空格', () => {
    const result = sanitizeFormula('  x^2 + y^2  ');
    expect(result).toBe('x^2 + y^2');
  });
});

describe('validateFormula', () => {
  test('验证有效公式', () => {
    const result = validateFormula('x^2 + y^2 = 1');
    expect(result.valid).toBe(true);
  });

  test('检测空公式', () => {
    const result = validateFormula('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('公式内容为空');
  });

  test('检测括号不配对', () => {
    const result = validateFormula('x^{2 + y^2');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('括号不配对');
  });
});

describe('fixMathInText', () => {
  test('保留文本中的公式下标', () => {
    const text = '公式 $x_2 + y_3$ 结束';
    const blocks = extractMathBlocks(text);
    const result = fixMathInText(text, blocks);

    expect(result).toBe('公式 $x_2 + y_3$ 结束');
  });

  test('保留多个公式下标', () => {
    const text = '$a_1$ 和 $b_2$';
    const blocks = extractMathBlocks(text);
    const result = fixMathInText(text, blocks);

    expect(result).toBe('$a_1$ 和 $b_2$');
  });
});

describe('ensureBlockMathSpacing', () => {
  test('公式前添加空行', () => {
    const text = '文字\n$$x^2$$';
    const result = ensureBlockMathSpacing(text);

    expect(result).toBe('文字\n\n$$x^2$$');
  });

  test('公式后添加空行', () => {
    const text = '$$x^2$$\n文字';
    const result = ensureBlockMathSpacing(text);

    expect(result).toBe('$$x^2$$\n\n文字');
  });

  test('已有空行不重复添加', () => {
    const text = '文字\n\n$$x^2$$\n\n文字';
    const result = ensureBlockMathSpacing(text);

    expect(result).toBe('文字\n\n$$x^2$$\n\n文字');
  });
});

describe('fixUnpairedDelimiters', () => {
  test('修复不配对的块级公式', () => {
    const text = '$$x^2';
    const result = fixUnpairedDelimiters(text);

    expect(result).toBe('$$x^2\n$$');
  });

  test('修复不配对的行内公式', () => {
    const text = '$x^2';
    const result = fixUnpairedDelimiters(text);

    expect(result).toBe('$x^2$');
  });

  test('不修改配对的公式', () => {
    const text = '$x^2$ 和 $$y^2$$';
    const result = fixUnpairedDelimiters(text);

    expect(result).toBe('$x^2$ 和 $$y^2$$');
  });
});
