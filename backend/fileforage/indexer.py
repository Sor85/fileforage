"""索引任务：扫描目录、增量比对、逐文件提取与嵌入，并可监听目录变化。"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from . import extractors, media
from .embedder import document_text
from .vindex import KIND_CODES, chunk_bias

if TYPE_CHECKING:
    from .app_state import AppState

log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


@dataclass
class Progress:
    phase: str = "idle"  # idle | waiting_model | scanning | indexing
    collection_id: int | None = None
    collection_name: str | None = None
    total: int = 0
    done: int = 0
    failed: int = 0
    current: str | None = None
    current_progress: float = 0.0
    started_at: float | None = None
    eta_seconds: float | None = None
    paused: bool = False
    queued: list[int] = field(default_factory=list)


class Indexer:
    def __init__(self, state: AppState):
        self.s = state
        self.progress = Progress()
        self._queue: deque[int] = deque()
        self._cond = threading.Condition()
        self._cancel = threading.Event()
        self._resume = threading.Event()
        self._resume.set()
        self._stop = threading.Event()
        self._watch_reload = threading.Event()

    # ---- 控制 -----------------------------------------------------------

    def start(self) -> None:
        threading.Thread(target=self._worker, name="indexer", daemon=True).start()
        threading.Thread(target=self._watcher, name="watcher", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self._cancel.set()
        self._resume.set()
        with self._cond:
            self._cond.notify_all()

    def enqueue(self, cid: int) -> None:
        with self._cond:
            if cid not in self._queue:
                self._queue.append(cid)
            self.progress.queued = list(self._queue)
            self._cond.notify_all()

    def enqueue_all(self) -> None:
        for c in self.s.db.collections():
            self.enqueue(c["id"])

    def cancel(self, cid: int | None = None) -> None:
        with self._cond:
            if cid is None:
                self._queue.clear()
            elif cid in self._queue:
                self._queue.remove(cid)
            self.progress.queued = list(self._queue)
        if cid is None or self.progress.collection_id == cid:
            self._cancel.set()
            self._resume.set()

    def pause(self, paused: bool) -> None:
        self.progress.paused = paused
        if paused:
            self._resume.clear()
        else:
            self._resume.set()

    def collections_changed(self) -> None:
        self._watch_reload.set()

    def snapshot(self) -> dict[str, Any]:
        return asdict(self.progress)

    # ---- 主循环 ---------------------------------------------------------

    def _worker(self) -> None:
        while not self._stop.is_set():
            with self._cond:
                while not self._queue and not self._stop.is_set():
                    self._cond.wait(timeout=5)
                if self._stop.is_set():
                    return
                cid = self._queue.popleft()
                self.progress.queued = list(self._queue)
            self._cancel.clear()
            try:
                self._run_collection(cid)
            except Cancelled:
                log.info("目录 %s 的索引已取消", cid)
            except Exception as e:  # pragma: no cover - 防御性兜底
                log.exception("索引目录 %s 失败", cid)
                self.s.db.execute("UPDATE collections SET last_error=? WHERE id=?", (str(e)[:500], cid))
            finally:
                q = list(self._queue)
                self.progress = Progress(paused=self.progress.paused, queued=q)

    def _checkpoint(self) -> None:
        self._resume.wait()
        if self._cancel.is_set() or self._stop.is_set():
            raise Cancelled

    def _run_collection(self, cid: int) -> None:
        coll = self.s.db.collection(cid)
        if coll is None:
            return
        root = Path(coll["path"])
        p = self.progress
        p.collection_id, p.collection_name, p.started_at = cid, coll["name"], time.time()
        if not root.is_dir():
            self.s.db.execute("UPDATE collections SET last_error=? WHERE id=?", ("目录不存在或无法访问", cid))
            return

        p.phase = "scanning"
        pending = self._scan(cid, root)
        self.s.db.execute(
            "UPDATE collections SET last_scan_at=?, last_error=NULL WHERE id=?", (time.time(), cid)
        )
        if not pending:
            return

        p.phase = "waiting_model"
        while not self.s.embedder.wait_ready(timeout=1):
            self._checkpoint()
        if self.s.embedder.status != "ready":
            raise RuntimeError(self.s.embedder.error or "模型加载失败")

        p.phase, p.total, p.done, p.started_at = "indexing", len(pending), 0, time.time()
        for fid in pending:
            self._checkpoint()
            row = self.s.db.file(fid)
            if row is None:
                continue
            p.current, p.current_progress = row["rel_path"], 0.0
            try:
                self._index_file(row)
            except Cancelled:
                raise
            except Exception as e:
                log.warning("索引失败 %s：%s", row["path"], e)
                self.s.db.mark_error(
                    fid, f"{type(e).__name__}: {e}" if not isinstance(e, media.MediaError) else str(e)
                )
                self.s.index.remove_files({fid})
                p.failed += 1
            p.done += 1
            elapsed = time.time() - (p.started_at or time.time())
            p.eta_seconds = round(elapsed / p.done * (p.total - p.done), 1) if p.done else None

    # ---- 扫描 -----------------------------------------------------------

    def _scan(self, cid: int, root: Path) -> list[int]:
        st = self.s.settings
        known = self.s.db.files_snapshot(cid)
        seen: set[str] = set()
        pending: list[int] = []
        data_dir = self.s.config.data_dir
        stack = [root]
        while stack:
            self._checkpoint()
            d = stack.pop()
            try:
                entries = list(os.scandir(d))
            except OSError:
                continue
            for e in entries:
                if extractors.is_excluded(e.name, st.excludes, st.include_hidden):
                    continue
                try:
                    if e.is_dir(follow_symlinks=False):
                        if Path(e.path) != data_dir:
                            stack.append(Path(e.path))
                        continue
                    if not e.is_file(follow_symlinks=True):
                        continue
                    info = e.stat()
                except OSError:
                    continue
                path = Path(e.path)
                cls = extractors.classify(path)
                if cls is None or info.st_size == 0:
                    continue
                kind, ext = cls
                if kind in ("text", "document") and info.st_size > st.max_text_mb * 1024 * 1024:
                    continue
                key = str(path)
                seen.add(key)
                prev = known.get(key)
                if (
                    prev
                    and prev[1] == info.st_size
                    and abs(prev[2] - info.st_mtime) < 1e-3
                    and prev[3] != "pending"
                ):
                    continue
                fid = self.s.db.upsert_pending(
                    cid, key, str(path.relative_to(root)), path.name, ext, kind, info.st_size, info.st_mtime
                )
                pending.append(fid)
            self.progress.total = len(seen)
        gone = [v[0] for k, v in known.items() if k not in seen]
        if gone:
            self.remove_files(gone)
        # 媒体最耗时，先处理文本与图片，让结果尽早可搜
        order = {"text": 0, "document": 1, "image": 2, "audio": 3, "video": 4}
        rows = self.s.db.files_by_ids(pending)
        pending.sort(key=lambda f: (order.get(rows[f]["kind"], 9), rows[f]["rel_path"]))
        return pending

    def remove_files(self, fids: list[int]) -> None:
        self.s.index.remove_files(set(fids))
        self.s.db.delete_files(fids)
        for fid in fids:
            shutil.rmtree(self.s.config.thumb_dir / str(fid), ignore_errors=True)

    # ---- 单文件处理 -----------------------------------------------------

    def _thumb_path(self, fid: int, name: str) -> Path:
        return self.s.config.thumb_dir / str(fid) / f"{name}.webp"

    def _index_file(self, row: Any) -> None:
        fid, kind, path = row["id"], row["kind"], Path(row["path"])
        shutil.rmtree(self.s.config.thumb_dir / str(fid), ignore_errors=True)
        handler = {
            "text": self._index_text,
            "document": self._index_text,
            "image": self._index_image,
            "audio": self._index_audio,
            "video": self._index_video,
        }[kind]
        chunks, vecs, meta, has_thumb = handler(row, path)
        # 文件名本身也作为一个可检索分块
        stem = Path(row["name"]).stem.replace("_", " ").replace("-", " ")
        name_vec = self.s.embedder.documents([document_text(row["rel_path"], stem)])
        chunks.insert(0, {"kind": "name", "ord": 0, "text": row["name"]})
        vecs = np.concatenate([name_vec, vecs]) if len(vecs) else name_vec
        ids = self.s.db.save_file_result(fid, chunks, vecs, meta, has_thumb)
        self.s.index.remove_files({fid})
        n = len(ids)
        self.s.index.add(
            np.array(ids),
            np.full(n, fid),
            vecs,
            np.full(n, KIND_CODES[kind]),
            np.full(n, row["collection_id"]),
            chunk_bias([c["kind"] for c in chunks]),
        )

    def _embed_texts(self, title: str, texts: list[str], base: float = 0.0, span: float = 1.0) -> np.ndarray:
        out = []
        step = 8
        for i in range(0, len(texts), step):
            self._checkpoint()
            out.append(self.s.embedder.documents([document_text(title, t) for t in texts[i : i + step]]))
            self.progress.current_progress = base + span * min(1.0, (i + step) / len(texts))
        return np.concatenate(out) if out else np.zeros((0, self.s.embedder.dim), dtype=np.float32)

    def _index_text(self, row: Any, path: Path) -> tuple[list[dict], np.ndarray, dict, bool]:
        ex = extractors.extract_text(path, row["ext"])
        if not ex.chunks and not ex.pages:
            raise ValueError("没有可提取的文本内容")
        title = Path(row["name"]).stem
        chunks: list[dict[str, Any]] = [
            {"kind": "text", "ord": i, "text": c["text"], "start": c.get("start")}
            for i, c in enumerate(ex.chunks)
        ]
        parts = [self._embed_texts(title, [c["text"] for c in ex.chunks], 0, 0.8)] if ex.chunks else []
        for i, (page_no, img) in enumerate(ex.pages):
            self._checkpoint()
            media.save_thumb(img, self._thumb_path(row["id"], f"page-{i}"))
            chunks.append({"kind": "page", "ord": i, "start": page_no, "thumb": True})
            parts.append(self.s.embedder.images([img]))
            self.progress.current_progress = 0.8 + 0.2 * (i + 1) / len(ex.pages)
        has_thumb = False
        if ex.thumb is not None:
            media.save_thumb(ex.thumb, self._thumb_path(row["id"], "file"))
            has_thumb = True
            ex.meta["width"], ex.meta["height"] = ex.thumb.size
        return chunks, np.concatenate(parts), ex.meta, has_thumb

    def _index_image(self, row: Any, path: Path) -> tuple[list[dict], np.ndarray, dict, bool]:
        img = media.load_image(path)
        w, h = img.size
        mp = self.s.settings.min_image_px
        if w < mp and h < mp:
            raise ValueError(f"图片尺寸过小（{w}×{h}），已跳过")
        media.save_thumb(img, self._thumb_path(row["id"], "file"))
        if max(w, h) > 2048:
            img.thumbnail((2048, 2048))
        vec = self.s.embedder.images([img])
        return [{"kind": "image", "ord": 0}], vec, {"width": w, "height": h}, True

    def _transcribe(self, row: Any, audio: np.ndarray, base: float) -> tuple[list[dict], np.ndarray]:
        st = self.s.settings
        if not st.transcribe:
            return [], np.zeros((0, self.s.embedder.dim), dtype=np.float32)
        self._checkpoint()
        segs = self.s.transcriber.transcribe(audio, st.whisper_model)
        if not segs:
            return [], np.zeros((0, self.s.embedder.dim), dtype=np.float32)
        chunks = [
            {"kind": "transcript", "ord": i, "text": s["text"], "start": s["start"], "end": s["end"]}
            for i, s in enumerate(segs)
        ]
        vecs = self._embed_texts(Path(row["name"]).stem, [s["text"] for s in segs], base, 1 - base)
        return chunks, vecs

    def _index_audio(self, row: Any, path: Path) -> tuple[list[dict], np.ndarray, dict, bool]:
        pr = media.probe(path)
        if not pr.has_audio:
            raise ValueError("文件中没有音轨")
        audio = media.decode_audio(path)
        duration = len(audio) / media.SAMPLE_RATE
        seg = self.s.settings.audio_segment_seconds
        n = max(1, int(np.ceil(duration / seg)))
        chunks: list[dict[str, Any]] = []
        parts: list[np.ndarray] = []
        for i in range(n):
            self._checkpoint()
            a = audio[i * seg * media.SAMPLE_RATE : (i + 1) * seg * media.SAMPLE_RATE]
            if len(a) < media.SAMPLE_RATE // 2 and i > 0:
                break
            parts.append(self.s.embedder.audios([a]))
            chunks.append({"kind": "audio", "ord": i, "start": i * seg, "end": min(duration, (i + 1) * seg)})
            self.progress.current_progress = 0.5 * (i + 1) / n
        t_chunks, t_vecs = self._transcribe(row, audio, 0.5)
        chunks += t_chunks
        parts.append(t_vecs)
        return chunks, np.concatenate(parts), {"duration": round(duration, 2)}, False

    def _index_video(self, row: Any, path: Path) -> tuple[list[dict], np.ndarray, dict, bool]:
        st = self.s.settings
        pr = media.probe(path)
        if not pr.has_video or pr.duration <= 0:
            raise ValueError("无法读取视频流")
        duration = pr.duration
        fps = min(1.0, st.video_max_frames / duration)
        # 长视频降低抽帧率；每段至少 8 帧，最多 32 帧（模型单段视频帧上限）
        seg = min(max(float(st.video_segment_seconds), 8 / fps), 32 / fps)
        n = max(1, int(np.ceil(duration / seg)))
        audio = media.decode_audio(path) if pr.has_audio else None
        chunks: list[dict[str, Any]] = []
        parts: list[np.ndarray] = []
        poster = None
        for i in range(n):
            self._checkpoint()
            start = i * seg
            length = min(seg, duration - start)
            if length < 0.5 and i > 0:
                break
            frames = media.decode_frames(path, start, length, fps)
            if len(frames) == 0:
                continue
            clip = None
            if audio is not None:
                clip = audio[int(start * media.SAMPLE_RATE) : int((start + length) * media.SAMPLE_RATE)]
            parts.append(self.s.embedder.videos([(frames, clip)]))
            mid = media.frame_to_image(frames[len(frames) // 2])
            media.save_thumb(mid, self._thumb_path(row["id"], f"video-{i}"), size=480)
            if poster is None:
                poster = mid
            chunks.append({"kind": "video", "ord": i, "start": start, "end": start + length, "thumb": True})
            self.progress.current_progress = (0.7 if audio is not None else 1.0) * (i + 1) / n
        if not parts:
            raise ValueError("视频解码失败")
        try:
            poster = media.video_poster(path, min(duration * 0.1, 3.0))
        except media.MediaError:
            pass
        media.save_thumb(poster, self._thumb_path(row["id"], "file"))
        if audio is not None:
            t_chunks, t_vecs = self._transcribe(row, audio, 0.7)
            chunks += t_chunks
            parts.append(t_vecs)
        meta = {
            "duration": round(duration, 2),
            "width": pr.width,
            "height": pr.height,
            "has_audio": pr.has_audio,
        }
        return chunks, np.concatenate(parts), meta, True

    # ---- 目录监听 -------------------------------------------------------

    def _watcher(self) -> None:
        from watchfiles import watch

        while not self._stop.is_set():
            self._watch_reload.clear()
            colls = {c["id"]: Path(c["path"]) for c in self.s.db.collections() if Path(c["path"]).is_dir()}
            if not self.s.settings.watch or not colls:
                self._watch_reload.wait(timeout=10)
                continue
            stop = threading.Event()

            def relay(stop: threading.Event = stop) -> None:
                while not stop.is_set():
                    if self._watch_reload.wait(timeout=1) or self._stop.is_set():
                        stop.set()

            threading.Thread(target=relay, daemon=True).start()
            try:
                for changes in watch(
                    *colls.values(), stop_event=stop, debounce=3000, step=500, rust_timeout=0
                ):
                    hit: set[int] = set()
                    data_dir = str(self.s.config.data_dir)
                    for _change, p in changes:
                        if p.startswith(data_dir):
                            continue
                        for cid, root in colls.items():
                            if p.startswith(str(root)):
                                hit.add(cid)
                    for cid in hit:
                        self.enqueue(cid)
            except Exception as e:  # pragma: no cover - 文件系统差异
                log.warning("目录监听异常：%s", e)
                time.sleep(10)
            finally:
                stop.set()
