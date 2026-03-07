#!/bin/bash

# 公式处理模块 - 验证脚本
# 用于验证模块的完整性和功能

set -e

echo "================================================================================"
echo "                    公式处理模块 - 验证脚本"
echo "================================================================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 计数器
PASSED=0
FAILED=0

# 检查函数
check() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} $1"
        ((PASSED++))
    else
        echo -e "${RED}✗${NC} $1"
        ((FAILED++))
    fi
}

# 1. 检查文件存在性
echo "1. 检查文件存在性"
echo "--------------------------------------------------------------------------------"

files=(
    "frontend/lib/math/index.ts"
    "frontend/lib/math/parser.ts"
    "frontend/lib/math/validator.ts"
    "frontend/lib/math/renderer.tsx"
    "frontend/lib/math/examples.tsx"
    "frontend/lib/math/README.md"
    "frontend/lib/math/__tests__/parser.test.ts"
    "frontend/lib/math/__tests__/validator.test.ts"
    "frontend/components/qa-new/qa-markdown-renderer.tsx"
    "frontend/components/qa-new/qa-shell.tsx"
    "docs/math-module-integration.md"
    "docs/math-module-summary.md"
    "docs/math-module-quick-start.md"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        check "文件存在: $file"
    else
        echo -e "${RED}✗${NC} 文件不存在: $file"
        ((FAILED++))
    fi
done

echo ""

# 2. 检查代码语法
echo "2. 检查代码语法"
echo "--------------------------------------------------------------------------------"

cd frontend

# TypeScript 编译检查
echo "检查 TypeScript 编译..."
npx tsc --noEmit --project tsconfig.json > /dev/null 2>&1
check "TypeScript 编译检查"

echo ""

# 3. 检查导入导出
echo "3. 检查模块导入导出"
echo "--------------------------------------------------------------------------------"

# 检查 index.ts 导出
if grep -q "export.*MathRenderer" lib/math/index.ts; then
    check "导出 MathRenderer"
else
    echo -e "${RED}✗${NC} 未导出 MathRenderer"
    ((FAILED++))
fi

if grep -q "export.*isMathComplete" lib/math/index.ts; then
    check "导出 isMathComplete"
else
    echo -e "${RED}✗${NC} 未导出 isMathComplete"
    ((FAILED++))
fi

if grep -q "export.*extractMathBlocks" lib/math/index.ts; then
    check "导出 extractMathBlocks"
else
    echo -e "${RED}✗${NC} 未导出 extractMathBlocks"
    ((FAILED++))
fi

echo ""

# 4. 检查集成
echo "4. 检查模块集成"
echo "--------------------------------------------------------------------------------"

# 检查 qa-markdown-renderer.tsx 是否导入了公式模块
if grep -q "from \"@/lib/math\"" components/qa-new/qa-markdown-renderer.tsx; then
    check "qa-markdown-renderer.tsx 导入公式模块"
else
    echo -e "${RED}✗${NC} qa-markdown-renderer.tsx 未导入公式模块"
    ((FAILED++))
fi

# 检查是否添加了 isStreaming 属性
if grep -q "isStreaming" components/qa-new/qa-markdown-renderer.tsx; then
    check "qa-markdown-renderer.tsx 添加 isStreaming 属性"
else
    echo -e "${RED}✗${NC} qa-markdown-renderer.tsx 未添加 isStreaming 属性"
    ((FAILED++))
fi

# 检查 qa-shell.tsx 是否传递了 isStreaming
if grep -q "isStreaming={isStreaming}" components/qa-new/qa-shell.tsx; then
    check "qa-shell.tsx 传递 isStreaming 属性"
else
    echo -e "${RED}✗${NC} qa-shell.tsx 未传递 isStreaming 属性"
    ((FAILED++))
fi

echo ""

# 5. 检查代码行数
echo "5. 检查代码统计"
echo "--------------------------------------------------------------------------------"

total_lines=$(wc -l lib/math/*.ts lib/math/*.tsx 2>/dev/null | tail -1 | awk '{print $1}')
echo "总代码行数: $total_lines"

if [ "$total_lines" -gt 700 ]; then
    check "代码行数符合预期 (>700)"
else
    echo -e "${YELLOW}⚠${NC} 代码行数偏少: $total_lines"
fi

echo ""

# 6. 检查文档完整性
echo "6. 检查文档完整性"
echo "--------------------------------------------------------------------------------"

# 检查 README.md 是否包含关键章节
if grep -q "## 功能特性" lib/math/README.md; then
    check "README.md 包含功能特性章节"
else
    echo -e "${RED}✗${NC} README.md 缺少功能特性章节"
    ((FAILED++))
fi

if grep -q "## API 文档" lib/math/README.md; then
    check "README.md 包含 API 文档章节"
else
    echo -e "${RED}✗${NC} README.md 缺少 API 文档章节"
    ((FAILED++))
fi

if grep -q "## 使用方式" lib/math/README.md; then
    check "README.md 包含使用方式章节"
else
    echo -e "${RED}✗${NC} README.md 缺少使用方式章节"
    ((FAILED++))
fi

echo ""

# 7. 检查测试文件
echo "7. 检查测试文件"
echo "--------------------------------------------------------------------------------"

if [ -f "lib/math/__tests__/parser.test.ts" ]; then
    test_count=$(grep -c "test\|it" lib/math/__tests__/parser.test.ts || echo "0")
    echo "parser.test.ts 测试用例数: $test_count"
    if [ "$test_count" -gt 5 ]; then
        check "parser.test.ts 测试用例充足"
    else
        echo -e "${YELLOW}⚠${NC} parser.test.ts 测试用例偏少"
    fi
fi

if [ -f "lib/math/__tests__/validator.test.ts" ]; then
    test_count=$(grep -c "test\|it" lib/math/__tests__/validator.test.ts || echo "0")
    echo "validator.test.ts 测试用例数: $test_count"
    if [ "$test_count" -gt 5 ]; then
        check "validator.test.ts 测试用例充足"
    else
        echo -e "${YELLOW}⚠${NC} validator.test.ts 测试用例偏少"
    fi
fi

echo ""

# 8. 检查示例文件
echo "8. 检查示例文件"
echo "--------------------------------------------------------------------------------"

if [ -f "lib/math/examples.tsx" ]; then
    example_count=$(grep -c "export function Example" lib/math/examples.tsx || echo "0")
    echo "examples.tsx 示例数量: $example_count"
    if [ "$example_count" -ge 6 ]; then
        check "examples.tsx 示例充足 (6个)"
    else
        echo -e "${YELLOW}⚠${NC} examples.tsx 示例偏少: $example_count"
    fi
fi

echo ""

# 9. 构建测试
echo "9. 构建测试"
echo "--------------------------------------------------------------------------------"

echo "运行构建测试（这可能需要一些时间）..."
npm run build > /tmp/build.log 2>&1
if [ $? -eq 0 ]; then
    check "前端构建成功"
    build_time=$(grep "Compiled successfully" /tmp/build.log | tail -1)
    echo "  $build_time"
else
    echo -e "${RED}✗${NC} 前端构建失败"
    echo "  查看日志: /tmp/build.log"
    ((FAILED++))
fi

echo ""

# 10. Git 状态检查
echo "10. Git 状态检查"
echo "--------------------------------------------------------------------------------"

cd ..
git_status=$(git status --short frontend/lib/math/ 2>/dev/null | wc -l)
echo "未提交的文件数: $git_status"

if [ "$git_status" -gt 0 ]; then
    echo -e "${YELLOW}⚠${NC} 有未提交的更改"
    git status --short frontend/lib/math/
else
    check "所有更改已提交"
fi

echo ""

# 总结
echo "================================================================================"
echo "                              验证总结"
echo "================================================================================"
echo ""
echo -e "通过: ${GREEN}$PASSED${NC}"
echo -e "失败: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ 所有检查通过！模块可以投入使用。${NC}"
    exit 0
else
    echo -e "${RED}✗ 有 $FAILED 项检查失败，请修复后再使用。${NC}"
    exit 1
fi
