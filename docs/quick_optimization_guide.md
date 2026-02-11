# 快速优化方案：跳过检索以获得即时响应

## 问题分析

根据代码分析，5-10秒延迟很可能来自 **embedding API 调用**。每次查询都需要：
1. 调用 embedding API 将问题转为向量（可能需要 3-8 秒）
2. 在 Milvus 中检索相似文档（通常很快，< 100ms）
3. 调用 LLM API 生成答案

而 deepseek 官网不需要 RAG 检索，所以响应是即时的。

## 立即可用的优化方案

### 方案 1：完全跳过检索（最快，推荐测试）

这是最快的验证方法，可以立即让响应速度接近 deepseek 官网。

**步骤：**

1. 修改 `.env` 文件：
```bash
# 将这一行
STREAM_RETRIEVAL_MODE=vector

# 改为
STREAM_RETRIEVAL_MODE=none
```

2. 重启 QA Assistant 服务：
```bash
# 停止当前服务（Ctrl+C）
# 重新启动
cd backend/qa_assistant
python -m uvicorn app:app --reload --port 8002
```

3. 测试问答，应该会看到即时响应（< 1秒开始输出 thinking）

**优点：**
- 立即生效，无需修改代码
- 响应速度最快
- 适合测试验证问题根因

**缺点：**
- 失去了 RAG 检索能力，无法引用知识库内容
- 只能依赖 LLM 的内置知识

**适用场景：**
- 快速验证问题是否在检索阶段
- 对于不需要引用具体文档的通用问题

---

### 方案 2：智能跳过检索（推荐生产使用）

根据问题类型，智能决定是否需要检索：
- 简单问题（问候、概念解释）：跳过检索
- 复杂问题（具体地块、详细指标）：使用检索

**实现方式：**

当前系统已经有意图分类功能，可以基于意图决定是否检索。

修改 `.env`：
```bash
# 保持当前配置
STREAM_INTENT_MODE=rules
STREAM_RETRIEVAL_MODE=vector
```

然后在前端调用时，根据问题类型动态设置 `use_retrieval`：

```typescript
// 简单问题示例
const simpleQuestions = [
  "你好", "什么是容积率", "建筑限高是什么意思"
];

// 如果是简单问题，跳过检索
const useRetrieval = !isSimpleQuestion(question);

const response = await fetch('/qa/chat/stream', {
  method: 'POST',
  body: JSON.stringify({
    question: question,
    use_retrieval: useRetrieval,  // 动态控制
    top_k: 2
  })
});
```

---

### 方案 3：减少检索数量（部分优化）

如果必须使用检索，可以减少检索的文档数量来加快速度。

修改 `.env`：
```bash
# 从 2 减少到 1
STREAM_RETRIEVAL_TOP_K_CAP=1
```

**效果：**
- 减少约 30-50% 的检索时间
- 但如果 embedding API 慢，效果有限

---

### 方案 4：使用更小的 embedding 模型

如果 embedding API 慢，可以使用更小更快的模型。

修改 `.env`：
```bash
# 从 text-embedding-3-large 改为 text-embedding-3-small
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
```

**注意：**
- 需要重新生成所有文档的向量（重新入库）
- 或者在 Milvus 中创建新的 collection

**效果：**
- embedding API 调用速度提升 2-3 倍
- 检索精度略有下降（但通常可接受）

---

### 方案 5：增加 embedding 缓存（长期优化）

对于重复的查询，使用缓存可以避免重复调用 API。

修改 `.env`：
```bash
# 增加缓存大小
EMBEDDING_CACHE_MAX_SIZE=1024  # 从 256 增加到 1024
```

**效果：**
- 对于重复查询，响应时间从 5-10 秒降低到 < 100ms
- 对于新查询，没有改善

**配合预热脚本：**

创建 `backend/qa_assistant/scripts/warm_cache.py`：
```python
"""预热 embedding 缓存"""
from rag.embedder import create_embedding_service

embedder = create_embedding_service()

# 常见问题列表
common_questions = [
    "什么是容积率？",
    "如何进行退线检测？",
    "建筑限高的标准是什么？",
    "深超总地块的规划要求有哪些？",
    "城市设计管控的主要内容是什么？",
    "什么是建筑密度？",
    "绿地率如何计算？",
    "停车位配置标准是什么？",
    # ... 添加更多常见问题
]

print("开始预热 embedding 缓存...")
for i, q in enumerate(common_questions, 1):
    embedder.embed_text(q)
    print(f"[{i}/{len(common_questions)}] 已缓存: {q}")

print("缓存预热完成！")
```

运行预热脚本：
```bash
cd backend/qa_assistant
python scripts/warm_cache.py
```

---

## 推荐的测试流程

### 第一步：验证问题根因

1. 运行 embedding 速度测试：
```bash
cd backend/qa_assistant
python tests/test_embedding_speed.py
```

2. 观察输出，如果平均时间 > 2000ms，说明问题确实在 embedding API

### 第二步：快速验证优化效果

1. 修改 `.env`，设置 `STREAM_RETRIEVAL_MODE=none`
2. 重启服务
3. 测试问答，应该看到即时响应

如果响应变快了，说明问题确实在检索阶段。

### 第三步：选择长期方案

根据你的需求选择：

- **需要 RAG 检索**：使用方案 2（智能跳过）+ 方案 4（更小模型）+ 方案 5（缓存）
- **不需要 RAG 检索**：使用方案 1（完全跳过）

---

## 预期效果

### 优化前
```
用户提问 → 等待 5-10 秒 → 开始看到 thinking
```

### 优化后（方案 1：跳过检索）
```
用户提问 → 等待 < 1 秒 → 开始看到 thinking
```

### 优化后（方案 2：智能跳过 + 缓存）
```
简单问题：用户提问 → 等待 < 1 秒 → 开始看到 thinking
复杂问题（首次）：用户提问 → 等待 3-5 秒 → 开始看到 thinking
复杂问题（缓存命中）：用户提问 → 等待 < 1 秒 → 开始看到 thinking
```

---

## 立即行动

**最快的验证方法（5 分钟）：**

1. 修改 `.env` 文件中的一行：
   ```bash
   STREAM_RETRIEVAL_MODE=none
   ```

2. 重启服务：
   ```bash
   cd backend/qa_assistant
   python -m uvicorn app:app --reload --port 8002
   ```

3. 测试问答，观察响应速度

如果响应变快了，说明问题确实在检索阶段，然后可以根据需求选择长期优化方案。

---

## 需要帮助？

如果测试后仍有问题，请提供：
1. `test_embedding_speed.py` 的输出结果
2. 后端日志中的 `[TIMING]` 相关输出
3. 你的具体需求（是否必须使用 RAG 检索）

我会根据实际情况提供更具体的优化建议。
