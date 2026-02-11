"""
Vision service for generating image descriptions using vision models.
"""

import json
import base64
import mimetypes
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional
import logging
import os

logger = logging.getLogger(__name__)


class VisionService:
    """Service for describing images using vision language models."""

    def __init__(self, base_url: str, api_key: str, model: str):
        """
        Initialize vision service.

        Args:
            base_url: API base URL
            api_key: API key for authentication
            model: Vision model name
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def describe_image(
        self,
        image_path: str,
        context: str = "",
        max_tokens: int = 500
    ) -> str:
        """
        Generate description for an image using vision model.

        Args:
            image_path: Path to image file
            context: Optional context text around the image
            max_tokens: Maximum tokens in response

        Returns:
            Image description text
        """
        # Read and encode image
        try:
            with open(image_path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            logger.error(f"Failed to read image {image_path}: {e}")
            raise
        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type or not mime_type.startswith("image/"):
            mime_type = "image/jpeg"

        # Build prompt
        prompt = "请描述这张图片的内容，重点关注城市规划、建筑设计、地块管控相关的信息。"
        if context:
            prompt += f"\n\n上下文：{context}"

        endpoint = f"{self.base_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime_type};base64,{image_data}"}
                        }
                    ]
                }
            ],
            "max_tokens": max_tokens
        }

        data = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                body = response.read().decode("utf-8")
                result = json.loads(body)

            description = result["choices"][0]["message"]["content"]
            logger.info(f"Generated description for {Path(image_path).name}")
            return description

        except Exception as e:
            logger.error(f"Failed to generate image description: {e}")
            raise

    def describe_images_batch(
        self,
        image_paths: list[str],
        contexts: Optional[list[str]] = None
    ) -> Dict[str, str]:
        """
        Generate descriptions for multiple images.

        Args:
            image_paths: List of image file paths
            contexts: Optional list of context texts (same length as image_paths)

        Returns:
            Dictionary mapping image paths to descriptions
        """
        if contexts is None:
            contexts = [""] * len(image_paths)

        if len(contexts) != len(image_paths):
            raise ValueError("contexts must have same length as image_paths")

        descriptions = {}
        for img_path, context in zip(image_paths, contexts):
            try:
                desc = self.describe_image(img_path, context)
                descriptions[img_path] = desc
            except Exception as e:
                logger.error(f"Failed to describe {img_path}: {e}")
                descriptions[img_path] = f"[Error: {str(e)}]"

        return descriptions


def create_vision_service() -> VisionService:
    """
    Create vision service from environment variables.

    Returns:
        Configured VisionService instance
    """
    base_url = os.getenv("HDMS_BASE_URL", "https://api.apiyi.com")
    api_key = os.getenv("HDMS_API_KEY", "")
    model = os.getenv("HDMS_VISION_MODEL", "qwen3-vl-plus")

    if not api_key:
        raise ValueError("HDMS_API_KEY environment variable is required")

    return VisionService(base_url, api_key, model)
