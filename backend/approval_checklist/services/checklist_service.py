"""Business service for approval checklist generation and persistence."""

from __future__ import annotations

import html
import logging
import math
import re
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    from pymongo import MongoClient
    from pymongo.collection import Collection
    from pymongo.errors import PyMongoError
except ModuleNotFoundError:  # pragma: no cover - allow non-draft APIs without pymongo installed
    MongoClient = None  # type: ignore[assignment]
    Collection = Any  # type: ignore[assignment]

    class PyMongoError(Exception):
        """Fallback error type when pymongo is unavailable."""

try:
    from ..core import config
    from ..scripts.export_review_results import export_all_checks
    from ..scripts.normalize_raw_results import CHECK_DEFS, build_payload
except ImportError:  # pragma: no cover - support `uvicorn app:app --app-dir backend/approval_checklist`
    from core import config
    from scripts.export_review_results import export_all_checks
    from scripts.normalize_raw_results import CHECK_DEFS, build_payload


CHECK_ID_TO_NAME = {str(item["check_id"]): str(item["check_name"]) for item in CHECK_DEFS}
ALL_CHECK_IDS = list(CHECK_ID_TO_NAME.keys())
SAFE_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
NORTHEAST_VIEW_DIRNAME = "northeast_views"
NORTHEAST_FALLBACK_EXT = "svg"
NORTHEAST_REAL_EXT = "png"
MAX_RENDER_TRIANGLES = 120000

logger = logging.getLogger(__name__)

try:
    import rhino3dm
except ModuleNotFoundError:  # pragma: no cover - allow startup without rhino3dm
    rhino3dm = None  # type: ignore[assignment]

try:
    from PIL import Image, ImageDraw
except ModuleNotFoundError:  # pragma: no cover - allow startup without Pillow
    Image = None  # type: ignore[assignment]
    ImageDraw = None  # type: ignore[assignment]


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ChecklistService:
    def __init__(self) -> None:
        self._mongo_client: Any = None
        self._index_ready = False

    def get_check_catalog(self) -> list[dict[str, Any]]:
        return [
            {
                "check_id": check_id,
                "check_name": CHECK_ID_TO_NAME[check_id],
                "default_selected": True,
            }
            for check_id in ALL_CHECK_IDS
        ]

    def generate_checklist(
        self,
        *,
        project_id: str,
        model_path: str,
        selected_check_ids: list[str] | None = None,
        observer_position: dict[str, float] | None = None,
        hemisphere_radius: float = 100.0,
    ) -> dict[str, Any]:
        observer = observer_position or {"x": 0.0, "y": 0.0, "z": 1.7}
        summary = export_all_checks(
            api_base=config.REVIEW_SYSTEM_BASE_URL,
            model_path=model_path,
            output_root=config.APPROVAL_RAW_RESULTS_ROOT,
            observer_x=float(observer.get("x", 0.0)),
            observer_y=float(observer.get("y", 0.0)),
            observer_z=float(observer.get("z", 1.7)),
            hemisphere_radius=float(hemisphere_radius),
            timeout=180,
            verbose=False,
        )

        run_id = str(summary["run_id"])
        run_dir = Path(str(summary["run_dir"]))
        payload = build_payload(run_dir, project_id=project_id)
        payload.setdefault("document", {})
        payload["document"]["review_time"] = _now_iso()
        payload["document"].setdefault("number", "")
        payload["document"].setdefault("plot_name", "未命名片区")

        self._apply_selection(payload, selected_check_ids)
        self._attach_northeast_views(
            payload=payload,
            run_id=run_id,
            run_dir=run_dir,
            model_path=model_path,
        )
        payload["source"] = {
            "run_id": run_id,
            "model_path": model_path,
            "review_api_base": config.REVIEW_SYSTEM_BASE_URL,
            "raw_run_dir": str(run_dir),
        }
        return {
            "run_id": run_id,
            "run_dir": str(run_dir),
            "payload": payload,
        }

    def save_draft(
        self,
        *,
        project_id: str,
        checklist_payload: dict[str, Any],
        number: str = "",
        plot_name: str = "未命名片区",
        review_comment: str = "",
        conclusion: str = "",
    ) -> dict[str, Any]:
        collection = self._get_collection()
        now = _now_iso()
        payload = dict(checklist_payload)
        payload_document = dict(payload.get("document") or {})
        payload_document["number"] = number
        payload_document["plot_name"] = plot_name
        payload_document["review_comment"] = review_comment
        payload_document["conclusion"] = conclusion
        payload_document["updated_at"] = now
        payload["document"] = payload_document
        update = {
            "project_id": project_id,
            "checklist_payload": payload,
            "number": number,
            "plot_name": plot_name,
            "review_comment": review_comment,
            "conclusion": conclusion,
            "updated_at": now,
        }
        collection.update_one(
            {"project_id": project_id},
            {"$set": update, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        doc = collection.find_one({"project_id": project_id}, {"_id": 0})
        if not doc:
            doc = {
                **update,
                "created_at": now,
            }
        return doc

    def get_draft(self, project_id: str) -> dict[str, Any] | None:
        collection = self._get_collection()
        doc = collection.find_one({"project_id": project_id}, {"_id": 0})
        return doc

    def export_pdf(self, payload: dict[str, Any]) -> bytes:
        lines = self._render_pdf_lines(payload)
        wrapped = self._wrap_lines(lines, max_chars=90)
        return self._build_simple_pdf(wrapped)

    def _get_collection(self) -> Collection:
        if MongoClient is None:
            raise PyMongoError("pymongo is not installed")
        if self._mongo_client is None:
            self._mongo_client = MongoClient(config.MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Verify connection and fail fast if db is down.
        self._mongo_client.admin.command("ping")
        collection = self._mongo_client[config.MONGODB_DATABASE][config.APPROVAL_DRAFT_COLLECTION]
        if not self._index_ready:
            collection.create_index("project_id", unique=True)
            self._index_ready = True
        return collection

    def _apply_selection(self, payload: dict[str, Any], selected_check_ids: list[str] | None) -> None:
        selected_set = set(selected_check_ids or ALL_CHECK_IDS)
        selected_checks: list[dict[str, Any]] = []
        for check in payload.get("checks", []):
            check_id = str(check.get("check_id", ""))
            check_name = str(check.get("check_name", check_id))
            is_error = check.get("status") == "error"
            is_selected = (check_id in selected_set) and not is_error
            check["selected"] = is_selected
            if is_error:
                check["message"] = f"{check_name}检测功能异常，暂时无法显示"
            if is_selected:
                selected_checks.append(check)

        payload.setdefault("document", {})
        payload["document"]["selected_count"] = len(selected_checks)
        payload["selected_totals"] = {
            "checks_total": len(selected_checks),
            "checks_error": sum(1 for item in selected_checks if item.get("status") == "error"),
            "checks_with_failures": sum(1 for item in selected_checks if item.get("status") == "fail"),
            "items_total": sum(int(item.get("summary", {}).get("total", 0)) for item in selected_checks),
            "items_passed": sum(int(item.get("summary", {}).get("passed", 0)) for item in selected_checks),
            "items_failed": sum(int(item.get("summary", {}).get("failed", 0)) for item in selected_checks),
            "items_unknown": sum(int(item.get("summary", {}).get("unknown", 0)) for item in selected_checks),
        }

    def resolve_northeast_view_path(self, run_id: str, view_name: str) -> Path | None:
        if not SAFE_TOKEN_PATTERN.fullmatch(run_id):
            return None
        if not SAFE_TOKEN_PATTERN.fullmatch(view_name):
            return None
        base_root = config.APPROVAL_RAW_RESULTS_ROOT.resolve()
        view_path = (base_root / run_id / NORTHEAST_VIEW_DIRNAME / view_name).resolve()
        if not str(view_path).startswith(str(base_root)):
            return None
        return view_path

    def _attach_northeast_views(
        self,
        *,
        payload: dict[str, Any],
        run_id: str,
        run_dir: Path,
        model_path: str,
    ) -> None:
        view_dir = run_dir / NORTHEAST_VIEW_DIRNAME
        view_dir.mkdir(parents=True, exist_ok=True)

        real_view_url, real_view_message = self._build_real_northeast_view(
            run_id=run_id,
            view_dir=view_dir,
            model_path=model_path,
        )

        for check in payload.get("checks", []):
            check_id = str(check.get("check_id", "")).strip()
            check_name = str(check.get("check_name", check_id)).strip()
            summary = check.get("summary") or {}
            passed = int(summary.get("passed", 0))
            failed = int(summary.get("failed", 0))
            unknown = int(summary.get("unknown", 0))
            status = str(check.get("status", "unknown"))

            if not SAFE_TOKEN_PATTERN.fullmatch(check_id):
                check["northeast_view"] = {
                    "status": "missing",
                    "image_path": None,
                    "message": "检测项标识不合法，无法生成东北视角图",
                }
                continue

            if real_view_url:
                check["northeast_view"] = {
                    "status": "ok",
                    "image_path": real_view_url,
                    "message": real_view_message,
                }
                continue

            svg_content = self._build_northeast_svg(
                check_name=check_name,
                status=status,
                passed=passed,
                failed=failed,
                unknown=unknown,
            )
            fallback_name = f"{check_id}.{NORTHEAST_FALLBACK_EXT}"
            output_path = view_dir / fallback_name
            output_path.write_text(svg_content, encoding="utf-8")
            check["northeast_view"] = {
                "status": "ok",
                "image_path": f"/approval-checklist/runs/{quote(run_id)}/views/{quote(fallback_name)}",
                "message": f"{real_view_message}，已降级为摘要图",
            }

    def _build_real_northeast_view(self, *, run_id: str, view_dir: Path, model_path: str) -> tuple[str | None, str]:
        model_file = self._resolve_model_file_path(model_path)
        if model_file is None:
            return None, "未找到模型文件，无法生成3D东北截图"
        if rhino3dm is None or Image is None or ImageDraw is None:
            return None, "渲染依赖缺失（rhino3dm/Pillow），无法生成3D东北截图"

        view_name = f"model-ne.{NORTHEAST_REAL_EXT}"
        output_path = view_dir / view_name
        try:
            self._render_real_northeast_png(model_file=model_file, output_path=output_path)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to render real northeast screenshot: model=%s", model_file)
            return None, f"3D东北截图生成失败（{exc}）"

        return (
            f"/approval-checklist/runs/{quote(run_id)}/views/{quote(view_name)}",
            "东北视角图已接入（3D模型真实截图）",
        )

    def _resolve_model_file_path(self, model_path: str) -> Path | None:
        normalized = (model_path or "").strip()
        if not normalized:
            return None

        direct = Path(normalized)
        if direct.is_file():
            return direct.resolve()

        candidates = [
            config.MODEL_STORAGE_PATH,
            config.PROJECT_ROOT / "data" / "uploads",
            config.PROJECT_ROOT / "data" / "model_external",
        ]
        for base in candidates:
            target = (Path(base) / normalized).resolve()
            if target.is_file():
                return target
        return None

    @staticmethod
    def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    @staticmethod
    def _cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
        return (
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        )

    @staticmethod
    def _normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
        norm = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
        if norm <= 1e-9:
            return (0.0, 0.0, 0.0)
        return (v[0] / norm, v[1] / norm, v[2] / norm)

    def _iter_meshes(self, geometry: Any) -> list[Any]:
        if rhino3dm is None:
            return []
        meshes: list[Any] = []
        if isinstance(geometry, rhino3dm.Mesh):
            meshes.append(geometry)
            return meshes

        if isinstance(geometry, rhino3dm.Brep):
            for face in geometry.Faces:
                for mesh_type in (
                    rhino3dm.MeshType.Render,
                    rhino3dm.MeshType.Preview,
                    rhino3dm.MeshType.Analysis,
                ):
                    mesh = face.GetMesh(mesh_type)
                    if mesh is not None and mesh.Faces.Count > 0:
                        meshes.append(mesh)
                        break
            return meshes

        if isinstance(geometry, rhino3dm.Extrusion):
            for mesh_type in (
                rhino3dm.MeshType.Render,
                rhino3dm.MeshType.Preview,
                rhino3dm.MeshType.Analysis,
            ):
                mesh = geometry.GetMesh(mesh_type)
                if mesh is not None and mesh.Faces.Count > 0:
                    meshes.append(mesh)
                    break
            return meshes

        return meshes

    def _collect_triangles(self, file3dm: Any, *, limit: int = MAX_RENDER_TRIANGLES) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
        triangles: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]] = []
        for obj in file3dm.Objects:
            geometry = getattr(obj, "Geometry", None)
            if geometry is None:
                continue
            for mesh in self._iter_meshes(geometry):
                vertices = [(float(v.X), float(v.Y), float(v.Z)) for v in mesh.Vertices]
                vertex_count = len(vertices)
                if vertex_count == 0:
                    continue
                for face in mesh.Faces:
                    a, b, c, d = int(face[0]), int(face[1]), int(face[2]), int(face[3])
                    if a >= vertex_count or b >= vertex_count or c >= vertex_count or d >= vertex_count:
                        continue
                    triangles.append((vertices[a], vertices[b], vertices[c]))
                    if not (c == d or d == a or d == b):
                        triangles.append((vertices[a], vertices[c], vertices[d]))
                    if len(triangles) >= limit:
                        return triangles
        return triangles

    def _render_real_northeast_png(self, *, model_file: Path, output_path: Path) -> None:
        if rhino3dm is None or Image is None or ImageDraw is None:
            raise RuntimeError("rhino3dm/Pillow is not available")

        file3dm = rhino3dm.File3dm.Read(str(model_file))
        if file3dm is None:
            raise RuntimeError(f"无法读取模型: {model_file}")

        triangles = self._collect_triangles(file3dm)
        if not triangles:
            raise RuntimeError("模型中未找到可渲染网格")

        view_dir = self._normalize((-1.0, -1.0, -1.0))
        world_up = (0.0, 0.0, 1.0)
        right = self._normalize(self._cross(view_dir, world_up))
        up = self._normalize(self._cross(right, view_dir))
        light_dir = self._normalize((-0.6, -0.4, 1.0))

        projected: list[tuple[float, list[tuple[float, float]], float]] = []
        min_x = float("inf")
        max_x = float("-inf")
        min_y = float("inf")
        max_y = float("-inf")

        for p1, p2, p3 in triangles:
            points_3d = (p1, p2, p3)
            points_2d: list[tuple[float, float]] = []
            depth_sum = 0.0
            for point in points_3d:
                px = self._dot(point, right)
                py = self._dot(point, up)
                pz = self._dot(point, view_dir)
                points_2d.append((px, py))
                depth_sum += pz
                min_x = min(min_x, px)
                max_x = max(max_x, px)
                min_y = min(min_y, py)
                max_y = max(max_y, py)

            edge_a = (p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2])
            edge_b = (p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2])
            normal = self._normalize(self._cross(edge_a, edge_b))
            brightness = 0.35 + 0.65 * abs(self._dot(normal, light_dir))
            projected.append((depth_sum / 3.0, points_2d, brightness))

        span_x = max(1e-6, max_x - min_x)
        span_y = max(1e-6, max_y - min_y)
        width = 1280
        height = 720
        padding = 36
        scale = min((width - 2 * padding) / span_x, (height - 2 * padding) / span_y)

        image = Image.new("RGBA", (width, height), (246, 250, 255, 255))
        draw = ImageDraw.Draw(image, "RGBA")

        def to_screen(pt: tuple[float, float]) -> tuple[float, float]:
            x = (pt[0] - min_x) * scale + padding
            y = (max_y - pt[1]) * scale + padding
            return (x, y)

        for _depth, tri2d, brightness in sorted(projected, key=lambda item: item[0], reverse=True):
            points = [to_screen(point) for point in tri2d]
            r = int(35 + 70 * brightness)
            g = int(70 + 90 * brightness)
            b = int(115 + 100 * brightness)
            draw.polygon(points, fill=(r, g, b, 190), outline=(16, 32, 64, 60))

        draw.text((22, 16), "3D模型东北视角截图", fill=(21, 35, 58, 255))
        draw.text((22, 40), model_file.name, fill=(76, 98, 126, 255))

        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.convert("RGB").save(output_path, format="PNG", optimize=True)

    def _build_northeast_svg(
        self,
        *,
        check_name: str,
        status: str,
        passed: int,
        failed: int,
        unknown: int,
    ) -> str:
        title = html.escape(check_name or "未命名检测项")
        status_text = html.escape(status or "unknown")

        max_count = max(1, passed, failed, unknown)
        scale = 180 / max_count
        pass_w = round(passed * scale, 2)
        fail_w = round(failed * scale, 2)
        unknown_w = round(unknown * scale, 2)

        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240" viewBox="0 0 560 240">
  <rect x="0" y="0" width="560" height="240" fill="#f8fafc"/>
  <text x="20" y="34" font-size="16" font-family="Arial, sans-serif" fill="#0f172a">东北视角图（检测摘要）</text>
  <text x="20" y="58" font-size="14" font-family="Arial, sans-serif" fill="#334155">{title}</text>
  <text x="20" y="80" font-size="12" font-family="Arial, sans-serif" fill="#64748b">状态：{status_text}</text>

  <polygon points="420,32 520,82 420,132 320,82" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5"/>
  <text x="410" y="88" font-size="11" font-family="Arial, sans-serif" fill="#334155">NE</text>

  <text x="20" y="124" font-size="12" font-family="Arial, sans-serif" fill="#334155">通过</text>
  <rect x="70" y="112" width="{pass_w}" height="14" fill="#10b981"/>
  <text x="{76 + pass_w}" y="124" font-size="12" font-family="Arial, sans-serif" fill="#0f172a">{passed}</text>

  <text x="20" y="156" font-size="12" font-family="Arial, sans-serif" fill="#334155">不通过</text>
  <rect x="70" y="144" width="{fail_w}" height="14" fill="#ef4444"/>
  <text x="{76 + fail_w}" y="156" font-size="12" font-family="Arial, sans-serif" fill="#0f172a">{failed}</text>

  <text x="20" y="188" font-size="12" font-family="Arial, sans-serif" fill="#334155">待确认</text>
  <rect x="70" y="176" width="{unknown_w}" height="14" fill="#f59e0b"/>
  <text x="{76 + unknown_w}" y="188" font-size="12" font-family="Arial, sans-serif" fill="#0f172a">{unknown}</text>
</svg>
"""

    def _render_pdf_lines(self, payload: dict[str, Any]) -> list[str]:
        document = payload.get("document", {})
        totals = payload.get("selected_totals", payload.get("totals", {}))
        lines: list[str] = []
        lines.append(str(document.get("title") or "城市规划管控要素审查表"))
        lines.append(f"编号: {document.get('number', '')}")
        lines.append(f"片区名称: {document.get('plot_name', '未命名片区')}")
        lines.append(f"审查检测时间: {document.get('review_time', _now_iso())}")
        lines.append(f"要素数量: {document.get('selected_count', 0)}")
        lines.append("")
        lines.append("=== 管控要素审查明细 ===")

        for check in payload.get("checks", []):
            if not check.get("selected", True):
                continue
            check_name = str(check.get("check_name", "未命名检测项"))
            check_status = str(check.get("status", "unknown"))
            summary = check.get("summary", {})
            lines.append(f"[{check_name}] 状态: {check_status}")
            lines.append(
                "通过: {passed}  不通过: {failed}  待确认: {unknown}".format(
                    passed=summary.get("passed", 0),
                    failed=summary.get("failed", 0),
                    unknown=summary.get("unknown", 0),
                )
            )

            failed_items = check.get("failed_items", []) or []
            if failed_items:
                lines.append("不通过项:")
                for item in failed_items[:12]:
                    title = str(item.get("title", "未命名"))
                    reasons = item.get("reasons", []) or []
                    reason_text = ", ".join(str(reason) for reason in reasons) if reasons else "-"
                    lines.append(f"- {title} | 原因: {reason_text}")
                if len(failed_items) > 12:
                    lines.append(f"- ... 共 {len(failed_items)} 项，仅展示前 12 项")
            else:
                lines.append("不通过项: 无")

            northeast_view = check.get("northeast_view") or {}
            northeast_message = str(northeast_view.get("message") or "待接入")
            lines.append(f"东北视角图: {northeast_message}")
            lines.append("")

        lines.append("=== 审查意见 ===")
        lines.append(str(document.get("review_comment", "")))
        lines.append("")
        lines.append("=== 审查结论 ===")
        lines.append(str(document.get("conclusion", "")))
        lines.append("")
        lines.append("=== 汇总 ===")
        lines.append(
            "检测项: {checks_total}, 含不通过项检测: {checks_with_failures}".format(
                checks_total=totals.get("checks_total", 0),
                checks_with_failures=totals.get("checks_with_failures", 0),
            )
        )
        lines.append(
            "条目总数: {items_total}, 通过: {items_passed}, 不通过: {items_failed}, 待确认: {items_unknown}".format(
                items_total=totals.get("items_total", 0),
                items_passed=totals.get("items_passed", 0),
                items_failed=totals.get("items_failed", 0),
                items_unknown=totals.get("items_unknown", 0),
            )
        )
        lines.append("")
        lines.append(f"生成时间: {_now_iso()}")
        return lines

    def _wrap_lines(self, lines: list[str], max_chars: int) -> list[str]:
        wrapped: list[str] = []
        for raw_line in lines:
            line = raw_line.rstrip()
            if not line:
                wrapped.append("")
                continue
            fragments = textwrap.wrap(
                line,
                width=max_chars,
                break_long_words=True,
                break_on_hyphens=False,
            )
            wrapped.extend(fragments or [""])
        return wrapped

    def _sanitize_pdf_text(self, text: str) -> str:
        # The built-in Helvetica font in this minimal writer is Latin-1 only.
        return text.encode("latin-1", "replace").decode("latin-1")

    def _pdf_escape(self, text: str) -> str:
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        return escaped

    def _build_simple_pdf(self, lines: list[str]) -> bytes:
        page_width = 595.0
        page_height = 842.0
        margin = 40.0
        font_size = 11.0
        line_height = 14.0
        max_lines = max(1, int((page_height - margin * 2) // line_height))
        pages = [lines[i : i + max_lines] for i in range(0, len(lines), max_lines)] or [[]]

        content_streams: list[bytes] = []
        for page_lines in pages:
            y_start = page_height - margin - font_size
            stream_lines = [
                "BT",
                f"/F1 {font_size:.2f} Tf",
                f"{margin:.2f} {y_start:.2f} Td",
            ]
            first_line = True
            for line in page_lines:
                safe_line = self._pdf_escape(self._sanitize_pdf_text(line))
                if not first_line:
                    stream_lines.append(f"0 -{line_height:.2f} Td")
                stream_lines.append(f"({safe_line}) Tj")
                first_line = False
            stream_lines.append("ET")
            content_streams.append("\n".join(stream_lines).encode("latin-1", "replace"))

        page_count = len(content_streams)
        catalog_id = 1
        pages_id = 2
        page_obj_ids = list(range(3, 3 + page_count))
        content_obj_ids = list(range(3 + page_count, 3 + page_count * 2))
        font_id = 3 + page_count * 2

        objects: dict[int, bytes] = {}
        objects[catalog_id] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii")
        kids = " ".join(f"{obj_id} 0 R" for obj_id in page_obj_ids)
        objects[pages_id] = (
            f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode("ascii")
        )

        for idx, page_obj_id in enumerate(page_obj_ids):
            content_obj_id = content_obj_ids[idx]
            objects[page_obj_id] = (
                "<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {w:.2f} {h:.2f}] "
                "/Resources << /Font << /F1 {font_id} 0 R >> >> "
                "/Contents {content_id} 0 R >>"
            ).format(
                pages_id=pages_id,
                w=page_width,
                h=page_height,
                font_id=font_id,
                content_id=content_obj_id,
            ).encode("ascii")

        for idx, content_obj_id in enumerate(content_obj_ids):
            stream = content_streams[idx]
            header = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii")
            footer = b"\nendstream"
            objects[content_obj_id] = header + stream + footer

        objects[font_id] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

        max_obj_id = font_id
        pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: dict[int, int] = {}

        for obj_id in range(1, max_obj_id + 1):
            offsets[obj_id] = len(pdf)
            pdf.extend(f"{obj_id} 0 obj\n".encode("ascii"))
            pdf.extend(objects[obj_id])
            pdf.extend(b"\nendobj\n")

        xref_pos = len(pdf)
        pdf.extend(f"xref\n0 {max_obj_id + 1}\n".encode("ascii"))
        pdf.extend(b"0000000000 65535 f \n")
        for obj_id in range(1, max_obj_id + 1):
            pdf.extend(f"{offsets[obj_id]:010d} 00000 n \n".encode("ascii"))

        pdf.extend(
            (
                "trailer\n"
                f"<< /Size {max_obj_id + 1} /Root {catalog_id} 0 R >>\n"
                "startxref\n"
                f"{xref_pos}\n"
                "%%EOF\n"
            ).encode("ascii")
        )
        return bytes(pdf)


checklist_service = ChecklistService()
