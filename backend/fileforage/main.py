"""FastAPI 应用：REST API + WebUI 静态资源。"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__, media
from .app_state import AppState
from .config import load_config
from .extractors import read_text_file
from .search import chunk_payload, file_payload, file_query_vector, run_search

log = logging.getLogger("fileforage")

KINDS = {"text", "document", "image", "video", "audio"}
PREVIEW_TEXT_LIMIT = 400_000
MEDIA_MIN_SCORE = 0.6  # 以图搜图 / 查找相似的最低相似度


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    state = AppState.create(config)
    state.load_index()
    state.embedder.start_loading()
    state.indexer.start()
    state.indexer.enqueue_all()
    app.state.s = state
    log.info("数据目录 %s，可浏览根目录 %s", config.data_dir, ", ".join(map(str, config.roots)))
    yield
    state.indexer.stop()


app = FastAPI(title="FileForage", version=__version__, lifespan=lifespan)


def S() -> AppState:
    return app.state.s


def _within_roots(p: Path) -> bool:
    return any(p == r or p.is_relative_to(r) for r in S().config.roots)


def _parse_kinds(kinds: str | None) -> list[str] | None:
    if not kinds:
        return None
    out = [k for k in kinds.split(",") if k in KINDS]
    return out or None


def _parse_ids(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    return [int(x) for x in raw.split(",") if x.strip().isdigit()] or None


def _file_or_404(fid: int) -> Any:
    row = S().db.file(fid)
    if row is None:
        raise HTTPException(404, "文件不存在")
    return row


# ---- 状态 --------------------------------------------------------------------


@app.get("/api/status")
def status() -> dict[str, Any]:
    s = S()
    rows = s.db.query(
        "SELECT kind, status, COUNT(*) AS n, SUM(size) AS bytes FROM files GROUP BY kind, status"
    )
    by_kind: dict[str, int] = {}
    files = errors = pending = 0
    total_bytes = 0
    for r in rows:
        files += r["n"]
        if r["status"] == "ok":
            by_kind[r["kind"]] = by_kind.get(r["kind"], 0) + r["n"]
            total_bytes += r["bytes"] or 0
        elif r["status"] == "error":
            errors += r["n"]
        else:
            pending += r["n"]
    return {
        "version": __version__,
        "model": s.embedder.info(),
        "whisper": {
            "enabled": s.settings.transcribe,
            "model": s.settings.whisper_model,
            "error": s.transcriber.error,
        },
        "indexer": s.indexer.snapshot(),
        "stats": {
            "files": files,
            "indexed": sum(by_kind.values()),
            "errors": errors,
            "pending": pending,
            "bytes": total_bytes,
            "chunks": len(s.index),
            "by_kind": by_kind,
            "collections": len(s.db.collections()),
        },
    }


# ---- 文件系统浏览 ------------------------------------------------------------


@app.get("/api/fs")
def list_dir(path: str | None = None) -> dict[str, Any]:
    s = S()
    if not path:
        return {
            "path": None,
            "parent": None,
            "entries": [{"name": str(r), "path": str(r)} for r in s.config.roots if r.is_dir()],
        }
    p = Path(path).expanduser().resolve()
    if not _within_roots(p) or not p.is_dir():
        raise HTTPException(400, "目录不可访问")
    entries = []
    try:
        for e in sorted(os.scandir(p), key=lambda e: e.name.lower()):
            if e.name.startswith(".") or not e.is_dir(follow_symlinks=True):
                continue
            entries.append({"name": e.name, "path": str(Path(e.path))})
    except PermissionError as err:
        raise HTTPException(403, "没有读取该目录的权限") from err
    parent = str(p.parent) if p not in s.config.roots and _within_roots(p.parent) else None
    return {"path": str(p), "parent": parent, "entries": entries}


# ---- 目录（资料库） ----------------------------------------------------------


class CollectionIn(BaseModel):
    path: str
    name: str | None = None


class CollectionPatch(BaseModel):
    excluded_kinds: list[str] | None = None


def _collection_or_404(cid: int) -> Any:
    row = S().db.collection(cid)
    if row is None:
        raise HTTPException(404, "目录不存在")
    return row


def _single_payload(cid: int) -> dict[str, Any]:
    return _collection_payload(S().db.collection(cid), S().db.collection_stats())


def _collection_payload(row: Any, stats: dict[int, dict[str, Any]]) -> dict[str, Any]:
    st = stats.get(row["id"], {"files": 0, "bytes": 0, "errors": 0, "pending": 0, "kinds": {}})
    return {
        "id": row["id"],
        "path": row["path"],
        "name": row["name"],
        "created_at": row["created_at"],
        "last_scan_at": row["last_scan_at"],
        "last_error": row["last_error"],
        "enabled": bool(row["enabled"]),
        "excluded_kinds": json.loads(row["excluded_kinds"]),
        "exists": Path(row["path"]).is_dir(),
        **st,
    }


@app.get("/api/collections")
def list_collections() -> list[dict[str, Any]]:
    s = S()
    stats = s.db.collection_stats()
    return [_collection_payload(r, stats) for r in s.db.collections()]


@app.post("/api/collections")
def add_collection(body: CollectionIn) -> dict[str, Any]:
    s = S()
    p = Path(body.path).expanduser().resolve()
    if not p.is_dir():
        raise HTTPException(400, "目录不存在")
    if not _within_roots(p):
        raise HTTPException(400, "目录不在允许访问的范围内（FF_ROOTS）")
    for c in s.db.collections():
        other = Path(c["path"])
        if p == other or p.is_relative_to(other) or other.is_relative_to(p):
            raise HTTPException(409, f"与已添加的目录「{c['name']}」重叠")
    cid = s.db.add_collection(str(p), (body.name or p.name or str(p)).strip())
    return _single_payload(cid)


@app.patch("/api/collections/{cid}")
def update_collection(cid: int, body: CollectionPatch) -> dict[str, Any]:
    s = S()
    row = _collection_or_404(cid)
    if body.excluded_kinds is not None:
        excluded = sorted(set(body.excluded_kinds))
        if not set(excluded) <= KINDS:
            raise HTTPException(422, "未知的文件种类")
        if set(excluded) == KINDS:
            raise HTTPException(422, "至少保留一种文件种类")
        s.db.update_collection(cid, excluded_kinds=excluded)
        # 已在索引的目录立即按新范围重新扫描：移除被排除的文件，补上新纳入的文件
        if row["enabled"] and excluded != json.loads(row["excluded_kinds"]):
            s.indexer.enqueue(cid)
    return _single_payload(cid)


@app.post("/api/collections/{cid}/start")
def start_collection(cid: int) -> dict[str, Any]:
    s = S()
    _collection_or_404(cid)
    s.db.update_collection(cid, enabled=True)
    s.indexer.enqueue(cid)
    s.indexer.collections_changed()
    return _single_payload(cid)


@app.delete("/api/collections/{cid}")
def delete_collection(cid: int) -> dict[str, bool]:
    s = S()
    if s.db.collection(cid) is None:
        raise HTTPException(404, "目录不存在")
    s.indexer.cancel(cid)
    for _ in range(50):
        if s.indexer.progress.collection_id != cid:
            break
        time.sleep(0.1)
    fids = [r["id"] for r in s.db.query("SELECT id FROM files WHERE collection_id = ?", (cid,))]
    s.indexer.remove_files(fids)
    s.db.execute("DELETE FROM collections WHERE id = ?", (cid,))
    s.indexer.collections_changed()
    return {"ok": True}


@app.post("/api/collections/{cid}/scan")
def scan_collection(cid: int) -> dict[str, bool]:
    if not _collection_or_404(cid)["enabled"]:
        raise HTTPException(409, "目录尚未开始索引")
    S().indexer.enqueue(cid)
    return {"ok": True}


@app.post("/api/collections/{cid}/reindex")
def reindex_collection(cid: int) -> dict[str, bool]:
    s = S()
    if not _collection_or_404(cid)["enabled"]:
        raise HTTPException(409, "目录尚未开始索引")
    s.db.execute("UPDATE files SET status='pending' WHERE collection_id = ?", (cid,))
    s.indexer.enqueue(cid)
    return {"ok": True}


@app.get("/api/collections/{cid}/errors")
def collection_errors(cid: int) -> list[dict[str, Any]]:
    rows = S().db.query(
        "SELECT * FROM files WHERE collection_id = ? AND status = 'error' ORDER BY rel_path LIMIT 500", (cid,)
    )
    return [file_payload(r) for r in rows]


class IndexerAction(BaseModel):
    action: str  # pause | resume | cancel


@app.post("/api/indexer")
def indexer_action(body: IndexerAction) -> dict[str, Any]:
    ix = S().indexer
    if body.action == "pause":
        ix.pause(True)
    elif body.action == "resume":
        ix.pause(False)
    elif body.action == "cancel":
        ix.cancel()
    else:
        raise HTTPException(400, "未知操作")
    return ix.snapshot()


# ---- 检索 ---------------------------------------------------------------------


def _ensure_model() -> None:
    st = S().embedder.status
    if st == "error":
        raise HTTPException(503, f"模型加载失败：{S().embedder.error}")
    if st != "ready":
        raise HTTPException(503, "模型正在加载，请稍候")


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=1, max_length=2000),
    kinds: str | None = None,
    collections: str | None = None,
    limit: int = Query(80, ge=1, le=300),
) -> dict[str, Any]:
    _ensure_model()
    s = S()
    t0 = time.perf_counter()
    vec = await run_in_threadpool(s.embedder.query, q)
    t1 = time.perf_counter()
    results = await run_in_threadpool(
        run_search,
        s,
        vec,
        query_text=q,
        kinds=_parse_kinds(kinds),
        collections=_parse_ids(collections),
        limit=limit,
    )
    return {
        "query": q,
        "results": results,
        "timing": {
            "embed_ms": round((t1 - t0) * 1000),
            "search_ms": round((time.perf_counter() - t1) * 1000),
        },
    }


@app.post("/api/search/image")
async def search_by_image(
    file: UploadFile = File(...),
    kinds: str | None = None,
    collections: str | None = None,
    limit: int = Query(80, ge=1, le=300),
) -> dict[str, Any]:
    _ensure_model()
    s = S()
    data = await file.read()
    if len(data) > 40 * 1024 * 1024:
        raise HTTPException(413, "图片过大")
    try:
        from PIL import Image, ImageOps

        img = ImageOps.exif_transpose(Image.open(BytesIO(data))).convert("RGB")
        img.thumbnail((2048, 2048))
    except Exception as e:
        raise HTTPException(400, "无法读取图片") from e
    t0 = time.perf_counter()
    vec = await run_in_threadpool(s.embedder.query_image, img)
    t1 = time.perf_counter()
    results = await run_in_threadpool(
        run_search,
        s,
        vec,
        kinds=_parse_kinds(kinds),
        collections=_parse_ids(collections),
        limit=limit,
        min_score=MEDIA_MIN_SCORE,
    )
    return {
        "query": None,
        "results": results,
        "timing": {
            "embed_ms": round((t1 - t0) * 1000),
            "search_ms": round((time.perf_counter() - t1) * 1000),
        },
    }


@app.get("/api/files/{fid}/similar")
async def similar(fid: int, kinds: str | None = None, limit: int = Query(40, ge=1, le=200)) -> dict[str, Any]:
    s = S()
    _file_or_404(fid)
    vec = file_query_vector(s, fid)
    if vec is None:
        return {"results": []}
    results = await run_in_threadpool(
        run_search,
        s,
        vec,
        kinds=_parse_kinds(kinds),
        limit=limit,
        exclude_file=fid,
        min_score=MEDIA_MIN_SCORE,
    )
    return {"results": results}


# ---- 文件 ---------------------------------------------------------------------


@app.get("/api/files/{fid}")
def file_detail(fid: int) -> dict[str, Any]:
    s = S()
    row = _file_or_404(fid)
    out = file_payload(row)
    out["chunks"] = [
        chunk_payload(c) | {"text": c["text"]} for c in s.db.file_chunks(fid) if c["kind"] != "name"
    ]
    coll = s.db.collection(row["collection_id"])
    out["collection"] = {"id": coll["id"], "name": coll["name"], "path": coll["path"]} if coll else None
    out["content"] = None
    if row["kind"] == "text":
        try:
            text = read_text_file(Path(row["path"]))
            out["content"] = text[:PREVIEW_TEXT_LIMIT]
            out["truncated"] = len(text) > PREVIEW_TEXT_LIMIT
        except Exception:
            pass
    return out


@app.get("/api/files/{fid}/raw")
def file_raw(fid: int, download: bool = False) -> FileResponse:
    row = _file_or_404(fid)
    p = Path(row["path"])
    if not p.is_file():
        raise HTTPException(404, "文件已被移动或删除")
    return FileResponse(
        p,
        filename=row["name"],
        content_disposition_type="attachment" if download else "inline",
    )


_THUMB_NAME = re.compile(r"^(file|page-\d+|video-\d+)$")


@app.get("/api/files/{fid}/thumb/{name}")
def file_thumb(fid: int, name: str = "file") -> FileResponse:
    if not _THUMB_NAME.match(name):
        raise HTTPException(400, "参数错误")
    p = S().config.thumb_dir / str(fid) / f"{name}.webp"
    if not p.is_file():
        raise HTTPException(404, "没有缩略图")
    return FileResponse(p, media_type="image/webp", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/files/{fid}/poster")
def file_poster(fid: int, at: float = 0.0) -> Any:
    """视频任意时间点的帧（用于播放器封面与时间轴预览）。"""
    row = _file_or_404(fid)
    if row["kind"] != "video":
        raise HTTPException(400, "不是视频")
    try:
        img = media.video_poster(Path(row["path"]), at)
    except media.MediaError as e:
        raise HTTPException(500, str(e)) from e
    buf = BytesIO()
    img.thumbnail((960, 960))
    img.save(buf, "WEBP", quality=80)
    from fastapi.responses import Response

    return Response(
        buf.getvalue(), media_type="image/webp", headers={"Cache-Control": "public, max-age=3600"}
    )


# ---- 设置 ---------------------------------------------------------------------


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    s = S()
    return {
        "values": s.settings.model_dump(),
        "env": {
            "model": s.config.model,
            "device": s.config.device,
            "roots": [str(r) for r in s.config.roots],
            "data_dir": str(s.config.data_dir),
            "modalities": sorted(s.config.modalities),
        },
    }


@app.put("/api/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    try:
        S().update_settings(body)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return get_settings()


@app.exception_handler(HTTPException)
async def http_error(_req: Any, exc: HTTPException) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


# ---- WebUI --------------------------------------------------------------------


def mount_web(application: FastAPI) -> None:
    web_dir = load_config().web_dir
    if web_dir is None or not (web_dir / "index.html").is_file():
        log.warning("未找到 WebUI 构建产物，只提供 API")
        return
    index = web_dir / "index.html"
    if (web_dir / "assets").is_dir():
        application.mount("/assets", StaticFiles(directory=web_dir / "assets"), name="assets")

    @application.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(404, "接口不存在")
        candidate = (web_dir / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(web_dir):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


mount_web(app)
