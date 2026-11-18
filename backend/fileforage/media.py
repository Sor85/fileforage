"""ffmpeg / Pillow 媒体工具：探测、解码音频、抽帧、缩略图。"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

try:
    import pillow_heif

    pillow_heif.register_heif_opener()
except Exception:  # pragma: no cover - 可选依赖
    pass

Image.MAX_IMAGE_PIXELS = 200_000_000
SAMPLE_RATE = 16_000
THUMB_SIZE = 640


class MediaError(RuntimeError):
    pass


@dataclass
class Probe:
    duration: float
    width: int
    height: int
    has_video: bool
    has_audio: bool
    rotation: int = 0


def _run(args: list[str], timeout: float = 600) -> bytes:
    try:
        proc = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as e:
        raise MediaError(f"{args[0]} 超时") from e
    if proc.returncode != 0:
        msg = proc.stderr.decode(errors="ignore").strip().splitlines()
        raise MediaError(msg[-1] if msg else f"{args[0]} 失败")
    return proc.stdout


def probe(path: Path) -> Probe:
    out = _run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        timeout=60,
    )
    info = json.loads(out or b"{}")
    streams = info.get("streams", [])
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = float(info.get("format", {}).get("duration") or 0)
    if not duration:
        for s in streams:
            duration = max(duration, float(s.get("duration") or 0))
    rotation = 0
    width = height = 0
    if video:
        width, height = int(video.get("width") or 0), int(video.get("height") or 0)
        for sd in video.get("side_data_list", []) or []:
            if "rotation" in sd:
                rotation = int(float(sd["rotation"]))
        rotation = int(video.get("tags", {}).get("rotate", rotation) or 0)
        if abs(rotation) % 180 == 90:
            width, height = height, width
    return Probe(duration, width, height, video is not None, audio is not None, rotation)


def decode_audio(path: Path, start: float | None = None, duration: float | None = None) -> np.ndarray:
    """解码为 16kHz 单声道 float32 PCM。"""
    args = ["ffmpeg", "-v", "error", "-nostdin"]
    if start:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(path)]
    if duration:
        args += ["-t", f"{duration:.3f}"]
    args += ["-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    return np.frombuffer(_run(args), dtype=np.float32).copy()


def decode_frames(path: Path, start: float, duration: float, fps: float, width: int = 448) -> np.ndarray:
    """从 start 起截取 duration 秒，按 fps 抽帧并缩放到指定宽度，返回 (N, H, W, 3) uint8。"""
    p = probe_cache(path)
    if not p.width or not p.height:
        raise MediaError("无法读取视频尺寸")
    w = min(width, p.width)
    w -= w % 2
    h = max(2, round(p.height * w / p.width / 2) * 2)
    args = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(path),
        "-an", "-vf", f"fps={fps:.6f},scale={w}:{h}:flags=bilinear",
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ]  # fmt: skip
    raw = _run(args)
    n = len(raw) // (w * h * 3)
    if n == 0:
        return np.zeros((0, h, w, 3), dtype=np.uint8)
    return np.frombuffer(raw[: n * w * h * 3], dtype=np.uint8).reshape(n, h, w, 3)


_probe_cache: dict[str, Probe] = {}


def probe_cache(path: Path) -> Probe:
    key = str(path)
    if key not in _probe_cache:
        if len(_probe_cache) > 64:
            _probe_cache.clear()
        _probe_cache[key] = probe(path)
    return _probe_cache[key]


def load_image(path: Path) -> Image.Image:
    img = Image.open(path)
    try:
        img.seek(0)
    except EOFError:
        pass
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.getchannel("A"))
        return bg
    return img.convert("RGB")


def save_thumb(img: Image.Image, out: Path, size: int = THUMB_SIZE) -> tuple[int, int]:
    thumb = img.copy()
    thumb.thumbnail((size, size), Image.Resampling.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    thumb.save(out, "WEBP", quality=82, method=4)
    return thumb.size


def frame_to_image(frame: np.ndarray) -> Image.Image:
    return Image.fromarray(frame)


def video_poster(path: Path, at: float) -> Image.Image:
    p = probe_cache(path)
    raw = _run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-ss",
            f"{max(0.0, at):.3f}",
            "-i",
            str(path),
            "-frames:v",
            "1",
            "-vf",
            f"scale={min(THUMB_SIZE * 2, p.width or 1280)}:-2",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ],
        timeout=60,
    )
    from io import BytesIO

    return Image.open(BytesIO(raw)).convert("RGB")
