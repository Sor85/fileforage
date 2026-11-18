"""检索：向量召回 → 按文件聚合 → 文件名 / 文本字面匹配加权 → 阈值过滤。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .app_state import AppState

# EmbeddingGemma 2 的余弦相似度：无关内容约 0.45–0.6，强相关约 0.7–0.85
SCORE_FLOOR = 0.5
SCORE_CEIL = 0.77
TOP_WINDOW = 0.11  # 文本查询只保留与最佳结果相差不超过该值的结果
MAX_EXTRA = 4


# 以图搜图 / 查找相似时是同模态比较，相似度整体更高
MEDIA_FLOOR = 0.6
MEDIA_CEIL = 0.95


def relevance(score: float, media: bool = False) -> float:
    lo, hi = (MEDIA_FLOOR, MEDIA_CEIL) if media else (SCORE_FLOOR, SCORE_CEIL)
    return float(np.clip((score - lo) / (hi - lo), 0, 1))


def file_payload(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "collection_id": row["collection_id"],
        "name": row["name"],
        "rel_path": row["rel_path"],
        "path": row["path"],
        "dir": "" if (parent := str(Path(row["rel_path"]).parent)) == "." else parent,
        "ext": row["ext"],
        "kind": row["kind"],
        "size": row["size"],
        "mtime": row["mtime"],
        "status": row["status"],
        "error": row["error"],
        "meta": json.loads(row["meta"] or "{}"),
        "has_thumb": bool(row["has_thumb"]),
    }


def chunk_payload(ch: Any, score: float | None = None) -> dict[str, Any]:
    text = ch["text"]
    if text and len(text) > 600:
        text = text[:600] + "…"
    out = {
        "id": ch["id"],
        "kind": ch["kind"],
        "ord": ch["ord"],
        "text": text,
        "start": ch["start"],
        "end": ch["end"],
        "has_thumb": bool(ch["has_thumb"]),
    }
    if score is not None:
        out["score"] = round(float(score), 4)
    return out


def run_search(
    s: AppState,
    vec: np.ndarray,
    *,
    query_text: str | None = None,
    kinds: list[str] | None = None,
    collections: list[int] | None = None,
    limit: int = 80,
    exclude_file: int | None = None,
    min_score: float | None = None,
) -> list[dict[str, Any]]:
    # 以图搜图 / 查找相似时查询本身不是文本，不做模态补偿
    hits = s.index.search(
        vec,
        top=4000,
        kinds=kinds,
        collections=collections,
        exclude_file=exclude_file,
        use_bias=query_text is not None,
    )
    if len(hits.scores) == 0:
        return []
    threshold = s.settings.min_score if min_score is None else min_score

    # 按文件聚合：最佳分块 + 与最佳分数接近的其他命中
    groups: dict[int, list[tuple[int, float]]] = {}
    for cid, fid, sc in zip(
        hits.chunk_ids.tolist(), hits.file_ids.tolist(), hits.scores.tolist(), strict=True
    ):
        g = groups.get(fid)
        if g is None:
            if len(groups) >= limit * 3:
                continue
            groups[fid] = [(cid, sc)]
        elif len(g) <= MAX_EXTRA and sc >= g[0][1] - 0.04:
            g.append((cid, sc))

    chunk_rows = s.db.chunks_by_ids(c for g in groups.values() for c, _ in g)
    file_rows = s.db.files_by_ids(groups)
    q = (query_text or "").strip().lower()

    results = []
    for fid, g in groups.items():
        f = file_rows.get(fid)
        if f is None or f["status"] != "ok":
            continue
        # 优先展示内容命中；文件名分块只在没有更好的内容命中时作为主命中
        content = [(c, sc) for c, sc in g if chunk_rows[c]["kind"] != "name"]
        best_c, best_s = g[0]
        score = best_s
        if chunk_rows[best_c]["kind"] == "name":
            if content and content[0][1] >= best_s - 0.05:
                best_c = content[0][0]
        if q:
            if q in f["name"].lower():
                score += 0.06
            elif any(q in (chunk_rows[c]["text"] or "").lower() for c, _ in g):
                score += 0.03
        if score < threshold:
            continue
        extra = [
            chunk_payload(chunk_rows[c], sc)
            for c, sc in content
            if c != best_c and chunk_rows[c]["kind"] != "name"
        ]
        results.append(
            {
                "file": file_payload(f),
                "score": round(float(score), 4),
                "relevance": round(relevance(score, media=query_text is None), 4),
                "match": chunk_payload(chunk_rows[best_c], dict(g).get(best_c, best_s)),
                "extra": extra[:MAX_EXTRA],
            }
        )
    results.sort(key=lambda r: -r["score"])
    if results and query_text is not None:
        floor = results[0]["score"] - TOP_WINDOW
        results = [r for r in results if r["score"] >= floor]
    return results[:limit]


def file_query_vector(s: AppState, fid: int) -> np.ndarray | None:
    """以文件内容（不含文件名分块）的平均向量作为“查找相似”的查询。"""
    rows = s.db.query("SELECT kind, vector FROM chunks WHERE file_id = ? AND kind != 'name'", (fid,))
    if not rows:
        rows = s.db.query("SELECT kind, vector FROM chunks WHERE file_id = ?", (fid,))
    if not rows:
        return None
    m = np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows]).mean(axis=0)
    n = float(np.linalg.norm(m))
    return m / n if n else None
