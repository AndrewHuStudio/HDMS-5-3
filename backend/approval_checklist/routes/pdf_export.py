"""
审批清单 PDF 导出路由
接收前端渲染后的清单图片，服务端生成 PDF 二进制并返回下载。
"""
from __future__ import annotations

import base64
import io
import re
from typing import Final
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

router = APIRouter()

DATA_URL_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"^data:image/(?P<format>[a-zA-Z0-9.+-]+);base64,(?P<data>.+)$"
)
DEFAULT_FILE_NAME = "审核清单.pdf"
ASCII_FALLBACK_FILE_NAME = "approval-checklist.pdf"


class ExportPdfRequest(BaseModel):
    project_name: str | None = Field(default=None, max_length=100)
    image_data_url: str = Field(min_length=20)
    file_name: str | None = Field(default=None, max_length=120)


def _parse_image_data_url(image_data_url: str) -> bytes:
    match = DATA_URL_PATTERN.match(image_data_url.strip())
    if not match:
        raise HTTPException(status_code=400, detail="image_data_url 格式无效，需为 data:image/...;base64,...")
    try:
        return base64.b64decode(match.group("data"), validate=True)
    except Exception as exc:  # pragma: no cover - defensive branch
        raise HTTPException(status_code=400, detail="image_data_url Base64 解码失败") from exc


def _normalize_image(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA"):
        background = Image.new("RGB", image.size, (255, 255, 255))
        alpha = image.getchannel("A") if "A" in image.getbands() else None
        background.paste(image.convert("RGB"), mask=alpha)
        return background
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def _build_pdf_bytes(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source_image:
        normalized = _normalize_image(source_image)
        page_width, page_height = A4

        # 统一按页面宽度缩放；若内容很长则切片为多页，保证可读性。
        px_per_point = normalized.width / page_width if page_width > 0 else 1
        max_slice_height = max(1, int(page_height * px_per_point))

        output = io.BytesIO()
        pdf = canvas.Canvas(output, pagesize=A4)

        offset = 0
        while offset < normalized.height:
            slice_height = min(max_slice_height, normalized.height - offset)
            image_slice = normalized.crop((0, offset, normalized.width, offset + slice_height))

            slice_buffer = io.BytesIO()
            image_slice.save(slice_buffer, format="PNG")
            slice_buffer.seek(0)

            draw_height = slice_height / px_per_point
            draw_y = (page_height - draw_height) / 2 if draw_height < page_height else 0
            pdf.drawImage(
                ImageReader(slice_buffer),
                x=0,
                y=draw_y,
                width=page_width,
                height=draw_height,
                preserveAspectRatio=False,
                mask="auto",
            )

            offset += slice_height
            if offset < normalized.height:
                pdf.showPage()

        pdf.save()
        output.seek(0)
        return output.getvalue()


def _resolve_file_name(request: ExportPdfRequest) -> str:
    if request.file_name:
        return request.file_name if request.file_name.endswith(".pdf") else f"{request.file_name}.pdf"
    if request.project_name:
        return f"{request.project_name}_审核清单.pdf"
    return DEFAULT_FILE_NAME


@router.post("/export-pdf")
async def export_pdf(request: ExportPdfRequest) -> Response:
    image_bytes = _parse_image_data_url(request.image_data_url)
    try:
        pdf_bytes = _build_pdf_bytes(image_bytes)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"PDF 生成失败: {exc}") from exc

    file_name = _resolve_file_name(request)
    content_disposition = (
        f"attachment; filename={ASCII_FALLBACK_FILE_NAME}; "
        f"filename*=UTF-8''{quote(file_name)}"
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": content_disposition},
    )
