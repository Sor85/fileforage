"""可在 WebUI 中修改的运行时设置，持久化在 SQLite 的 settings 表。"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from .extractors import EXCLUDE_PRESETS

DEFAULT_EXCLUDES = [
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    "__pycache__",
    ".venv",
    "venv",
    ".cache",
    ".idea",
    ".vscode",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    "@eaDir",
    "#recycle",
    "$RECYCLE.BIN",
    "System Volume Information",
    ".Trash*",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.lock",
    "package-lock.json",
    "pnpm-lock.yaml",
]


class Settings(BaseModel):
    transcribe: bool = Field(True, description="使用 Whisper 转写音视频中的语音，转写文本参与检索")
    whisper_model: str = Field(
        "small", description="faster-whisper 模型：tiny / base / small / medium / large-v3"
    )
    image_tokens: int = Field(280, description="图片视觉 token 预算：70 / 140 / 280 / 560 / 1120")
    video_segment_seconds: int = Field(20, ge=4, le=120, description="视频分段长度（秒）")
    video_max_frames: int = Field(600, ge=16, le=5000, description="单个视频最多抽取的帧数")
    audio_segment_seconds: int = Field(30, ge=5, le=300, description="音频分段长度（秒）")
    max_text_mb: float = Field(20, gt=0, description="文本、文档类文件的大小上限（MB）")
    min_image_px: int = Field(96, ge=0, description="宽高都小于该值的图片视为图标并跳过")
    include_hidden: bool = Field(False, description="是否索引以 . 开头的隐藏文件与目录")
    excludes: list[str] = Field(default_factory=lambda: list(DEFAULT_EXCLUDES))
    exclude_presets: list[str] = Field(default_factory=list, description="按扩展名整组排除的常用预设")
    watch: bool = Field(True, description="监听目录变化并自动增量索引")
    min_score: float = Field(0.58, ge=0, le=1, description="低于该相似度的结果不显示")

    @field_validator("exclude_presets")
    @classmethod
    def _known_presets(cls, v: list[str]) -> list[str]:
        unknown = [k for k in v if k not in EXCLUDE_PRESETS]
        if unknown:
            raise ValueError(f"未知的排除预设：{', '.join(unknown)}")
        return [k for k in EXCLUDE_PRESETS if k in v]


def load_settings(stored: dict[str, Any]) -> Settings:
    known = {k: v for k, v in stored.items() if k in Settings.model_fields}
    return Settings(**known)
