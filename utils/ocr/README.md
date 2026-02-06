# HDMS OCR 辅助模块（MinerU）

> 最后更新：2026-02-05

该模块独立于主前端，用于**上传资料 → MinerU OCR → 产物落盘**，并在网页中展示扫描统计。

## 最近更新（2026-02-05）

### 后端修复

1. **改进错误处理和日志记录**
   - 添加了完整的日志记录系统，使用 Python `logging` 模块
   - 记录每个处理步骤的详细信息（任务 ID、文件名、处理阶段）
   - 捕获异常时记录完整的堆栈跟踪，便于调试
   - 修复"未知错误"问题，现在会显示具体的错误类型和消息

2. **优化错误消息**
   - 改进 MinerU API 错误处理，提供更友好的中文错误提示
   - 添加详细的错误上下文信息（如 batch_id、请求参数等）
   - 区分不同类型的错误（API 错误、网络错误、超时等）

3. **增强日志输出**
   - 每个任务都有唯一的 job_id 前缀（前 8 位），便于追踪
   - 记录关键步骤：请求上传 URL、上传文件、轮询结果、下载结果
   - 记录 MinerU API 的响应详情，便于排查问题

### 前端美化

1. **视觉设计升级**
   - 采用现代渐变背景（紫色渐变主题）
   - 卡片使用毛玻璃效果（backdrop-filter）
   - 改进阴影和圆角，更加立体
   - 统一的配色方案（#667eea 到 #764ba2 渐变）

2. **动画效果**
   - 页面加载淡入动画
   - 卡片依次出现动画（stagger effect）
   - 按钮点击波纹效果
   - 进度条闪烁动画（shimmer effect）
   - 状态徽章脉冲动画
   - 错误提示抖动动画

3. **交互优化**
   - 所有可交互元素添加 hover 效果
   - 改进按钮样式，添加渐变和阴影
   - 优化输入框焦点状态
   - 改进进度条样式，添加渐变和动画
   - 统计卡片添加悬停放大效果

4. **细节改进**
   - 更大的字体和间距，提升可读性
   - 改进颜色对比度
   - 优化响应式布局
   - 改进错误提示样式，更加醒目

## 目录结构

```
utils/ocr/
├── server.py          # FastAPI 服务（本地中转 MinerU API）
├── ui/                # 轻量 React 前端
│   ├── src/
│   │   ├── App.jsx    # 主应用组件
│   │   ├── main.jsx   # 入口文件
│   │   └── styles.css # 样式文件（已美化）
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
└── README.md          # 本文档
```

## 依赖

后端依赖已在根目录 `requirements.txt` 中存在（fastapi/uvicorn/python-multipart/pypdf）。

前端依赖在 `utils/ocr/ui/package.json`。

## 配置（根目录 .env）

**必需配置**：
```env
MINERU_API_KEY=你的token
MINERU_BASE_URL=https://mineru.net/api/v4
OCR_OUTPUT_DIR=data/ocr_output
```

**可选配置**：
```env
MINERU_MODEL_VERSION=vlm
MINERU_POLL_TIMEOUT=300
MINERU_POLL_INTERVAL=3
OCR_MAX_WORKERS=2
OCR_INPUT_DIR=data/documents
```

## 启动方式

### 1) 启动 OCR 服务

```bash
# 进入项目根目录
cd e:\MyPrograms\HDMS

# 启动后端服务（端口 8030）
python -m uvicorn utils.ocr.server:app --reload --port 8030
```

### 2) 启动前端

```bash
# 进入前端目录
cd utils\ocr\ui

# 安装依赖（首次运行）
npm install

# 启动开发服务器
npm run dev
```

**默认访问地址**：
- 前端：http://localhost:5173
- 后端：http://localhost:8030

如需改后端地址，可设置：
```env
VITE_OCR_API_BASE=http://localhost:8030
```

## 使用流程

1. **选择文件**
   - 点击"选择文件夹"或"选择文件"按钮
   - 支持 PDF、Word、PPT、图片格式
   - 可以一次选择多个文件

2. **选择目标文件夹**
   - 从下拉列表中选择 OCR 结果存放的文件夹
   - 结果会保存到 `data/ocr_output/<目标文件夹>/<文档名>/`

3. **提交任务**
   - 点击"MinerU VLM OCR"按钮提交任务
   - 系统会显示处理进度

4. **查看结果**
   - 处理完成后，结果会自动保存到指定目录
   - 每个文档会生成 Markdown 文件和元数据文件

## 输出目录

- OCR 产物：`data/ocr_output/<分类>/<文档名>/<文档名>.md`
- 元信息：`data/ocr_output/<分类>/<文档名>/<文档名>.meta.json`

删除 `data/ocr_output` 内的 `.md` 后，前端列表会自动刷新。

## 功能说明

- **左侧卡片**：多文件上传 + 分类选择
- **中间卡片**：任务进度（百分比）与错误提示
- **右侧卡片**：按文件夹统计（文件数/页数）与总览

## 日志查看

后端日志会输出到控制台，格式如下：

```
2026-02-05 10:30:15 - __main__ - INFO - [Job 2ec156dc] Processing file: example.pdf
2026-02-05 10:30:16 - __main__ - INFO - [Job 2ec156dc] Requesting upload URL from MinerU
2026-02-05 10:30:17 - __main__ - INFO - [Job 2ec156dc] Got batch_id: abc123, uploading file
2026-02-05 10:30:20 - __main__ - INFO - [Job 2ec156dc] File uploaded successfully
2026-02-05 10:30:21 - __main__ - INFO - [Job 2ec156dc] Polling for OCR results (timeout: 300s)
2026-02-05 10:32:45 - __main__ - INFO - [Job 2ec156dc] OCR completed, downloading results
2026-02-05 10:32:50 - __main__ - INFO - [Job 2ec156dc] File processed successfully: example.pdf
```

如果出现错误，会记录完整的异常堆栈，便于调试。

## 常见问题

### 1. 显示"MINERU_API_KEY 未设置"

**解决方法**：在项目根目录的 `.env` 文件中添加 `MINERU_API_KEY=your_api_key_here`

### 2. 任务显示"失败"但没有详细错误

**解决方法**：查看后端控制台日志，会有完整的错误堆栈信息

### 3. 前端无法连接后端

**解决方法**：
- 确认后端服务已启动（端口 8030）
- 检查 CORS 配置
- 查看浏览器控制台是否有网络错误

### 4. OCR 超时

**解决方法**：
- 增加 `MINERU_POLL_TIMEOUT` 环境变量的值（默认 300 秒）
- 检查网络连接
- 查看 MinerU 服务状态

### 5. 服务重启后任务丢失

**说明**：任务存储在内存中，服务重启后会丢失。这是正常行为，重新提交任务即可。

## API 端点

### 后端 API（端口 8030）

- `GET /api/health` - 健康检查
- `GET /api/summary` - 获取 OCR 结果统计
- `GET /api/destinations` - 获取目标文件夹列表
- `POST /api/jobs` - 创建 OCR 任务（上传文件）
- `GET /api/jobs/{job_id}` - 获取任务状态

## 技术栈

### 后端
- FastAPI - Web 框架
- Python 3.10+ - 运行环境
- pypdf - PDF 页数统计
- MinerU API - OCR 服务

### 前端
- React 19 - UI 框架
- Vite - 构建工具
- CSS3 - 样式（渐变、动画、毛玻璃效果）

## 注意事项

1. **API Key 安全**：不要将 `MINERU_API_KEY` 提交到版本控制系统
2. **并发控制**：默认最多同时处理 2 个文件，可通过 `OCR_MAX_WORKERS` 调整
3. **文件大小**：大文件可能需要较长处理时间，建议分批处理
4. **网络要求**：需要稳定的网络连接到 MinerU 服务
5. **编码问题**：Windows 中文环境下，日志输出使用 ASCII 字符，避免编码问题

## 后续计划

- [ ] 添加任务持久化（数据库存储）
- [ ] 支持批量导入（从 data/documents 目录）
- [ ] 添加任务队列管理
- [ ] 支持任务取消和重试
- [ ] 集成到主应用的问答系统
- [ ] 添加 OCR 结果预览功能

## 更新日志

### 2026-02-05
- [修复] 修复 MinerU API 数据格式问题（data 字段为字典而非列表）
- [修复] 修复"未知错误"问题，改进错误处理
- [新增] 添加完整的日志记录系统，支持详细的任务追踪
- [优化] 美化前端界面，添加流畅的动画效果
- [优化] 改进文件列表显示，支持完整文件名和文件大小
- [优化] 优化用户体验和交互反馈

---

如有问题，请查看后端控制台日志或联系开发团队。
