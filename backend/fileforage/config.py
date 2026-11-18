"""运行配置：全部来自环境变量，启动后不可变。可在 WebUI 中调整的选项见 settings.py。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def _env_list(name: str, default: str) -> list[str]:
    raw = _env(name, default)
    return [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]


@dataclass(frozen=True)
class Config:
    data_dir: Path
    roots: list[Path]
    model: str
    device: str
    host: str
    port: int
    web_dir: Path | None
    modalities: frozenset[str] = field(default_factory=frozenset)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "fileforage.db"

    @property
    def thumb_dir(self) -> Path:
        return self.data_dir / "thumbs"


def load_config() -> Config:
    data_dir = Path(_env("FF_DATA_DIR", str(Path.cwd() / "data"))).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "thumbs").mkdir(exist_ok=True)

    roots = [Path(p).expanduser().resolve() for p in _env_list("FF_ROOTS", str(Path.home()))]

    web_dir_env = _env("FF_WEB_DIR", "")
    if web_dir_env:
        web_dir: Path | None = Path(web_dir_env).resolve()
    else:
        guess = Path(__file__).resolve().parents[2] / "web" / "dist"
        web_dir = guess if guess.is_dir() else None

    return Config(
        data_dir=data_dir,
        roots=roots,
        model=_env("FF_MODEL", "google/embeddinggemma-2"),
        device=_env("FF_DEVICE", "auto"),
        host=_env("FF_HOST", "0.0.0.0"),
        port=int(_env("FF_PORT", "8730")),
        web_dir=web_dir,
        modalities=frozenset(_env_list("FF_MODALITIES", "text,image,audio,video")),
    )
