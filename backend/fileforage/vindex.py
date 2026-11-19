"""内存向量索引：所有分块向量常驻内存，矩阵乘法暴力检索（百万分块级别在百毫秒内）。"""

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


def _match(values: np.ndarray, targets: list[int] | set[int]) -> np.ndarray:
    """少量目标时逐个比较，比 np.isin（会排序整列）快一个数量级。"""
    if len(targets) > 8:
        return np.isin(values, np.fromiter(targets, dtype=np.int64))
    hit = np.zeros(len(values), dtype=np.bool_)
    for t in targets:
        hit |= values == t
    return hit


@dataclass
class Hits:
    chunk_ids: np.ndarray
    file_ids: np.ndarray
    scores: np.ndarray


class VectorIndex:
    """向量按行存放在预留容量的缓冲区里：新增只写入尾部，删除只打标记，避免每次变动都复制整个矩阵。

    检索在锁内取 [:n] 视图、锁外计算：新增只写 n 之后的行，扩容与压缩都换新缓冲区，不会改动已取出的视图。
    """

    _COLS = ("_chunk_ids", "_file_ids", "_kinds", "_colls", "_bias", "_alive")
    _DTYPES = (np.int64, np.int64, np.int8, np.int64, np.float32, np.bool_)

    def __init__(self, dim: int = 768):
        self.dim = dim
        self._lock = threading.RLock()
        self._n = 0  # 已使用的行数（含已删除）
        self._dead = 0
        self._alloc(0)

    def _alloc(self, cap: int) -> None:
        self._vecs = np.empty((cap, self.dim), dtype=np.float32)
        for name, dtype in zip(self._COLS, self._DTYPES, strict=True):
            setattr(self, name, np.zeros(cap, dtype=dtype))

    def __len__(self) -> int:
        with self._lock:
            return self._n - self._dead

    def _resize(self, cap: int, rows: np.ndarray | slice) -> None:
        """把选中的行搬到容量为 cap 的新缓冲区。"""
        old = (self._vecs, *(getattr(self, c) for c in self._COLS))
        self._alloc(cap)
        n = rows.stop if isinstance(rows, slice) else len(rows)
        self._vecs[:n] = old[0][rows]
        for name, arr in zip(self._COLS, old[1:], strict=True):
            getattr(self, name)[:n] = arr[rows]
        self._n = n

    def add(
        self,
        chunk_ids: np.ndarray,
        file_ids: np.ndarray,
        vecs: np.ndarray,
        kinds: np.ndarray,
        colls: np.ndarray,
        bias: np.ndarray,
    ) -> None:
        k = len(chunk_ids)
        if k == 0:
            return
        with self._lock:
            n = self._n
            if n + k > len(self._vecs):
                self._resize(max(n + k, len(self._vecs) * 3 // 2, 1024), slice(0, n))
            end = n + k
            self._vecs[n:end] = np.asarray(vecs, dtype=np.float32).reshape(-1, self.dim)
            self._chunk_ids[n:end] = chunk_ids
            self._file_ids[n:end] = file_ids
            self._kinds[n:end] = kinds
            self._colls[n:end] = colls
            self._bias[n:end] = bias
            self._alive[n:end] = True
            self._n = end

    def remove_files(self, file_ids: list[int] | set[int]) -> None:
        if not file_ids:
            return
        with self._lock:
            n = self._n
            fids = self._file_ids[:n]
            hit = _match(fids, file_ids)
            hit &= self._alive[:n]
            removed = int(np.count_nonzero(hit))
            if not removed:
                return
            self._alive[:n][hit] = False
            self._dead += removed
            # 已删除的行超过四分之一时压缩，压缩换新缓冲区，正在进行的检索不受影响
            if self._dead > max(n // 4, 1024) or self._dead == n:
                live = np.flatnonzero(self._alive[:n])
                self._resize(len(live), live)
                self._dead = 0

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
            n = self._n
            vecs, cids, fids = self._vecs[:n], self._chunk_ids[:n], self._file_ids[:n]
            ckinds, colls, bias = self._kinds[:n], self._colls[:n], self._bias[:n]
            mask = self._alive[:n].copy()
        # 先对全部向量打分，再把不符合筛选的分数置为 -inf，不复制向量矩阵
        if kinds:
            mask &= np.isin(ckinds, [KIND_CODES[k] for k in kinds if k in KIND_CODES])
        if collections:
            mask &= _match(colls, collections)
        if exclude_file is not None:
            mask &= fids != exclude_file
        valid = int(np.count_nonzero(mask))
        if valid == 0:
            empty = np.zeros(0)
            return Hits(empty.astype(np.int64), empty.astype(np.int64), empty.astype(np.float32))
        q = np.asarray(query, dtype=np.float32).reshape(-1)
        scores = vecs @ q
        if use_bias:
            scores += bias
        scores[~mask] = -np.inf
        k = min(top, valid)
        idx = np.argpartition(-scores, k - 1)[:k]
        idx = idx[np.argsort(-scores[idx])]
        return Hits(cids[idx], fids[idx], scores[idx])
