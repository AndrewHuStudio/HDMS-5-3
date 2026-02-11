# DeepSeek-R1 响应延迟诊断指南

## 已完成的工作

已在以下文件中添加了详细的时间戳日志：

1. **backend/qa_assistant/rag/embedder.py**
   - 记录 embedding API 调用耗时
   - 区分缓存命中和 API 调用

2. **backend/qa_assistant/rag/retriever.py**
   - 记录向量搜索总耗时
   - 分别记录 embedding 和 Milvus 查询耗时

3. **backend/qa_assistant/rag/service.py**
   - 记录整个流程的各个阶段耗时
   - 包括：意图分类、检索、上下文构建、LLM 调用、首个 token 返回

4. **backend/qa_assistant/routes/qa.py**
   - 记录请求到达时间和初始化耗时

## 测试步骤

### 1. 启动 QA Assistant 服务

```bash
cd backend/qa_assistant
python -m uvicorn app:app --reload --port 8002
```

### 2. 从前端发送测试问题

打开前端应用（http://localhost:3000），在问答界面输入一个测试问题，例如：
- "什么是容积率？"
- "深超总地块的建筑限高是多少？"
- "如何进行退线检测？"

### 3. 观察后端日志输出

在后端控制台中，你会看到类似以下的日志输出（按时间顺序）：

```
[TIMING] Request received at /qa/chat/stream
[TIMING] Request setup completed in 2.34ms
[TIMING] Stream started for question: 什么是容积率？...
[TIMING] Intent classification took 15.67ms
[TIMING] Starting retrieval (mode=vector, top_k=2)
[TIMING] Embedding API call starting for text length 7
[TIMING] Embedding API call completed - took 5234.56ms  ← 重点关注这里
[TIMING] Vector search - embedding took 5234.78ms
[TIMING] Vector search - Milvus query took 45.23ms
[TIMING] Vector search total - 2 results in 5280.12ms
[TIMING] Retrieval completed in 5281.45ms
[TIMING] Context building took 3.21ms
[TIMING] Prompt building took 1.89ms
[TIMING] Starting LLM API call to deepseek-r1
[TIMING] First token received after 234.56ms (total: 5537.89ms)
```

## 日志分析

### 关键指标

根据日志输出，重点关注以下几个时间点：

1. **Embedding API 调用时间**
   - 日志：`[TIMING] Embedding API call completed - took XXXms`
   - 正常范围：< 500ms
   - 如果 > 3000ms：说明 embedding API 响应慢

2. **Milvus 查询时间**
   - 日志：`[TIMING] Vector search - Milvus query took XXXms`
   - 正常范围：< 100ms
   - 如果 > 500ms：说明 Milvus 检索慢

3. **首个 token 返回时间**
   - 日志：`[TIMING] First token received after XXXms (total: XXXms)`
   - 正常范围：< 1000ms（从 LLM API 调用开始）
   - 如果 > 3000ms：说明 LLM API 响应慢

4. **总耗时**
   - 从 "Stream started" 到 "First token received" 的 total 时间
   - 目标：< 1000ms
   - 当前问题：5000-10000ms

### 诊断结果判断

**场景 1：Embedding API 慢（最可能）**
```
[TIMING] Embedding API call completed - took 5234.56ms  ← 5秒延迟在这里
[TIMING] Milvus query took 45.23ms
[TIMING] First token received after 234.56ms
```
**结论**：问题在 embedding API，需要优化 embedding 服务。

**场景 2：Milvus 慢**
```
[TIMING] Embedding API call completed - took 234.56ms
[TIMING] Milvus query took 5123.45ms  ← 5秒延迟在这里
[TIMING] First token received after 234.56ms
```
**结论**：问题在 Milvus 检索，需要优化 Milvus 配置。

**场景 3：LLM API 慢**
```
[TIMING] Embedding API call completed - took 234.56ms
[TIMING] Milvus query took 45.23ms
[TIMING] First token received after 5234.56ms  ← 5秒延迟在这里
```
**结论**：问题在 LLM API，需要检查网络或更换 API 端点。

## 优化方案

### 如果是 Embedding API 慢

#### 方案 1：跳过检索（最快）

对于简单问题，可以跳过 RAG 检索，直接调用 LLM：

修改 `.env` 文件：
```bash
# 将检索模式改为 none，完全跳过检索
STREAM_RETRIEVAL_MODE=none
```

或者在前端调用时设置 `use_retrieval=false`。

#### 方案 2：使用更快的 embedding 服务

如果你的 embedding API 提供商响应慢，可以：
1. 更换到更快的 API 提供商
2. 使用本地 embedding 模型（如 sentence-transformers）
3. 使用更小的 embedding 模型（如 text-embedding-3-small）

修改 `.env`：
```bash
EMBEDDING_MODEL=text-embedding-3-small  # 更小更快的模型
```

#### 方案 3：预热缓存

对于常见问题，可以预先生成 embedding 并缓存：

```python
# 创建一个预热脚本
from backend.qa_assistant.rag.embedder import create_embedding_service

embedder = create_embedding_service()

common_questions = [
    "什么是容积率？",
    "如何进行退线检测？",
    "建筑限高的标准是什么？",
    # ... 更多常见问题
]

for q in common_questions:
    embedder.embed_text(q)
    print(f"Cached: {q}")
```

#### 方案 4：增加缓存大小

修改 `.env`：
```bash
EMBEDDING_CACHE_MAX_SIZE=1024  # 从 256 增加到 1024
```

### 如果是 Milvus 慢

#### 方案 1：优化 Milvus 索引

检查 Milvus 的索引类型和参数，确保使用了高效的索引（如 HNSW）。

#### 方案 2：减少检索数量

已经设置为 2 了，这个应该不是问题。

#### 方案 3：检查 Milvus 资源

确保 Milvus 有足够的内存和 CPU 资源。

### 如果是 LLM API 慢

#### 方案 1：检查网络延迟

```bash
# 测试到 API 的网络延迟
ping api.apiyi.com
```

#### 方案 2：更换 API 端点

如果当前 API 端点慢，尝试更换到其他端点。

#### 方案 3：使用本地模型

考虑使用 Ollama 等本地部署方案。

## 快速验证

### 测试 1：完全跳过检索

修改 `.env`：
```bash
STREAM_RETRIEVAL_MODE=none
```

重启服务，测试问答。如果响应变快了，说明问题确实在检索阶段。

### 测试 2：测试 embedding API 速度

运行以下 Python 脚本：

```python
import time
import urllib.request
import json

start = time.perf_counter()

endpoint = "https://api.apiyi.com/v1/embeddings"
payload = {
    "model": "text-embedding-3-large",
    "input": "测试文本"
}

data = json.dumps(payload).encode("utf-8")
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY"
}

req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

with urllib.request.urlopen(req, timeout=30) as response:
    body = response.read().decode("utf-8")
    result = json.loads(body)

elapsed = (time.perf_counter() - start) * 1000
print(f"Embedding API took {elapsed:.2f}ms")
```

如果这个测试显示 > 3000ms，说明 embedding API 确实很慢。

## 预期结果

优化后，日志应该显示：

```
[TIMING] Request received at /qa/chat/stream
[TIMING] Request setup completed in 2.34ms
[TIMING] Stream started for question: 什么是容积率？...
[TIMING] Intent classification took 15.67ms
[TIMING] Starting retrieval (mode=vector, top_k=2)
[TIMING] Embedding cache hit - took 0.12ms  ← 缓存命中，非常快
[TIMING] Vector search - embedding took 0.23ms
[TIMING] Vector search - Milvus query took 45.23ms
[TIMING] Vector search total - 2 results in 45.56ms
[TIMING] Retrieval completed in 46.78ms
[TIMING] Context building took 3.21ms
[TIMING] Prompt building took 1.89ms
[TIMING] Starting LLM API call to deepseek-r1
[TIMING] First token received after 234.56ms (total: 302.45ms)  ← 总耗时 < 500ms
```

## 下一步

1. 运行测试，收集日志
2. 根据日志分析结果，确定延迟发生在哪个环节
3. 实施对应的优化方案
4. 再次测试验证

如果需要进一步帮助，请提供完整的日志输出。
