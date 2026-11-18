"""命令行入口：python -m fileforage"""

from __future__ import annotations

import logging


def main() -> None:
    import uvicorn

    from .config import load_config

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    uvicorn.run("fileforage.main:app", host=cfg.host, port=cfg.port, log_level="info", proxy_headers=True)


if __name__ == "__main__":
    main()
