"""进程级共享状态：配置、数据库、模型、索引与任务。"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .config import Config
from .db import Database
from .embedder import Embedder
from .indexer import Indexer
from .settings import Settings, load_settings
from .transcriber import Transcriber
from .vindex import KIND_CODES, VectorIndex, chunk_bias

log = logging.getLogger(__name__)


@dataclass
class AppState:
    config: Config
    db: Database
    embedder: Embedder
    transcriber: Transcriber
    index: VectorIndex
    settings: Settings
    indexer: Indexer = field(init=False)

    @classmethod
    def create(cls, config: Config) -> AppState:
        db = Database(config.db_path)
        settings = load_settings(db.get_settings())
        embedder = Embedder(config.model, config.device, config.modalities)
        embedder.set_image_tokens(settings.image_tokens)
        state = cls(
            config=config,
            db=db,
            embedder=embedder,
            transcriber=Transcriber(config.device),
            index=VectorIndex(),
            settings=settings,
        )
        state.indexer = Indexer(state)
        return state

    def load_index(self) -> None:
        rows = self.db.query("SELECT id, kind, collection_id FROM files WHERE status = 'ok'")
        meta = {r["id"]: (KIND_CODES[r["kind"]], r["collection_id"]) for r in rows}
        for cids, fids, vecs, ckinds in self.db.iter_vectors():
            keep = [i for i, f in enumerate(fids) if int(f) in meta]
            if not keep:
                continue
            fids = fids[keep]
            self.index.add(
                cids[keep],
                fids,
                vecs[keep],
                [meta[int(f)][0] for f in fids],
                [meta[int(f)][1] for f in fids],
                chunk_bias([ckinds[i] for i in keep]),
            )
        log.info("向量索引已载入：%d 个分块", len(self.index))

    def update_settings(self, values: dict) -> Settings:
        merged = self.settings.model_copy(update=values)
        merged = Settings.model_validate(merged.model_dump())
        self.db.put_settings(merged.model_dump())
        watch_changed = merged.watch != self.settings.watch
        self.settings = merged
        self.embedder.set_image_tokens(merged.image_tokens)
        if watch_changed:
            self.indexer.collections_changed()
        return merged
