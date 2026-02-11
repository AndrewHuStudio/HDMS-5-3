from __future__ import annotations

import os

_LOOPBACK_ENTRIES = ("127.0.0.1", "localhost", "::1")


def ensure_loopback_no_proxy() -> None:
    """Ensure loopback requests bypass outbound proxies.

    Gradio performs a local startup HTTP call during launch. When global
    HTTP(S)_PROXY is configured and NO_PROXY misses loopback hosts, startup can
    fail even though the server is already running.
    """

    raw = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    entries = [item.strip() for item in raw.split(",") if item.strip()]
    existing = {item.lower() for item in entries}

    for value in _LOOPBACK_ENTRIES:
        if value.lower() not in existing:
            entries.append(value)

    merged = ",".join(entries)
    os.environ["NO_PROXY"] = merged
    os.environ["no_proxy"] = merged
