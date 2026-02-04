from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Tuple


class MineruClient:
    """Minimal MinerU CLI wrapper for PDF -> Markdown."""

    def __init__(
        self,
        project_root: Optional[str] = None,
        mineru_exe: Optional[str] = None,
        python_exe: Optional[str] = None,
        backend: Optional[str] = None,
        use_cuda: Optional[bool] = None,
    ) -> None:
        self.project_root = Path(project_root or os.getenv("MINERU_PROJECT_ROOT", ".")).resolve()
        self.mineru_exe = mineru_exe or os.getenv("MINERU_EXE", "mineru")
        self.python_exe = python_exe or os.getenv("MINERU_PYTHON_EXE", "python")
        self.backend = backend or os.getenv("MINERU_BACKEND", "pipeline")
        env_cuda = os.getenv("MINERU_USE_CUDA", "0").lower()
        self.use_cuda = bool(use_cuda) if use_cuda is not None else (env_cuda in {"1", "true", "yes"})

    def parse_pdf(
        self,
        pdf_path: str,
        output_dir: str,
        page_range: Optional[Tuple[int, int]] = None,
    ) -> dict:
        pdf = Path(pdf_path).resolve()
        if not pdf.exists():
            raise FileNotFoundError(f"PDF not found: {pdf}")

        output_root = Path(output_dir).resolve()
        output_root.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory(prefix="mineru_in_") as in_dir:
            in_dir_path = Path(in_dir)
            target_pdf = in_dir_path / pdf.name
            shutil.copy2(str(pdf), str(target_pdf))

            cmd = self._build_command(input_dir=in_dir_path, output_dir=output_root, page_range=page_range)
            proc = subprocess.run(
                cmd,
                cwd=str(self.project_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            if proc.returncode != 0:
                stderr = (proc.stderr or proc.stdout or "").strip()
                raise RuntimeError(f"MinerU failed ({proc.returncode}): {stderr}")

        md_path = self._find_first_markdown(output_root)
        md_text = md_path.read_text(encoding="utf-8", errors="ignore") if md_path else ""

        return {
            "markdown": md_text,
            "markdown_path": str(md_path) if md_path else "",
            "output_dir": str(output_root),
        }

    def _build_command(
        self,
        input_dir: Path,
        output_dir: Path,
        page_range: Optional[Tuple[int, int]] = None,
    ) -> list[str]:
        cmd_prefix = self._resolve_command()
        cmd = [*cmd_prefix, "-p", str(input_dir), "-o", str(output_dir)]
        if self.backend:
            cmd.extend(["--backend", self.backend])
        if self.use_cuda:
            cmd.extend(["--device", "cuda"])
        extra_args = os.getenv("MINERU_EXTRA_ARGS", "").strip()
        if extra_args:
            cmd.extend(extra_args.split())
        if page_range:
            # MinerU CLI does not guarantee page-range support; keep metadata for future.
            os.environ["MINERU_PAGE_RANGE"] = f"{page_range[0]}-{page_range[1]}"
        return cmd

    def _resolve_command(self) -> list[str]:
        if self.mineru_exe and shutil.which(self.mineru_exe):
            return [self.mineru_exe]
        python_path = shutil.which(self.python_exe) if self.python_exe else None
        if python_path:
            return [python_path, "-m", "mineru"]
        raise FileNotFoundError("MinerU executable not found. Set MINERU_EXE or MINERU_PYTHON_EXE.")

    @staticmethod
    def _find_first_markdown(output_dir: Path) -> Optional[Path]:
        md_files = list(output_dir.rglob("*.md"))
        if not md_files:
            return None
        return sorted(md_files, key=lambda p: p.name.lower())[0]
