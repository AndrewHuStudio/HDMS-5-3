#!/usr/bin/env python3
"""
Normalize exported raw check results into approval-checklist payload (v1).

Input:  backend/approval_checklist/raw_results/<run_id>/*.json
Output: backend/approval_checklist/raw_results/<run_id>/checklist_normalized_v1.json
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def to_reasons(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        return [text] if text else []
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
        return out
    return []


def add_item(
    bucket: list[dict[str, Any]],
    *,
    item_id: str,
    title: str,
    reasons: list[str] | None = None,
    metrics: dict[str, Any] | None = None,
) -> None:
    record: dict[str, Any] = {"item_id": item_id, "title": title}
    if reasons:
        record["reasons"] = reasons
    if metrics:
        record["metrics"] = metrics
    bucket.append(record)


def normalize_fire_ladder(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for row in resp.get("results", []) or []:
        idx = row.get("redline_index")
        name = row.get("display_name") or row.get("redline_name") or f"redline_{idx}"
        reasons = to_reasons(row.get("reasons"))
        metrics = {
            "length_sum": row.get("length_sum"),
            "length_required": row.get("length_required"),
        }
        status = str(row.get("status", "")).lower()
        if status == "pass":
            add_item(passed, item_id=f"redline_{idx}", title=name, reasons=reasons, metrics=metrics)
        elif status == "fail":
            add_item(failed, item_id=f"redline_{idx}", title=name, reasons=reasons, metrics=metrics)
        else:
            add_item(unknown, item_id=f"redline_{idx}", title=name, reasons=reasons, metrics=metrics)
    return passed, failed, unknown


def normalize_violation_results(
    resp: dict[str, Any],
    *,
    item_prefix: str,
    area_field: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for idx, row in enumerate(resp.get("results", []) or []):
        title = row.get("building_name") or f"{item_prefix}_{idx}"
        reasons = to_reasons(row.get("reasons"))
        metrics = {
            "height": row.get("height"),
            area_field: row.get(area_field),
        }
        is_violation = row.get("is_violation")
        item_id = str(row.get("object_id") or f"{item_prefix}_{idx}")
        if is_violation is True:
            add_item(failed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        elif is_violation is False:
            add_item(passed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
    return passed, failed, unknown


def normalize_height(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for row in resp.get("buildings", []) or []:
        idx = row.get("building_index")
        title = row.get("building_name") or f"building_{idx}"
        exceed = row.get("is_exceeded")
        metrics = {
            "actual_height": row.get("actual_height"),
            "height_limit": row.get("height_limit"),
            "exceed_amount": row.get("exceed_amount"),
            "plot_name": row.get("plot_name"),
        }
        item_id = str(row.get("object_id") or f"building_{idx}")
        if exceed is True:
            add_item(failed, item_id=item_id, title=title, metrics=metrics)
        elif exceed is False:
            add_item(passed, item_id=item_id, title=title, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, metrics=metrics)
    return passed, failed, unknown


def normalize_status_results(
    resp: dict[str, Any],
    *,
    item_prefix: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for idx, row in enumerate(resp.get("results", []) or []):
        title = row.get("name") or f"{item_prefix}_{idx}"
        status = str(row.get("status", "")).lower()
        reasons = to_reasons(row.get("reasons"))
        metrics = {
            "point": row.get("point"),
            "distances": row.get("distances"),
        }
        item_id = str(row.get("object_id") or f"{item_prefix}_{idx}")
        if status == "pass":
            add_item(passed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        elif status == "fail":
            add_item(failed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
    return passed, failed, unknown


def normalize_setback(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for row in resp.get("buildings", []) or []:
        idx = row.get("building_index")
        title = row.get("building_name") or f"building_{idx}"
        is_exceeded = row.get("is_exceeded")
        reasons = to_reasons(row.get("reason"))
        metrics = {"plot_name": row.get("plot_name")}
        item_id = str(row.get("object_id") or f"building_{idx}")
        if is_exceeded is True:
            add_item(failed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        elif is_exceeded is False:
            add_item(passed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
    return passed, failed, unknown


def normalize_setback_rate(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for idx, row in enumerate(resp.get("plots", []) or []):
        title = row.get("plot_name") or f"plot_{idx}"
        is_compliant = row.get("is_compliant")
        metrics = {
            "frontage_rate": row.get("frontage_rate"),
            "required_rate": row.get("required_rate"),
            "setback_length": row.get("setback_length"),
            "overlap_length": row.get("overlap_length"),
            "building_count": row.get("building_count"),
        }
        item_id = title
        if is_compliant is True:
            add_item(passed, item_id=item_id, title=title, metrics=metrics)
        elif is_compliant is False:
            add_item(failed, item_id=item_id, title=title, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, metrics=metrics)
    return passed, failed, unknown


def normalize_sight_corridor(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []

    for idx, row in enumerate(resp.get("visible_buildings", []) or []):
        title = row.get("building_name") or f"visible_{idx}"
        metrics = {"distance": row.get("distance"), "layer_name": row.get("layer_name")}
        add_item(passed, item_id=f"visible_{idx}", title=title, metrics=metrics)

    for idx, row in enumerate(resp.get("invisible_buildings", []) or []):
        title = row.get("building_name") or f"invisible_{idx}"
        reasons = to_reasons(row.get("reason"))
        metrics = {"distance": row.get("distance"), "layer_name": row.get("layer_name")}
        add_item(failed, item_id=f"invisible_{idx}", title=title, reasons=reasons, metrics=metrics)

    for idx, row in enumerate(resp.get("blocking_buildings", []) or []):
        title = row.get("building_name") or f"blocking_{idx}"
        metrics = {"distance": row.get("distance"), "layer_name": row.get("layer_name")}
        add_item(unknown, item_id=f"blocking_{idx}", title=title, metrics=metrics)

    return passed, failed, unknown


def normalize_sky_bridge(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []
    for idx, row in enumerate(resp.get("results", []) or []):
        plot_a = row.get("plot_a") or "unknown_a"
        plot_b = row.get("plot_b") or "unknown_b"
        title = f"{plot_a} -> {plot_b}"
        status = str(row.get("status", "")).lower()
        reasons = to_reasons(row.get("reasons"))
        metrics = {"corridors_count": len(row.get("corridors", []) or [])}
        item_id = str(row.get("connection_id") or f"connection_{idx}")
        if status == "pass":
            add_item(passed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        elif status == "fail":
            add_item(failed, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
        else:
            add_item(unknown, item_id=item_id, title=title, reasons=reasons, metrics=metrics)
    return passed, failed, unknown


def normalize_plaza_setback(resp: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    passed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    unknown: list[dict[str, Any]] = []

    area_results = resp.get("area_results") or []
    if area_results:
        for idx, row in enumerate(area_results):
            title = row.get("name") or f"plaza_{idx}"
            status = str(row.get("status", "")).lower()
            metrics = {
                "checked_buildings": row.get("checked_buildings"),
                "violations": row.get("violations"),
            }
            item_id = title
            if status == "pass":
                add_item(passed, item_id=item_id, title=title, metrics=metrics)
            elif status == "fail":
                add_item(failed, item_id=item_id, title=title, metrics=metrics)
            else:
                add_item(unknown, item_id=item_id, title=title, metrics=metrics)
        return passed, failed, unknown

    return normalize_violation_results(resp, item_prefix="plaza", area_field="plaza_name")


Normalizer = Callable[[dict[str, Any]], tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]]


CHECK_DEFS: list[dict[str, Any]] = [
    {
        "check_id": "height-check",
        "check_name": "限高检测",
        "file_name": "height_check.json",
        "normalizer": normalize_height,
    },
    {
        "check_id": "setback-check",
        "check_name": "建筑退线检测",
        "file_name": "setback_check.json",
        "normalizer": normalize_setback,
    },
    {
        "check_id": "setback-rate-check",
        "check_name": "贴线率检测",
        "file_name": "setback_rate_check.json",
        "normalizer": normalize_setback_rate,
    },
    {
        "check_id": "green-setback-check",
        "check_name": "绿地退线检测",
        "file_name": "green_setback_check.json",
        "normalizer": lambda r: normalize_violation_results(r, item_prefix="green", area_field="green_name"),
    },
    {
        "check_id": "plaza-setback-check",
        "check_name": "广场退线检测",
        "file_name": "plaza_setback_check.json",
        "normalizer": normalize_plaza_setback,
    },
    {
        "check_id": "sky-bridge",
        "check_name": "空中连廊检测",
        "file_name": "sky_bridge_check.json",
        "normalizer": normalize_sky_bridge,
    },
    {
        "check_id": "sight-corridor",
        "check_name": "视线通廊检测",
        "file_name": "sight_corridor_check.json",
        "normalizer": normalize_sight_corridor,
    },
    {
        "check_id": "fire-ladder",
        "check_name": "消防登高面检测",
        "file_name": "fire_ladder.json",
        "normalizer": normalize_fire_ladder,
    },
    {
        "check_id": "vehicle-entrance-check",
        "check_name": "车行出入口检测",
        "file_name": "vehicle_entrance_check.json",
        "normalizer": lambda r: normalize_status_results(r, item_prefix="vehicle"),
    },
    {
        "check_id": "pedestrian-entrance-check",
        "check_name": "人行出入口检测",
        "file_name": "pedestrian_entrance_check.json",
        "normalizer": lambda r: normalize_status_results(r, item_prefix="pedestrian"),
    },
]


def normalize_check(run_dir: Path, config: dict[str, Any]) -> dict[str, Any]:
    path = run_dir / config["file_name"]
    check_id = config["check_id"]
    check_name = config["check_name"]

    if not path.exists():
        return {
            "check_id": check_id,
            "check_name": check_name,
            "selected": True,
            "status": "error",
            "message": f"{check_name}检测功能异常，暂时无法显示",
            "error_message": f"file not found: {path.name}",
            "summary": {"total": 0, "passed": 0, "failed": 0, "unknown": 0},
            "passed_items": [],
            "failed_items": [],
            "unknown_items": [],
            "northeast_view": {
                "status": "missing",
                "image_path": None,
                "message": "待接入检测结果东北视角图",
            },
        }

    raw = read_json(path)
    if not raw.get("ok"):
        return {
            "check_id": check_id,
            "check_name": check_name,
            "selected": True,
            "status": "error",
            "message": f"{check_name}检测功能异常，暂时无法显示",
            "error_message": raw.get("error", {}).get("message"),
            "summary": {"total": 0, "passed": 0, "failed": 0, "unknown": 0},
            "passed_items": [],
            "failed_items": [],
            "unknown_items": [],
            "northeast_view": {
                "status": "missing",
                "image_path": None,
                "message": "待接入检测结果东北视角图",
            },
        }

    response = raw.get("response", {})
    normalizer: Normalizer = config["normalizer"]
    passed, failed, unknown = normalizer(response if isinstance(response, dict) else {})

    status = "pass"
    if failed:
        status = "fail"
    elif unknown:
        status = "warning"

    return {
        "check_id": check_id,
        "check_name": check_name,
        "selected": True,
        "status": status,
        "message": None,
        "error_message": None,
        "summary": {
            "total": len(passed) + len(failed) + len(unknown),
            "passed": len(passed),
            "failed": len(failed),
            "unknown": len(unknown),
        },
        "passed_items": passed,
        "failed_items": failed,
        "unknown_items": unknown,
        "raw_summary": response.get("summary"),
        "warnings": response.get("warnings", []),
        "northeast_view": {
            "status": "missing",
            "image_path": None,
            "message": "待接入检测结果东北视角图",
        },
    }


def build_payload(run_dir: Path, project_id: str | None) -> dict[str, Any]:
    checks = [normalize_check(run_dir, cfg) for cfg in CHECK_DEFS]
    checks_total = len(checks)
    checks_error = sum(1 for c in checks if c["status"] == "error")
    checks_fail = sum(1 for c in checks if c["status"] == "fail")

    total_items = sum(int(c["summary"]["total"]) for c in checks)
    total_passed = sum(int(c["summary"]["passed"]) for c in checks)
    total_failed = sum(int(c["summary"]["failed"]) for c in checks)
    total_unknown = sum(int(c["summary"]["unknown"]) for c in checks)

    return {
        "schema_version": "approval_checklist_v1",
        "generated_at": now_iso(),
        "source_run_id": run_dir.name,
        "project_id": project_id,
        "document": {
            "title": "城市规划管控要素审查表",
            "number": "",
            "plot_name": "未命名片区",
            "review_time": now_iso(),
            "selected_count": checks_total,
        },
        "checks": checks,
        "totals": {
            "checks_total": checks_total,
            "checks_error": checks_error,
            "checks_with_failures": checks_fail,
            "items_total": total_items,
            "items_passed": total_passed,
            "items_failed": total_failed,
            "items_unknown": total_unknown,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize raw review results into checklist payload v1.")
    parser.add_argument(
        "--run-dir",
        required=True,
        help="run folder under backend/approval_checklist/raw_results, or absolute folder path",
    )
    parser.add_argument("--project-id", default=None, help="project id for payload")
    parser.add_argument(
        "--output",
        default="checklist_normalized_v1.json",
        help="output file name under run-dir (default: checklist_normalized_v1.json)",
    )
    return parser.parse_args()


def resolve_run_dir(value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute() and candidate.exists():
        return candidate
    base = Path("backend/approval_checklist/raw_results")
    path = (base / value).resolve()
    if path.exists():
        return path
    raise FileNotFoundError(f"run dir not found: {value}")


def main() -> int:
    args = parse_args()
    run_dir = resolve_run_dir(args.run_dir)
    payload = build_payload(run_dir, project_id=args.project_id)
    output_path = run_dir / args.output
    write_json(output_path, payload)
    print(f"Normalized payload written to: {output_path}")
    print(
        "Totals: checks={checks_total}, error={checks_error}, failed_checks={checks_with_failures}, "
        "items={items_total}, failed_items={items_failed}".format(**payload["totals"])
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
