"""EmbeddingGemma 2 封装：后台加载、统一编码文本 / 图片 / 音频 / 视频，输出 L2 归一化的 768 维向量。

推理串行执行；检索查询优先于索引任务（索引在每批之间让出锁）。
"""

from __future__ import annotations

import logging
import threading
import time
import warnings
from collections import OrderedDict
from collections.abc import Sequence
from typing import Any

import numpy as np
from PIL import Image

from .media import SAMPLE_RATE

log = logging.getLogger(__name__)

QUERY_PREFIX = "task: search result | query: "


def document_text(title: str, text: str) -> str:
    title = " ".join(title.split()) or "none"
    return f"title: {title} | text: {text}"


class _PriorityLock:
    """查询优先的互斥锁：有查询在等待时，索引线程不会抢到锁。"""

    def __init__(self) -> None:
        self._cond = threading.Condition()
        self._busy = False
        self._waiting_high = 0

    def acquire(self, high: bool) -> None:
        with self._cond:
            if high:
                self._waiting_high += 1
                while self._busy:
                    self._cond.wait()
                self._waiting_high -= 1
            else:
                while self._busy or self._waiting_high:
                    self._cond.wait()
            self._busy = True

    def release(self) -> None:
        with self._cond:
            self._busy = False
            self._cond.notify_all()


class Embedder:
    def __init__(self, model_name: str, device: str, modalities: frozenset[str]):
        self.model_name = model_name
        self.requested_device = device
        self.modalities = modalities
        self.device = "cpu"
        self.dtype = "float32"
        self.dim = 768
        self.status = "idle"  # idle | loading | ready | error
        self.error: str | None = None
        self.load_seconds: float | None = None
        self._model: Any = None
        self._lock = _PriorityLock()
        self._ready = threading.Event()
        self._query_cache: OrderedDict[str, np.ndarray] = OrderedDict()
        self._image_tokens = 280

    # ---- 加载 -----------------------------------------------------------

    def start_loading(self) -> None:
        if self.status in ("loading", "ready"):
            return
        self.status = "loading"
        threading.Thread(target=self._load, name="model-loader", daemon=True).start()

    def _pick_device(self) -> tuple[str, Any]:
        import torch

        dev = self.requested_device
        if dev == "auto":
            if torch.cuda.is_available():
                dev = "cuda"
            elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                dev = "mps"
            else:
                dev = "cpu"
        # float16 会让 EmbeddingGemma 2 输出 NaN，只用 bfloat16 / float32
        dtype = torch.float32
        if dev.startswith("cuda") and torch.cuda.is_bf16_supported():
            dtype = torch.bfloat16
        return dev, dtype

    def _load(self) -> None:
        t0 = time.time()
        try:
            from sentence_transformers import SentenceTransformer

            dev, dtype = self._pick_device()
            config_kwargs: dict[str, Any] = {}
            if not self.modalities & {"image", "video"}:
                config_kwargs["vision_config"] = None
            if "audio" not in self.modalities and "video" not in self.modalities:
                config_kwargs["audio_config"] = None
            log.info("加载模型 %s（device=%s, dtype=%s）", self.model_name, dev, dtype)
            model = SentenceTransformer(
                self.model_name,
                device=dev,
                model_kwargs={"dtype": dtype},
                config_kwargs=config_kwargs or None,
            )
            self._model = model
            self.device = dev
            self.dtype = str(dtype).replace("torch.", "")
            self.dim = int(model.get_embedding_dimension() or 768)
            self.status = "ready"
            self.load_seconds = round(time.time() - t0, 1)
            self._ready.set()
            log.info("模型就绪，用时 %.1fs", self.load_seconds)
        except Exception as e:  # pragma: no cover - 依赖环境
            log.exception("模型加载失败")
            self.status = "error"
            self.error = f"{type(e).__name__}: {e}"
            self._ready.set()

    def wait_ready(self, timeout: float | None = None) -> bool:
        self._ready.wait(timeout)
        return self.status == "ready"

    def set_image_tokens(self, tokens: int) -> None:
        self._image_tokens = int(tokens)

    def _apply_image_tokens(self) -> None:
        proc = getattr(self._model[0], "processor", None)
        ip = getattr(proc, "image_processor", None)
        if ip is not None and getattr(ip, "max_soft_tokens", None) != self._image_tokens:
            ip.max_soft_tokens = self._image_tokens
            if hasattr(proc, "image_seq_length"):
                proc.image_seq_length = self._image_tokens

    # ---- 编码 -----------------------------------------------------------

    def _encode(self, inputs: Sequence[Any], high: bool, batch_size: int, **kw: Any) -> np.ndarray:
        if not self.wait_ready():
            raise RuntimeError(self.error or "模型未就绪")
        self._lock.acquire(high)
        try:
            self._apply_image_tokens()
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                out = self._model.encode(
                    list(inputs),
                    batch_size=batch_size,
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                    **kw,
                )
        finally:
            self._lock.release()
        out = np.asarray(out, dtype=np.float32)
        if not np.isfinite(out).all():
            raise RuntimeError("模型输出包含 NaN")
        return out

    def query(self, text: str) -> np.ndarray:
        key = text.strip()
        if key in self._query_cache:
            self._query_cache.move_to_end(key)
            return self._query_cache[key]
        vec = self._encode([QUERY_PREFIX + key], high=True, batch_size=1)[0]
        self._query_cache[key] = vec
        if len(self._query_cache) > 256:
            self._query_cache.popitem(last=False)
        return vec

    def query_image(self, img: Image.Image) -> np.ndarray:
        return self._encode([{"image": img}], high=True, batch_size=1)[0]

    def documents(self, texts: Sequence[str]) -> np.ndarray:
        return self._encode(texts, high=False, batch_size=8)

    def images(self, imgs: Sequence[Image.Image]) -> np.ndarray:
        return self._encode([{"image": im} for im in imgs], high=False, batch_size=4)

    def audios(self, clips: Sequence[np.ndarray]) -> np.ndarray:
        return self._encode(
            [{"audio": {"array": c, "sampling_rate": SAMPLE_RATE}} for c in clips], high=False, batch_size=2
        )

    def videos(self, segments: Sequence[tuple[np.ndarray, np.ndarray | None]]) -> np.ndarray:
        """每段 = (帧数组 (N,H,W,3), 同时段音频或 None)，音画交错编码为一个向量。"""
        inputs: list[dict[str, Any]] = []
        for frames, audio in segments:
            if audio is not None and len(audio) >= SAMPLE_RATE // 2:
                inputs.append(
                    {
                        "text": "<|video|><|audio|>",
                        "video": frames,
                        "audio": {"array": audio, "sampling_rate": SAMPLE_RATE},
                    }
                )
            else:
                inputs.append({"video": frames})
        return self._encode(inputs, high=False, batch_size=1)

    def info(self) -> dict[str, Any]:
        return {
            "name": self.model_name,
            "status": self.status,
            "error": self.error,
            "device": self.device,
            "dtype": self.dtype,
            "dim": self.dim,
            "modalities": sorted(self.modalities),
            "load_seconds": self.load_seconds,
        }
