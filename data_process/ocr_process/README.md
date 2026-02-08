# HDMS OCR 辅助模块（MinerU）

> 最后更新：2026-02-06

该模块用于**上传资料 → MinerU OCR → 产物落盘**，并通过 Gradio 构建统一数据处理面板。

## 目录结构

```
data_process/
├── gradio_app/
│   └── app.py         # Gradio 入口
└── ocr_process/
    ├── core.py        # 纯业务逻辑（Gradio/FastAPI 复用）
    ├── server.py      # FastAPI 服务（薄包装）
    ├── mineru_client.py
    ├── run_ocr.py
    ├── test_mineru_api.py
    └── README.md
```

## 依赖

后端与 UI 依赖已在根目录 `requirements.txt` 中定义（fastapi/uvicorn/python-multipart/pypdf/gradio 等）。

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

### 1) 启动 Gradio 面板

```bash
# 进入项目根目录
cd e:\MyPrograms\HDMS

# 启动 Gradio（默认端口 7860）
python data_process\gradio_app\app.py
```

默认访问地址：`http://localhost:7860`

### 2) 启动 FastAPI（可选）

```bash
python -m uvicorn data_process.ocr_process.server:app --reload --port 8030
```

默认访问地址：`http://localhost:8030`

## 使用流程（Gradio）

1. **选择 PDF 文件**
2. **选择输出分类**（支持自定义）
3. **提交任务**，右侧查看进度与统计
4. **完成后查看输出目录**

## 输出目录

- OCR 产物：`data/ocr_output/<分类>/<文档名>/<文档名>.md`
- 元信息：`data/ocr_output/<分类>/<文档名>/<文档名>.meta.json`

删除 `data/ocr_output` 内的 `.md` 后，统计会在刷新时更新。

## API 端点（FastAPI）

- `GET /api/health` - 健康检查
- `GET /api/summary` - 获取 OCR 结果统计
- `GET /api/destinations` - 获取目标文件夹列表
- `POST /api/jobs` - 创建 OCR 任务（上传文件）
- `POST /api/jobs/from-source` - 从目录创建 OCR 任务
- `GET /api/jobs/{job_id}` - 获取任务状态

## 注意事项

1. **Windows 中文环境**：日志输出避免 emoji，使用 `[OK]`、`[FAIL]`、`[INFO]`
2. `gr.File` 返回临时文件路径，提交任务时会复制到 `data/ocr_tmp/`
3. `gr.Timer` 需要 Gradio 4.x，通过定时轮询更新状态
4. core.py 中所有原来抛 `HTTPException` 的地方已改为抛 `OCRError`
5. 任务存储在内存中，服务重启后会丢失

## 更新日志

### 2026-02-06
- [新增] `data_process/ocr_process/core.py` 业务逻辑抽离，Gradio/FastAPI 复用
- [新增] `data_process/gradio_app/app.py` Gradio 入口
- [变更] `data_process/ocr_process/server.py` 精简为薄包装
- [变更] README 更新为 Gradio 说明

---

如有问题，请查看后端控制台日志或联系开发团队。
