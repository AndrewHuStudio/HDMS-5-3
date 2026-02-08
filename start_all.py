from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"


def _enable_windows_ansi() -> None:
    if not IS_WINDOWS:
        return
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint()
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)) != 0:
            kernel32.SetConsoleMode(handle, mode.value | 0x0004)
    except Exception:
        return


_enable_windows_ansi()
_COLOR_ENABLED = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


class _Colors:
    RESET = "\x1b[0m"
    BOLD = "\x1b[1m"
    DIM = "\x1b[2m"
    RED = "\x1b[31m"
    GREEN = "\x1b[32m"
    YELLOW = "\x1b[33m"
    BLUE = "\x1b[34m"
    MAGENTA = "\x1b[35m"
    CYAN = "\x1b[36m"


def _color(text: str, color: str) -> str:
    if not _COLOR_ENABLED:
        return text
    return f"{color}{text}{_Colors.RESET}"


def _print_header(text: str) -> None:
    line = "=" * max(60, len(text))
    header = _color(text, _Colors.CYAN)
    bar = _color(line, _Colors.CYAN)
    print(f"\n{bar}\n{header}\n{bar}")


DISPLAY_NAMES = {
    "review_system": "管控审查系统",
    "qa_assistant": "管控问答助手",
    "approval_checklist": "管控审批清单",
    "data_process": "数据处理服务",
    "data_process_gradio": "数据处理 Gradio",
    "nginx": "Nginx 网关",
    "frontend": "前端（Next.js）",
}

PORT_CHECKS: list[tuple[str, int]] = [
    ("nginx", 8000),
    ("review_system", 8001),
    ("qa_assistant", 8002),
    ("approval_checklist", 8003),
    ("data_process", 8004),
    ("frontend", 3000),
    ("data_process_gradio", 7860),
]


HDMS_CMD_MARKERS = [
    str(ROOT).lower(),
    "data_process.main:app",
    "backend\\review_system",
    "backend\\qa_assistant",
    "backend\\approval_checklist",
    "gradio_app\\app.py",
    "nginx\\hdms.conf",
    "npm run dev",
]


def _label(name: str) -> str:
    return DISPLAY_NAMES.get(name, name)


@dataclass
class Service:
    name: str
    cmd: list[str]
    cwd: Path
    ready_urls: list[str]


@dataclass
class CleanupItem:
    port: int
    pid: int
    process_name: str
    reason: str


@dataclass
class CleanupReport:
    killed: list[CleanupItem]
    skipped: list[CleanupItem]
    failed: list[CleanupItem]


def _cmd_exists(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _resolve_nginx_cmd() -> list[str] | None:
    env_path = (
        os.environ.get("NGINX_PATH")
        or os.environ.get("NGINX_HOME")
        or os.environ.get("NGINX_DIR")
    )
    candidates: list[Path] = []
    if env_path:
        candidate = Path(env_path)
        if candidate.is_dir():
            candidate = candidate / ("nginx.exe" if IS_WINDOWS else "nginx")
        candidates.append(candidate)

    if _cmd_exists("nginx"):
        return ["nginx"]

    candidates.append(ROOT / "nginx" / ("nginx.exe" if IS_WINDOWS else "nginx"))

    if IS_WINDOWS:
        candidates.append(Path(r"E:\nignx\nginx-1.29.5\nginx.exe"))

    for candidate in candidates:
        if candidate.exists():
            return [str(candidate)]

    return None


def _ensure_nginx_dirs(prefix: Path) -> None:
    (prefix / "logs").mkdir(parents=True, exist_ok=True)
    temp_root = prefix / "temp"
    for name in (
        "client_body_temp",
        "proxy_temp",
        "fastcgi_temp",
        "uwsgi_temp",
        "scgi_temp",
    ):
        (temp_root / name).mkdir(parents=True, exist_ok=True)


def _stream_output(proc: subprocess.Popen[str], label: str) -> None:
    if proc.stdout is None:
        return
    prefix = _color(f"[{label}]", _Colors.DIM)
    stdout_encoding = sys.stdout.encoding or "utf-8"
    for line in iter(proc.stdout.readline, ""):
        if not line:
            break
        try:
            print(f"{prefix} {line}", end="")
        except UnicodeEncodeError:
            safe_line = line.encode(stdout_encoding, errors="replace").decode(
                stdout_encoding, errors="replace"
            )
            print(f"{prefix} {safe_line}", end="")


def _is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.3) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            return sock.connect_ex((host, port)) == 0
    except OSError:
        return False


def _print_port_check() -> dict[str, bool]:
    _print_header("端口检查")
    results: dict[str, bool] = {}
    for name, port in PORT_CHECKS:
        in_use = _is_port_open(port)
        results[name] = in_use
        status_text = "占用" if in_use else "可用"
        status_color = _Colors.RED if in_use else _Colors.GREEN
        label = _label(name)
        print(f"  {label:<16} 端口 {port:<5} {_color(status_text, status_color)}")

    occupied = [name for name, in_use in results.items() if in_use]
    if occupied:
        hint = "提示：部分端口已被占用，可能导致服务启动失败。"
        print(_color(hint, _Colors.YELLOW))
    return results


def _extract_port(endpoint: str) -> int | None:
    if endpoint.startswith("[") and "]" in endpoint:
        endpoint = endpoint.rsplit(":", 1)[-1]
    else:
        if ":" not in endpoint:
            return None
        endpoint = endpoint.rsplit(":", 1)[-1]

    if not endpoint.isdigit():
        return None
    return int(endpoint)


def _collect_listening_pids(ports: set[int]) -> dict[int, set[int]]:
    result = {port: set() for port in ports}
    if not ports:
        return result

    try:
        proc = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        output = proc.stdout
    except FileNotFoundError:
        return result

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or not line.upper().startswith("TCP"):
            continue

        parts = line.split()
        if len(parts) < 5:
            continue

        local_addr = parts[1]
        state = parts[3].upper()
        pid_text = parts[-1]
        port = _extract_port(local_addr)

        if port is None or port not in ports:
            continue

        if state != "LISTENING":
            continue

        if not pid_text.isdigit():
            continue

        result[port].add(int(pid_text))

    return result


def _get_process_metadata(pids: set[int]) -> dict[int, tuple[str, str]]:
    metadata: dict[int, tuple[str, str]] = {}
    if not pids:
        return metadata

    if IS_WINDOWS:
        filter_expr = " OR ".join(f"ProcessId={pid}" for pid in sorted(pids))
        ps_command = (
            f"$procs = Get-CimInstance Win32_Process -Filter \"{filter_expr}\" -ErrorAction SilentlyContinue; "
            "if ($procs) { $procs | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress }"
        )
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        output = proc.stdout.strip()
        if not output:
            return metadata

        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            return metadata

        items = parsed if isinstance(parsed, list) else [parsed]
        for item in items:
            try:
                pid = int(item.get("ProcessId"))
            except (TypeError, ValueError):
                continue
            name = str(item.get("Name") or "unknown")
            cmdline = str(item.get("CommandLine") or "")
            metadata[pid] = (name, cmdline)
        return metadata

    ps_proc = subprocess.run(
        ["ps", "-p", ",".join(str(pid) for pid in sorted(pids)), "-o", "pid=,comm=,args="],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    for line in ps_proc.stdout.splitlines():
        parts = line.strip().split(maxsplit=2)
        if len(parts) < 2:
            continue
        pid_text, name = parts[0], parts[1]
        cmdline = parts[2] if len(parts) > 2 else ""
        if pid_text.isdigit():
            metadata[int(pid_text)] = (name, cmdline)
    return metadata


def _is_hdms_process(process_name: str, command_line: str) -> bool:
    proc = process_name.lower()
    cmd = command_line.lower()

    if "nginx" in proc and "hdms.conf" in cmd:
        return True

    if not cmd:
        return False

    return any(marker in cmd for marker in HDMS_CMD_MARKERS)


def _terminate_process_tree(pid: int) -> tuple[bool, str]:
    if IS_WINDOWS:
        proc = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if proc.returncode == 0:
            return True, ""
        message = (proc.stderr or proc.stdout or "taskkill failed").strip()
        return False, message

    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return True, ""
    except Exception as exc:  # pragma: no cover - Unix fallback
        return False, str(exc)

    for _ in range(20):
        time.sleep(0.1)
        try:
            os.kill(pid, 0)
        except OSError:
            return True, ""
    try:
        os.killpg(pid, signal.SIGKILL)
        return True, ""
    except Exception as exc:  # pragma: no cover - Unix fallback
        return False, str(exc)


def _cleanup_ports(mode: str) -> CleanupReport:
    ports = {port for _, port in PORT_CHECKS}
    port_pid_map = _collect_listening_pids(ports)
    all_pids = set().union(*port_pid_map.values()) if port_pid_map else set()
    metadata = _get_process_metadata(all_pids)

    report = CleanupReport(killed=[], skipped=[], failed=[])

    for _, port in PORT_CHECKS:
        for pid in sorted(port_pid_map.get(port, set())):
            process_name, cmdline = metadata.get(pid, ("unknown", ""))

            if pid == os.getpid():
                report.skipped.append(
                    CleanupItem(port=port, pid=pid, process_name=process_name, reason="当前脚本进程")
                )
                continue

            if mode == "safe" and not _is_hdms_process(process_name, cmdline):
                report.skipped.append(
                    CleanupItem(port=port, pid=pid, process_name=process_name, reason="非 HDMS 进程")
                )
                continue

            ok, reason = _terminate_process_tree(pid)
            if ok:
                report.killed.append(
                    CleanupItem(port=port, pid=pid, process_name=process_name, reason="")
                )
            else:
                report.failed.append(
                    CleanupItem(port=port, pid=pid, process_name=process_name, reason=reason or "结束失败")
                )

    return report


def _print_cleanup_report(report: CleanupReport, mode: str) -> None:
    mode_text = "安全模式" if mode == "safe" else "强制模式"
    _print_header(f"端口清理（{mode_text}）")

    if not report.killed and not report.skipped and not report.failed:
        print(_color("无需清理：目标端口均未被占用。", _Colors.GREEN))
        return

    if report.killed:
        print(_color("已结束进程：", _Colors.GREEN))
        for item in report.killed:
            print(f"  - 端口 {item.port:<5} PID {item.pid:<7} 进程 {item.process_name}")

    if report.skipped:
        print(_color("已跳过进程：", _Colors.YELLOW))
        for item in report.skipped:
            print(
                f"  - 端口 {item.port:<5} PID {item.pid:<7} 进程 {item.process_name}（{item.reason}）"
            )

    if report.failed:
        print(_color("结束失败：", _Colors.RED))
        for item in report.failed:
            print(
                f"  - 端口 {item.port:<5} PID {item.pid:<7} 进程 {item.process_name}（{item.reason}）"
            )


def _start_service(service: Service) -> subprocess.Popen[str] | None:
    popen_kwargs: dict[str, object] = {
        "cwd": str(service.cwd),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "bufsize": 1,
        "env": {**os.environ, "PYTHONUNBUFFERED": "1"},
    }

    if IS_WINDOWS:
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_kwargs["start_new_session"] = True

    try:
        proc = subprocess.Popen(service.cmd, **popen_kwargs)
    except FileNotFoundError:
        print(
            f"{_color('[WARN]', _Colors.YELLOW)} 未找到命令（{_label(service.name)}）：{service.cmd[0]}"
        )
        return None

    thread = threading.Thread(
        target=_stream_output, args=(proc, _label(service.name)), daemon=True
    )
    thread.start()

    time.sleep(0.4)
    if proc.poll() is not None:
        print(
            f"{_color('[ERROR]', _Colors.RED)} {_label(service.name)} 启动失败，退出码 {proc.returncode}。"
        )
        return None
    return proc


def _stop_process(proc: subprocess.Popen[str]) -> None:
    if proc.poll() is not None:
        return

    ok, _ = _terminate_process_tree(proc.pid)
    if ok:
        return

    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            return


def _parse_args() -> argparse.Namespace:
    env_default = os.environ.get("HDMS_PORT_CLEANUP", "safe").lower().strip()
    if env_default not in {"off", "safe", "force"}:
        env_default = "safe"

    parser = argparse.ArgumentParser(description="HDMS 一键启动脚本")
    parser.add_argument(
        "--cleanup-mode",
        choices=["off", "safe", "force"],
        default=env_default,
        help=(
            "启动前端口清理模式：off(不清理)、safe(仅清理疑似 HDMS 进程)、"
            "force(强制清理所有占用目标端口的进程)"
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()

    initial_port_status = _print_port_check()

    if args.cleanup_mode != "off":
        cleanup_report = _cleanup_ports(args.cleanup_mode)
        _print_cleanup_report(cleanup_report, args.cleanup_mode)
        if cleanup_report.killed:
            time.sleep(0.5)
            _print_header("端口复查")
            _print_port_check()
    elif any(initial_port_status.values()):
        print(
            _color(
                "提示：可用 --cleanup-mode safe 或 --cleanup-mode force 在启动前自动清理端口。",
                _Colors.YELLOW,
            )
        )

    _print_header("HDMS 一键启动")

    services: list[Service] = []

    services.append(
        Service(
            name="review_system",
            cmd=[
                sys.executable,
                "-m",
                "uvicorn",
                "app:app",
                "--reload",
                "--port",
                "8001",
                "--app-dir",
                str(ROOT / "backend" / "review_system"),
            ],
            cwd=ROOT,
            ready_urls=[
                "http://localhost:8000/health",
                "http://localhost:8000/docs",
            ],
        )
    )

    services.append(
        Service(
            name="qa_assistant",
            cmd=[
                sys.executable,
                "-m",
                "uvicorn",
                "app:app",
                "--reload",
                "--port",
                "8002",
                "--app-dir",
                str(ROOT / "backend" / "qa_assistant"),
            ],
            cwd=ROOT,
            ready_urls=[
                "http://localhost:8000/qa/health",
                "http://localhost:8000/qa/chat",
            ],
        )
    )

    approval_app = ROOT / "backend" / "approval_checklist" / "app.py"
    if approval_app.exists():
        services.append(
            Service(
                name="approval_checklist",
                cmd=[
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app:app",
                    "--reload",
                    "--port",
                    "8003",
                    "--app-dir",
                    str(ROOT / "backend" / "approval_checklist"),
                ],
                cwd=ROOT,
                ready_urls=["http://localhost:8000/approval/health"],
            )
        )
    else:
        print(_color("[WARN]", _Colors.YELLOW) + " 未找到 approval_checklist/app.py，已跳过。")

    services.append(
        Service(
            name="data_process",
            cmd=[
                sys.executable,
                "-m",
                "uvicorn",
                "data_process.main:app",
                "--reload",
                "--port",
                "8004",
                "--app-dir",
                str(ROOT),
            ],
            cwd=ROOT,
            ready_urls=[
                "http://localhost:8000/ingestion/status",
                "http://localhost:8000/graph/statistics",
            ],
        )
    )

    services.append(
        Service(
            name="data_process_gradio",
            cmd=[
                sys.executable,
                str(ROOT / "data_process" / "gradio_app" / "app.py"),
            ],
            cwd=ROOT,
            ready_urls=["http://localhost:7860"],
        )
    )

    nginx_cmd = _resolve_nginx_cmd()
    if nginx_cmd:
        _ensure_nginx_dirs(ROOT)
        services.append(
            Service(
                name="nginx",
                # Keep nginx attached to this process tree so Ctrl+C can terminate it cleanly.
                cmd=[*nginx_cmd, "-c", str(ROOT / "nginx" / "hdms.conf"), "-g", "daemon off;"],
                cwd=ROOT,
                ready_urls=["http://localhost:8000"],
            )
        )
    else:
        print(
            _color("[WARN]", _Colors.YELLOW)
            + " 未检测到 nginx，请设置 NGINX_PATH/NGINX_HOME/NGINX_DIR 或将 nginx.exe 放到 PATH。"
        )

    if _cmd_exists("npm"):
        if IS_WINDOWS:
            cmd = ["cmd", "/c", "npm", "run", "dev"]
        else:
            cmd = ["npm", "run", "dev"]
        services.append(
            Service(
                name="frontend",
                cmd=cmd,
                cwd=ROOT / "frontend",
                ready_urls=["http://localhost:3000"],
            )
        )
    else:
        print(_color("[WARN]", _Colors.YELLOW) + " 未检测到 npm（PATH 中不存在），前端已跳过。")

    running: dict[str, subprocess.Popen[str]] = {}
    skipped: list[str] = []

    for service in services:
        _print_header(f"正在启动：{_label(service.name)}")
        proc = _start_service(service)
        if proc is not None:
            running[service.name] = proc
        else:
            skipped.append(service.name)

    _print_header("启动结果")
    if skipped:
        print("已跳过：")
        for name in skipped:
            print(f"  - {_label(name)}")

    _print_header("快速入口")
    frontend_ready = _is_port_open(3000)
    gradio_ready = _is_port_open(7860)
    frontend_status = _color("已启动", _Colors.GREEN) if frontend_ready else _color("未启动", _Colors.YELLOW)
    gradio_status = _color("已启动", _Colors.GREEN) if gradio_ready else _color("未启动", _Colors.YELLOW)
    print(f"{_color('HDMS 前端', _Colors.CYAN)}: http://localhost:3000 {frontend_status}")
    print(f"{_color('数据处理 Gradio', _Colors.CYAN)}: http://localhost:7860 {gradio_status}")

    print("\n按 Ctrl+C 可停止全部服务。")

    try:
        while True:
            time.sleep(1)
            for name, proc in list(running.items()):
                if proc.poll() is not None:
                    print(
                        f"{_color('[WARN]', _Colors.YELLOW)} {_label(name)} 已退出，退出码 {proc.returncode}。"
                    )
                    del running[name]
            if not running:
                print(_color("所有服务已退出。", _Colors.MAGENTA))
                break
    except KeyboardInterrupt:
        print(_color("\n正在停止服务...", _Colors.MAGENTA))
        for proc in running.values():
            _stop_process(proc)
        print(_color("已停止。", _Colors.MAGENTA))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


