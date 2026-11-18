"""仓库级约定守卫：滚动条、指针样式与 AGENTS.md 清单。"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WEB_SRC = REPO / "web" / "src"


def _sources():
    return [p for p in WEB_SRC.rglob("*") if p.suffix in {".ts", ".tsx", ".css"}]


def test_no_webkit_scrollbar_selectors():
    for p in _sources():
        assert "::-webkit-scrollbar" not in p.read_text(encoding="utf-8"), p


def test_scrollbar_color_declared_once():
    hits = [m for p in _sources() for m in re.finditer(r"scrollbar-color\s*:", p.read_text(encoding="utf-8"))]
    assert len(hits) == 1


def test_no_native_overflow_scroll_in_app_code():
    pat = re.compile(r"\boverflow(-[xy])?-(auto|scroll)\b")
    for p in _sources():
        if p.name == "scroll-area.tsx":
            continue
        assert not pat.search(p.read_text(encoding="utf-8")), p


def test_no_cursor_declarations():
    pat = re.compile(r"\bcursor-[a-z]|cursor\s*:")
    for p in _sources():
        assert not pat.search(p.read_text(encoding="utf-8")), p


def test_agents_index_is_complete():
    root = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    subs = [p for p in REPO.rglob("AGENTS.md") if p.parent != REPO and "node_modules" not in p.parts]
    for p in subs:
        rel = p.relative_to(REPO).as_posix()
        assert rel in root, f"{rel} 未登记在根 AGENTS.md"
    for rel in re.findall(r"`([\w./-]+/AGENTS\.md)`", root):
        assert (REPO / rel).is_file(), f"{rel} 不存在"
