"""SQLite 存储：目录、文件、分块（含向量）与设置。单连接 + 锁，WAL 模式支持并发读。"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np

SCHEMA = """
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at REAL NOT NULL,
    last_scan_at REAL,
    last_error TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    excluded_kinds TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    rel_path TEXT NOT NULL,
    name TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    indexed_at REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    has_thumb INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_collection ON files(collection_id);
CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ord INTEGER NOT NULL,
    text TEXT,
    start REAL,
    "end" REAL,
    has_thumb INTEGER NOT NULL DEFAULT 0,
    vector BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(SCHEMA)
            self._migrate()

    def _migrate(self) -> None:
        cols = {r["name"] for r in self._conn.execute("PRAGMA table_info(collections)")}
        # 旧库的目录都已在索引，enabled 默认 1
        if "enabled" not in cols:
            self._conn.execute("ALTER TABLE collections ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
        if "excluded_kinds" not in cols:
            self._conn.execute("ALTER TABLE collections ADD COLUMN excluded_kinds TEXT NOT NULL DEFAULT '[]'")

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchone()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._conn.execute(sql, tuple(params))

    # ---- collections -------------------------------------------------

    def add_collection(self, path: str, name: str) -> int:
        """新目录默认未启用，由用户确认索引范围后再开始索引。"""
        cur = self.execute(
            "INSERT INTO collections(path, name, created_at, enabled) VALUES (?, ?, ?, 0)",
            (path, name, time.time()),
        )
        return int(cur.lastrowid or 0)

    def update_collection(
        self, cid: int, *, enabled: bool | None = None, excluded_kinds: list[str] | None = None
    ) -> None:
        if enabled is not None:
            self.execute("UPDATE collections SET enabled=? WHERE id=?", (int(enabled), cid))
        if excluded_kinds is not None:
            self.execute(
                "UPDATE collections SET excluded_kinds=? WHERE id=?", (json.dumps(sorted(excluded_kinds)), cid)
            )

    def collections(self) -> list[sqlite3.Row]:
        return self.query("SELECT * FROM collections ORDER BY created_at")

    def collection(self, cid: int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM collections WHERE id = ?", (cid,))

    def collection_stats(self) -> dict[int, dict[str, Any]]:
        rows = self.query(
            """SELECT collection_id, kind, status, COUNT(*) AS n, SUM(size) AS bytes
               FROM files GROUP BY collection_id, kind, status"""
        )
        out: dict[int, dict[str, Any]] = {}
        for r in rows:
            s = out.setdefault(
                r["collection_id"], {"files": 0, "bytes": 0, "errors": 0, "pending": 0, "kinds": {}}
            )
            s["files"] += r["n"]
            s["bytes"] += r["bytes"] or 0
            if r["status"] == "error":
                s["errors"] += r["n"]
            elif r["status"] == "pending":
                s["pending"] += r["n"]
            else:
                s["kinds"][r["kind"]] = s["kinds"].get(r["kind"], 0) + r["n"]
        return out

    # ---- files ---------------------------------------------------------

    def files_snapshot(self, cid: int) -> dict[str, tuple[int, int, float, str]]:
        rows = self.query("SELECT id, path, size, mtime, status FROM files WHERE collection_id = ?", (cid,))
        return {r["path"]: (r["id"], r["size"], r["mtime"], r["status"]) for r in rows}

    def file(self, fid: int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM files WHERE id = ?", (fid,))

    def files_by_ids(self, ids: Iterable[int]) -> dict[int, sqlite3.Row]:
        ids = list(ids)
        if not ids:
            return {}
        marks = ",".join("?" * len(ids))
        return {r["id"]: r for r in self.query(f"SELECT * FROM files WHERE id IN ({marks})", ids)}

    def chunks_by_ids(self, ids: Iterable[int]) -> dict[int, sqlite3.Row]:
        ids = list(ids)
        if not ids:
            return {}
        marks = ",".join("?" * len(ids))
        rows = self.query(
            f'SELECT id, file_id, kind, ord, text, start, "end", has_thumb FROM chunks WHERE id IN ({marks})',
            ids,
        )
        return {r["id"]: r for r in rows}

    def file_chunks(self, fid: int) -> list[sqlite3.Row]:
        return self.query(
            'SELECT id, kind, ord, text, start, "end", has_thumb FROM chunks WHERE file_id = ? ORDER BY kind, ord',
            (fid,),
        )

    def file_vectors(self, fid: int) -> np.ndarray:
        rows = self.query("SELECT vector FROM chunks WHERE file_id = ?", (fid,))
        if not rows:
            return np.zeros((0, 0), dtype=np.float32)
        return np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows])

    def upsert_pending(
        self, cid: int, path: str, rel: str, name: str, ext: str, kind: str, size: int, mtime: float
    ) -> int:
        row = self.one("SELECT id FROM files WHERE path = ?", (path,))
        if row:
            self.execute(
                """UPDATE files SET collection_id=?, rel_path=?, name=?, ext=?, kind=?, size=?, mtime=?,
                   status='pending', error=NULL WHERE id=?""",
                (cid, rel, name, ext, kind, size, mtime, row["id"]),
            )
            return int(row["id"])
        cur = self.execute(
            """INSERT INTO files(collection_id, path, rel_path, name, ext, kind, size, mtime, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (cid, path, rel, name, ext, kind, size, mtime),
        )
        return int(cur.lastrowid or 0)

    def save_file_result(
        self,
        fid: int,
        chunks: list[dict[str, Any]],
        vectors: np.ndarray,
        meta: dict[str, Any],
        has_thumb: bool,
    ) -> list[int]:
        """原子替换某文件的全部分块，返回新分块 id（与 chunks 顺序一致）。"""
        ids: list[int] = []
        with self.tx() as c:
            c.execute("DELETE FROM chunks WHERE file_id = ?", (fid,))
            for ch, vec in zip(chunks, vectors, strict=True):
                cur = c.execute(
                    'INSERT INTO chunks(file_id, kind, ord, text, start, "end", has_thumb, vector) VALUES (?,?,?,?,?,?,?,?)',
                    (
                        fid,
                        ch["kind"],
                        ch["ord"],
                        ch.get("text"),
                        ch.get("start"),
                        ch.get("end"),
                        int(bool(ch.get("thumb"))),
                        np.asarray(vec, dtype=np.float32).tobytes(),
                    ),
                )
                ids.append(int(cur.lastrowid or 0))
            c.execute(
                "UPDATE files SET status='ok', error=NULL, indexed_at=?, meta=?, has_thumb=? WHERE id=?",
                (time.time(), json.dumps(meta, ensure_ascii=False), int(has_thumb), fid),
            )
        return ids

    def mark_error(self, fid: int, error: str) -> None:
        with self.tx() as c:
            c.execute("DELETE FROM chunks WHERE file_id = ?", (fid,))
            c.execute(
                "UPDATE files SET status='error', error=?, indexed_at=? WHERE id=?",
                (error[:500], time.time(), fid),
            )

    def delete_files(self, ids: list[int]) -> None:
        if not ids:
            return
        with self.tx() as c:
            for i in range(0, len(ids), 500):
                part = ids[i : i + 500]
                marks = ",".join("?" * len(part))
                c.execute(f"DELETE FROM chunks WHERE file_id IN ({marks})", part)
                c.execute(f"DELETE FROM files WHERE id IN ({marks})", part)

    def iter_vectors(
        self, batch: int = 4096
    ) -> Iterator[tuple[np.ndarray, np.ndarray, np.ndarray, list[str]]]:
        """按批读取 (chunk_id, file_id, vector, chunk_kind)，用于启动时重建内存索引。"""
        last = 0
        while True:
            rows = self.query(
                "SELECT id, file_id, kind, vector FROM chunks WHERE id > ? ORDER BY id LIMIT ?", (last, batch)
            )
            if not rows:
                return
            last = rows[-1]["id"]
            yield (
                np.array([r["id"] for r in rows], dtype=np.int64),
                np.array([r["file_id"] for r in rows], dtype=np.int64),
                np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows]),
                [r["kind"] for r in rows],
            )

    # ---- settings ------------------------------------------------------

    def get_settings(self) -> dict[str, Any]:
        return {r["key"]: json.loads(r["value"]) for r in self.query("SELECT key, value FROM settings")}

    def put_settings(self, values: dict[str, Any]) -> None:
        with self.tx() as c:
            for k, v in values.items():
                c.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, json.dumps(v, ensure_ascii=False)),
                )
