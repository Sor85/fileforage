"""内存向量索引：所有分块向量常驻内存，矩阵乘法暴力检索（个人文件规模下毫秒级）。"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np

KIND_CODES = {"text": 0, "document": 1, "image": 2, "video": 3, "audio": 4}

# 文本查询与图像 / 视频分块的相似度整体低于文本之间的相似度，按分块类型补偿，使各模态排序公平；
# 文件名分块略降权，避免无意义的文件名抢占结果
CHUNK_BIAS = {"image": 0.025, "page": 0.02, "video": 0.02, "name": -0.03}


def chunk_bias(kinds: list[str]) -> np.ndarray:
    return np.array([CHUNK_BIAS.get(k, 0.0) for k in kinds], dtype=np.float32)


@dataclass
class Hits:
    chunk_ids: np.ndarray
    file_ids: np.ndarray
    scores: np.ndarray


class VectorIndex:
    def __init__(self, dim: int = 768):
        self.dim = dim
        self._lock = threading.RLock()
        self._vecs = np.zeros((0, dim), dtype=np.float32)
        self._chunk_ids = np.zeros(0, dtype=np.int64)
        self._file_ids = np.zeros(0, dtype=np.int64)
        self._kinds = np.zeros(0, dtype=np.int8)
        self._colls = np.zeros(0, dtype=np.int64)
        self._bias = np.zeros(0, dtype=np.float32)
        self._pending: list[tuple[np.ndarray, ...]] = []

    def __len__(self) -> int:
        with self._lock:
            return len(self._chunk_ids) + sum(len(p[0]) for p in self._pending)

    def add(
        self,
        chunk_ids: np.ndarray,
        file_ids: np.ndarray,
        vecs: np.ndarray,
        kinds: np.ndarray,
        colls: np.ndarray,
        bias: np.ndarray,
    ) -> None:
        if len(chunk_ids) == 0:
            return
        with self._lock:
            self._pending.append(
                (
                    np.asarray(chunk_ids, dtype=np.int64),
                    np.asarray(file_ids, dtype=np.int64),
                    np.asarray(vecs, dtype=np.float32).reshape(-1, self.dim),
                    np.asarray(kinds, dtype=np.int8),
                    np.asarray(colls, dtype=np.int64),
                    np.asarray(bias, dtype=np.float32),
                )
            )

    def remove_files(self, file_ids: list[int] | set[int]) -> None:
        if not file_ids:
            return
        with self._lock:
            self._flush()
            keep = ~np.isin(self._file_ids, np.fromiter(file_ids, dtype=np.int64))
            if keep.all():
                return
            self._vecs = self._vecs[keep]
            self._chunk_ids = self._chunk_ids[keep]
            self._file_ids = self._file_ids[keep]
            self._kinds = self._kinds[keep]
            self._colls = self._colls[keep]
            self._bias = self._bias[keep]

    def _flush(self) -> None:
        if not self._pending:
            return
        parts = list(zip(*self._pending, strict=True))
        self._chunk_ids = np.concatenate([self._chunk_ids, *parts[0]])
        self._file_ids = np.concatenate([self._file_ids, *parts[1]])
        self._vecs = np.concatenate([self._vecs, *parts[2]])
        self._kinds = np.concatenate([self._kinds, *parts[3]])
        self._colls = np.concatenate([self._colls, *parts[4]])
        self._bias = np.concatenate([self._bias, *parts[5]])
        self._pending.clear()

    def search(
        self,
        query: np.ndarray,
        top: int = 2000,
        kinds: list[str] | None = None,
        collections: list[int] | None = None,
        exclude_file: int | None = None,
        use_bias: bool = True,
    ) -> Hits:
        with self._lock:
            self._flush()
            vecs, cids, fids, bias = self._vecs, self._chunk_ids, self._file_ids, self._bias
            mask = None
            if kinds:
                mask = np.isin(self._kinds, [KIND_CODES[k] for k in kinds if k in KIND_CODES])
            if collections:
                m = np.isin(self._colls, collections)
                mask = m if mask is None else mask & m
            if exclude_file is not None:
                m = fids != exclude_file
                mask = m if mask is None else mask & m
        if mask is not None:
            vecs, cids, fids, bias = vecs[mask], cids[mask], fids[mask], bias[mask]
        if len(cids) == 0:
            empty = np.zeros(0)
            return Hits(empty.astype(np.int64), empty.astype(np.int64), empty.astype(np.float32))
        q = np.asarray(query, dtype=np.float32).reshape(-1)
        scores = vecs @ q
        if use_bias:
            scores = scores + bias
        k = min(top, len(scores))
        idx = np.argpartition(-scores, k - 1)[:k]
        idx = idx[np.argsort(-scores[idx])]
        return Hits(cids[idx], fids[idx], scores[idx])
