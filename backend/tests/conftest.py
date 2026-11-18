from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pytest

DIM = 768


def fake_vec(key: str) -> np.ndarray:
    """按内容哈希生成确定性的单位向量；含相同关键词的输入落在相近方向。"""
    v = np.zeros(DIM, dtype=np.float32)
    for word in ("猫", "山", "会议", "fibonacci"):
        if word in key:
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 3.0
    rng = np.random.default_rng(int(hashlib.md5(key.encode()).hexdigest()[:8], 16))
    v += rng.normal(0, 0.05, DIM).astype(np.float32)
    return v / np.linalg.norm(v)


class FakeEmbedder:
    status = "ready"
    error = None
    dim = DIM
    device = "cpu"

    def __init__(self, *a, **k):
        pass

    def start_loading(self):
        pass

    def wait_ready(self, timeout=None):
        return True

    def set_image_tokens(self, n):
        pass

    def query(self, text):
        return fake_vec(text)

    def query_image(self, img):
        return fake_vec("image")

    def documents(self, texts):
        return np.stack([fake_vec(t) for t in texts])

    def images(self, imgs):
        return np.stack([fake_vec("image") for _ in imgs])

    def audios(self, clips):
        return np.stack([fake_vec("audio") for _ in clips])

    def videos(self, segs):
        return np.stack([fake_vec("video") for _ in segs])

    def info(self):
        return {
            "name": "fake",
            "status": "ready",
            "error": None,
            "device": "cpu",
            "dtype": "float32",
            "dim": DIM,
            "modalities": [],
            "load_seconds": 0,
        }


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "lib"
    (root / "notes").mkdir(parents=True)
    (root / "notes" / "cat.md").write_text("# 关于猫\n\n家里的猫喜欢晒太阳。", encoding="utf-8")
    (root / "notes" / "fib.py").write_text("def fibonacci(n):\n    return n\n", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "x.js").write_text("ignored", encoding="utf-8")
    (root / ".hidden.md").write_text("hidden", encoding="utf-8")
    (root / "empty.txt").write_text("", encoding="utf-8")
    return root


@pytest.fixture
def client(tmp_path: Path, library: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("FF_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("FF_ROOTS", str(tmp_path))
    monkeypatch.setenv("FF_WEB_DIR", str(tmp_path / "noweb"))
    from fileforage import app_state

    monkeypatch.setattr(app_state, "Embedder", FakeEmbedder)
    from fastapi.testclient import TestClient

    from fileforage.main import app

    with TestClient(app) as c:
        yield c
