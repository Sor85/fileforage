"""faster-whisper 语音转写（可选）。模型按需加载，转写结果合并为带时间戳的文本段。"""

from __future__ import annotations

import logging
import threading
from typing import Any

import numpy as np

log = logging.getLogger(__name__)


class Transcriber:
    def __init__(self, device: str):
        self._device = "cuda" if device.startswith("cuda") else "cpu"
        self._model: Any = None
        self._name: str | None = None
        self._lock = threading.Lock()
        self.error: str | None = None

    def _ensure(self, name: str) -> Any:
        if self._model is not None and self._name == name:
            return self._model
        from faster_whisper import WhisperModel

        compute = "float16" if self._device == "cuda" else "int8"
        log.info("加载 Whisper 模型 %s（%s/%s）", name, self._device, compute)
        self._model = WhisperModel(name, device=self._device, compute_type=compute)
        self._name = name
        return self._model

    def transcribe(self, audio: np.ndarray, model_name: str, max_chars: int = 360) -> list[dict[str, Any]]:
        """返回 [{text, start, end}]，相邻语句合并到约 max_chars 字。无语音时返回空列表。"""
        if len(audio) < 16_000:
            return []
        with self._lock:
            try:
                model = self._ensure(model_name)
            except Exception as e:  # pragma: no cover - 依赖网络 / 环境
                self.error = f"{type(e).__name__}: {e}"
                log.warning("Whisper 不可用：%s", self.error)
                return []
            segments, info = model.transcribe(
                audio, vad_filter=True, beam_size=1, condition_on_previous_text=False
            )
            # 语种置信度过低通常意味着没有人声（音效、纯音乐），Whisper 会在这类音频上产生幻觉文本
            if info.language_probability < 0.5:
                return []
            parts = [
                (s.start, s.end, s.text.strip())
                for s in segments
                if s.text.strip()
                and s.avg_logprob > -1.0
                and s.compression_ratio < 2.4
                and not (s.no_speech_prob > 0.5 and s.avg_logprob < -0.7)
            ]
        merged: list[dict[str, Any]] = []
        for start, end, text in parts:
            if merged and len(merged[-1]["text"]) + len(text) <= max_chars:
                sep = "" if _is_cjk(merged[-1]["text"][-1:]) and _is_cjk(text[:1]) else " "
                merged[-1]["text"] += sep + text
                merged[-1]["end"] = end
            else:
                merged.append({"text": text, "start": float(start), "end": float(end)})
        return merged


def _is_cjk(ch: str) -> bool:
    return bool(ch) and ("　" <= ch <= "鿿" or "＀" <= ch <= "￯")
