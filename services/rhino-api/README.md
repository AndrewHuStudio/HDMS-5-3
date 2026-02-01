HDMS Rhino Model API

说明:
- 用于在后端解析 .3dm，提取图层信息，并在需要时转换为前端可读模型格式。
- 当前仅提供最小脚手架，具体业务逻辑请在 rhino_api/services 下实现。

快速开始:
1) 创建虚拟环境
   python -m venv .venv
   .\.venv\Scripts\activate
2) 安装依赖
   pip install -r requirements.txt
3) 启动服务
   uvicorn rhino_api.main:app --reload --port 8000

## 限高检测（纯Python）
说明:
- 不依赖 Rhino.Compute 或 GHX 定义文件。
- 基于图层名称读取建筑体块与地块对象。
- 地块对象需设置 UserText：`限高值`（必填，兼容 `限高`）、`地块名称`（可选）。

环境变量:
- `MODEL_STORAGE_PATH` (默认 `../../data/uploads`)
- `CACHE_STORAGE_PATH` (默认 `../../data/cache`)
- `MAX_UPLOAD_MB` (默认 `500`)
- `CORS_ORIGINS` (默认 `http://localhost:3000,http://127.0.0.1:3000`)

接口:
- `POST /models/import` (multipart/form-data)
  - `file`: `.3dm` 文件（最大 500MB）
  - 返回: `model_id`, `model_path`, `layers` 等元信息

- `POST /height-check/pure-python` (JSON)
  - `model_path`: 服务器上的 `.3dm` 路径（支持相对 `data/uploads`）
  - `building_layer`: 建筑体块图层名（默认 `模型_建筑体块`）
  - `setback_layer`: 建筑退线图层名（默认 `限制_建筑退线`）
  - `plot_layer`: 地块图层名（默认 `场景_地块`）
  - `default_height_limit`: 默认限高（可选）

## 贴线率检测（纯Python）
说明:
- 读取建筑体块与建筑退线图层
- 将建筑体块投影到 XY 平面，计算与退线曲线的重合率
- 支持在退线对象 UserText 中设置 `地块名称`（可选）、`贴线率`（可选）

接口:
- `POST /setback-check` (JSON)
  - `model_path`: 服务器上的 `.3dm` 路径（支持相对 `data/uploads`）
  - `building_layer`: 建筑体块图层名（默认 `模型_建筑体块`）
  - `setback_layer`: 建筑退线图层名（默认 `限制_建筑退线`）
  - `sample_step`: 采样步长（米，默认 `1.0`）
  - `tolerance`: 距离容差（米，默认 `0.5`）
  - `required_rate`: 贴线率阈值（可选，0~1）

## 开发规范：接口隔离
- 视线通廊只改 `/sight-corridor/*`，限高只改 `/height-check/*`。
- 不要共用返回结构或复用同一个结果对象。
- 公共工具函数可以复用，但不要把视线通廊逻辑写进 `height_limit_pure.py`。
