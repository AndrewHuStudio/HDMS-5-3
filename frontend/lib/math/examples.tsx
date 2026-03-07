/**
 * 公式处理模块使用示例
 *
 * 这个文件展示了如何在实际项目中使用公式处理模块
 */

import { useState, useEffect, useMemo } from 'react';
import {
  MathRenderer,
  isMathComplete,
  fixUnpairedDelimiters,
  extractMathBlocks,
  sanitizeFormula,
  validateFormula,
  MathErrorFallback,
  MathImageFallback,
} from '@/lib/math';

// ============================================================================
// 示例 1：基础使用 - 静态内容
// ============================================================================

export function Example1_BasicUsage() {
  const content = `
# 数学公式示例

这是一个行内公式：$E = mc^2$

这是一个块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

更多公式：$x^2 + y^2 = r^2$ 和 $\\sin^2\\theta + \\cos^2\\theta = 1$
  `.trim();

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 1：基础使用</h2>
      <MathRenderer content={content} isStreaming={false} />
    </div>
  );
}

// ============================================================================
// 示例 2：流式显示 - 模拟 AI 回答
// ============================================================================

export function Example2_StreamingResponse() {
  const [answer, setAnswer] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const fullAnswer = `
根据爱因斯坦的质能方程 $E = mc^2$，我们可以计算出：

当质量 $m = 1kg$ 时，能量为：

$$
E = 1 \\times (3 \\times 10^8)^2 = 9 \\times 10^{16} J
$$

这相当于约 25 亿千瓦时的电能。
  `.trim();

  const startStreaming = async () => {
    setAnswer('');
    setIsStreaming(true);

    for (let i = 0; i <= fullAnswer.length; i++) {
      setAnswer(fullAnswer.slice(0, i));
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    setIsStreaming(false);
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 2：流式显示</h2>
      <button
        onClick={startStreaming}
        disabled={isStreaming}
        className="mb-4 px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
      >
        {isStreaming ? '正在输出...' : '开始流式输出'}
      </button>
      <div className="border-t pt-4">
        <MathRenderer
          content={answer}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  );
}

// ============================================================================
// 示例 3：实时编辑器 - 带预览
// ============================================================================

export function Example3_LiveEditor() {
  const [input, setInput] = useState('输入公式：$x^2 + y^2 = 1$');
  const [preview, setPreview] = useState('');

  // 防抖更新预览
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreview(input);
    }, 300);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 3：实时编辑器</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-2">输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full h-64 p-2 border rounded font-mono text-sm"
            placeholder="输入 Markdown + LaTeX 公式..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">预览</label>
          <div className="h-64 p-2 border rounded overflow-auto bg-gray-50">
            <MathRenderer content={preview} isStreaming={false} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 示例 4：公式分析工具
// ============================================================================

export function Example4_FormulaAnalyzer() {
  const [text, setText] = useState('公式1: $x^2 + y^2$ 和公式2: $$\\int_0^1 x dx$$');
  const [analysis, setAnalysis] = useState<any>(null);

  const analyzeFormulas = () => {
    const blocks = extractMathBlocks(text);
    const results = blocks.map(block => {
      const sanitized = sanitizeFormula(block.content);
      const validation = validateFormula(sanitized);

      return {
        type: block.type,
        original: block.content,
        sanitized,
        validation,
        position: `${block.start}-${block.end}`,
      };
    });

    setAnalysis({
      total: blocks.length,
      complete: isMathComplete(text),
      formulas: results,
    });
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 4：公式分析工具</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">输入文本</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-32 p-2 border rounded font-mono text-sm"
          />
        </div>
        <button
          onClick={analyzeFormulas}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          分析公式
        </button>
        {analysis && (
          <div className="p-4 bg-gray-50 rounded">
            <h3 className="font-semibold mb-2">分析结果</h3>
            <p className="text-sm mb-2">
              总计 {analysis.total} 个公式，
              公式完整性：{analysis.complete ? '✓ 完整' : '✗ 不完整'}
            </p>
            <div className="space-y-2">
              {analysis.formulas.map((formula: any, i: number) => (
                <div key={i} className="p-2 bg-white border rounded text-sm">
                  <p><strong>类型：</strong>{formula.type === 'inline' ? '行内' : '块级'}</p>
                  <p><strong>原始：</strong><code>{formula.original}</code></p>
                  <p><strong>修复后：</strong><code>{formula.sanitized}</code></p>
                  <p><strong>验证：</strong>
                    {formula.validation.valid ? (
                      <span className="text-green-600">✓ 有效</span>
                    ) : (
                      <span className="text-red-600">✗ {formula.validation.error}</span>
                    )}
                  </p>
                  <p><strong>位置：</strong>{formula.position}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 示例 5：错误处理演示
// ============================================================================

export function Example5_ErrorHandling() {
  const [mode, setMode] = useState<'normal' | 'error' | 'fallback'>('normal');

  const renderContent = () => {
    const formula = 'x^2 + y^2 = 1';

    switch (mode) {
      case 'normal':
        return <MathRenderer content={`正常渲染：$${formula}$`} />;
      case 'error':
        return <MathErrorFallback formula={formula} />;
      case 'fallback':
        return <MathImageFallback formula={formula} type="inline" />;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 5：错误处理</h2>
      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('normal')}
            className={`px-4 py-2 rounded ${mode === 'normal' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            正常渲染
          </button>
          <button
            onClick={() => setMode('error')}
            className={`px-4 py-2 rounded ${mode === 'error' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            错误提示
          </button>
          <button
            onClick={() => setMode('fallback')}
            className={`px-4 py-2 rounded ${mode === 'fallback' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
          >
            图片兜底
          </button>
        </div>
        <div className="p-4 bg-gray-50 rounded">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 示例 6：性能测试
// ============================================================================

export function Example6_PerformanceTest() {
  const [count, setCount] = useState(10);
  const [time, setTime] = useState(0);

  const generateFormulas = (n: number) => {
    const formulas = [];
    for (let i = 0; i < n; i++) {
      formulas.push(`$x_${i}^2 + y_${i}^2 = r_${i}^2$`);
    }
    return formulas.join(' ');
  };

  const runTest = () => {
    const content = generateFormulas(count);
    const start = performance.now();

    // 模拟处理
    const processed = fixUnpairedDelimiters(content);
    const blocks = extractMathBlocks(processed);
    blocks.forEach(block => sanitizeFormula(block.content));

    const end = performance.now();
    setTime(end - start);
  };

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-4">示例 6：性能测试</h2>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            公式数量：{count}
          </label>
          <input
            type="range"
            min="10"
            max="1000"
            step="10"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <button
          onClick={runTest}
          className="px-4 py-2 bg-purple-500 text-white rounded"
        >
          运行测试
        </button>
        {time > 0 && (
          <div className="p-4 bg-gray-50 rounded">
            <p className="text-sm">
              处理 {count} 个公式耗时：<strong>{time.toFixed(2)} ms</strong>
            </p>
            <p className="text-sm text-gray-600">
              平均每个公式：{(time / count).toFixed(3)} ms
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主示例页面
// ============================================================================

export function MathModuleExamples() {
  return (
    <div className="max-w-6xl mx-auto p-8 space-y-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">公式处理模块示例</h1>
        <p className="text-gray-600">
          展示公式处理模块的各种使用场景和功能
        </p>
      </div>

      <Example1_BasicUsage />
      <Example2_StreamingResponse />
      <Example3_LiveEditor />
      <Example4_FormulaAnalyzer />
      <Example5_ErrorHandling />
      <Example6_PerformanceTest />

      <div className="p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-semibold mb-2">💡 提示</h3>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>流式显示时，不完整的公式会显示为原始文本</li>
          <li>模块会自动修复常见的格式错误</li>
          <li>支持行内公式 ($...$) 和块级公式 ($$...$$)</li>
          <li>提供友好的错误提示和图片兜底方案</li>
        </ul>
      </div>
    </div>
  );
}
