#!/usr/bin/env python3
"""
Export the 10 review-system check results as JSON files.

Outputs are written to:
  backend/approval_checklist/raw_results/<timestamp>/
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib import error, request


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_ROOT = SCRIPT_DIR.parent / "raw_results"


@dataclass
class HttpResult:
    ok: bool
    status_code: int | None
    response: Any | None
    response_text: str | None
    error_message: str | None


def post_json(url: str, payload: dict[str, Any], timeout: int) -> HttpResult:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(
        url=url,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as resp:  # nosec B310
            text = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(text) if text.strip() else None
            return HttpResult(
                ok=True,
                status_code=getattr(resp, "status", 200),
                response=parsed,
                response_text=text,
                error_message=None,
            )
    except error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        parsed: Any
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            parsed = None
        return HttpResult(
            ok=False,
            status_code=exc.code,
            response=parsed,
            response_text=text,
            error_message=f"HTTPError: {exc.code}",
        )
    except Exception as exc:  # noqa: BLE001
        return HttpResult(
            ok=False,
            status_code=None,
            response=None,
            response_text=None,
            error_message=f"{type(exc).__name__}: {exc}",
        )


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def make_record(
    *,
    check_name: str,
    endpoint: str,
    api_base: str,
    request_payload: dict[str, Any],
    started_at: str,
    finished_at: str,
    result: HttpResult,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {
        "check_name": check_name,
        "endpoint": endpoint,
        "url": f"{api_base}{endpoint}",
        "ok": result.ok,
        "status_code": result.status_code,
        "started_at": started_at,
        "finished_at": finished_at,
        "request": request_payload,
    }
    if result.ok:
        record["response"] = result.response
    else:
        record["error"] = {
            "message": result.error_message,
            "response": result.response,
            "response_text": result.response_text,
        }
    if extra:
        record.update(extra)
    return record


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize_sky_connections(raw_connections: Any) -> list[list[str]]:
    """Normalize prepare response connections into [[from, to], ...]."""
    normalized: list[list[str]] = []
    if not isinstance(raw_connections, list):
        return normalized

    for item in raw_connections:
        if isinstance(item, dict):
            from_name = item.get("from")
            to_name = item.get("to")
            if isinstance(from_name, str) and isinstance(to_name, str):
                normalized.append([from_name, to_name])
            continue

        if (
            isinstance(item, (list, tuple))
            and len(item) >= 2
            and isinstance(item[0], str)
            and isinstance(item[1], str)
        ):
            normalized.append([item[0], item[1]])

    return normalized


def run_single_check(
    *,
    check_name: str,
    endpoint: str,
    payload: dict[str, Any],
    api_base: str,
    timeout: int,
    run_dir: Path,
    extra: dict[str, Any] | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    started = now_iso()
    result = post_json(f"{api_base}{endpoint}", payload, timeout=timeout)
    finished = now_iso()
    record = make_record(
        check_name=check_name,
        endpoint=endpoint,
        api_base=api_base,
        request_payload=payload,
        started_at=started,
        finished_at=finished,
        result=result,
        extra=extra,
    )
    write_json(run_dir / f"{check_name}.json", record)
    if verbose:
        status = "OK" if result.ok else "FAIL"
        print(f"[{status}] {check_name} -> {endpoint}")
    return record


def export_all_checks(
    *,
    api_base: str,
    model_path: str,
    output_root: Path | str = DEFAULT_OUTPUT_ROOT,
    observer_x: float = 0.0,
    observer_y: float = 0.0,
    observer_z: float = 1.7,
    hemisphere_radius: float = 100.0,
    timeout: int = 180,
    run_id: str | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    api_base = normalize_api_base(api_base)
    output_root = Path(output_root).resolve()
    resolved_run_id = run_id or datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = output_root / resolved_run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    summary: dict[str, Any] = {
        "run_id": resolved_run_id,
        "api_base": api_base,
        "model_path": model_path,
        "run_dir": str(run_dir),
        "started_at": now_iso(),
        "checks": [],
    }

    regular_checks: list[tuple[str, str, dict[str, Any]]] = [
        ("fire_ladder", "/fire-ladder-check", {"model_path": model_path}),
        ("green_setback_check", "/green-setback-check", {"model_path": model_path}),
        ("height_check", "/height-check/pure-python", {"model_path": model_path}),
        ("pedestrian_entrance_check", "/pedestrian-entrance-check", {"model_path": model_path}),
        ("plaza_setback_check", "/plaza-setback-check", {"model_path": model_path}),
        ("setback_check", "/setback-check", {"model_path": model_path}),
        ("setback_rate_check", "/setback-rate-check", {"model_path": model_path}),
        ("vehicle_entrance_check", "/vehicle-entrance-check", {"model_path": model_path}),
    ]

    for name, endpoint, payload in regular_checks:
        record = run_single_check(
            check_name=name,
            endpoint=endpoint,
            payload=payload,
            api_base=api_base,
            timeout=timeout,
            run_dir=run_dir,
            verbose=verbose,
        )
        summary["checks"].append(record)

    sight_payload = {
        "model_path": model_path,
        "observer_position": {
            "x": observer_x,
            "y": observer_y,
            "z": observer_z,
        },
        "hemisphere_radius": hemisphere_radius,
    }
    sight_record = run_single_check(
        check_name="sight_corridor_check",
        endpoint="/sight-corridor/check",
        payload=sight_payload,
        api_base=api_base,
        timeout=timeout,
        run_dir=run_dir,
        verbose=verbose,
    )
    summary["checks"].append(sight_record)

    prepare_payload = {"model_path": model_path}
    prepare_result = post_json(
        f"{api_base}/sky-bridge-check/prepare",
        prepare_payload,
        timeout=timeout,
    )
    sky_connections: list[list[str]] = []
    if prepare_result.ok and isinstance(prepare_result.response, dict):
        sky_connections = normalize_sky_connections(prepare_result.response.get("connections"))

    sky_payload: dict[str, Any] = {"model_path": model_path, "connections": sky_connections}
    sky_extra = {
        "prepare_step": {
            "ok": prepare_result.ok,
            "status_code": prepare_result.status_code,
            "request": prepare_payload,
            "response": prepare_result.response,
            "error_message": prepare_result.error_message,
            "response_text": prepare_result.response_text,
        }
    }
    sky_record = run_single_check(
        check_name="sky_bridge_check",
        endpoint="/sky-bridge-check",
        payload=sky_payload,
        api_base=api_base,
        timeout=timeout,
        run_dir=run_dir,
        extra=sky_extra,
        verbose=verbose,
    )
    summary["checks"].append(sky_record)

    summary["finished_at"] = now_iso()
    summary["total"] = len(summary["checks"])
    summary["success"] = sum(1 for item in summary["checks"] if item.get("ok"))
    summary["failed"] = summary["total"] - summary["success"]

    write_json(run_dir / "summary.json", summary)

    if verbose:
        print("")
        print(f"Export done: {run_dir}")
        print(f"Success: {summary['success']}, Failed: {summary['failed']}")
        if summary["failed"] > 0:
            failed_names = [item.get("check_name") for item in summary["checks"] if not item.get("ok")]
            print("Failed checks:", ", ".join(str(name) for name in failed_names))

    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export review_system 10-check results to JSON files.",
    )
    parser.add_argument(
        "--api-base",
        default="http://127.0.0.1:8003",
        help="review_system base URL (default: http://127.0.0.1:8003)",
    )
    parser.add_argument(
        "--model-path",
        required=True,
        help="model_path accepted by review_system endpoints",
    )
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help=f"output root directory (default: {DEFAULT_OUTPUT_ROOT})",
    )
    parser.add_argument(
        "--observer-x",
        type=float,
        default=0.0,
        help="observer x for sight-corridor/check",
    )
    parser.add_argument(
        "--observer-y",
        type=float,
        default=0.0,
        help="observer y for sight-corridor/check",
    )
    parser.add_argument(
        "--observer-z",
        type=float,
        default=1.7,
        help="observer z for sight-corridor/check",
    )
    parser.add_argument(
        "--hemisphere-radius",
        type=float,
        default=100.0,
        help="hemisphere radius for sight-corridor/check",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="request timeout seconds (default: 180)",
    )
    return parser.parse_args()


def normalize_api_base(api_base: str) -> str:
    return api_base.rstrip("/")


def main() -> int:
    args = parse_args()
    export_all_checks(
        api_base=args.api_base,
        model_path=args.model_path,
        output_root=args.output_root,
        observer_x=args.observer_x,
        observer_y=args.observer_y,
        observer_z=args.observer_z,
        hemisphere_radius=args.hemisphere_radius,
        timeout=args.timeout,
        verbose=True,
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
