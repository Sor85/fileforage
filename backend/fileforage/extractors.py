"""文件分类与文本类内容提取（纯文本、代码、PDF、Word、PowerPoint）。"""

from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

TEXT_EXT = {
    # 文本 / 标记
    "txt", "md", "markdown", "mdx", "rst", "org", "tex", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml",
    "toml", "ini", "cfg", "conf", "xml", "html", "htm", "srt", "vtt", "ass", "adoc", "textile", "wiki",
    # 代码
    "py", "pyi", "ipynb", "js", "mjs", "cjs", "jsx", "ts", "tsx", "vue", "svelte", "astro", "java", "kt", "kts",
    "scala", "groovy", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "fs", "vb", "rb", "php",
    "swift", "m", "mm", "dart", "lua", "r", "jl", "pl", "pm", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
    "sql", "graphql", "gql", "proto", "css", "scss", "sass", "less", "styl", "zig", "nim", "ex", "exs", "erl",
    "hs", "ml", "clj", "elm", "sol", "tf", "hcl", "nix", "cmake", "gradle", "dockerfile", "makefile",
}  # fmt: skip
DOC_EXT = {"pdf", "docx", "pptx"}
IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif", "avif"}
AUDIO_EXT = {"mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr"}
VIDEO_EXT = {
    "mp4",
    "mov",
    "mkv",
    "webm",
    "avi",
    "m4v",
    "wmv",
    "flv",
    "3gp",
    "mts",
    "m2ts",
    "mpg",
    "mpeg",
    "ogv",
}
# 设置页“常用排除项”：按扩展名整组跳过，键存于 Settings.exclude_presets
EXCLUDE_PRESETS: dict[str, tuple[str, set[str]]] = {
    "code": ("代码", {
        "py", "pyi", "ipynb", "js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "kt", "kts", "scala", "groovy",
        "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "fs", "vb", "rb", "php", "swift", "m", "mm",
        "dart", "lua", "r", "jl", "pl", "pm", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "graphql",
        "gql", "proto", "zig", "nim", "ex", "exs", "erl", "hs", "ml", "clj", "elm", "sol", "tf", "hcl", "nix",
        "cmake", "gradle", "dockerfile", "makefile",
    }),
    "web": ("网页与样式", {"html", "htm", "css", "scss", "sass", "less", "styl", "vue", "svelte", "astro"}),
    "data": ("配置与数据", {
        "xml", "json", "jsonl", "yaml", "yml", "toml", "ini", "cfg", "conf", "csv", "tsv",
    }),
    "log": ("日志", {"log"}),
}  # fmt: skip


def preset_exts(keys: list[str]) -> set[str]:
    return set().union(*(EXCLUDE_PRESETS[k][1] for k in keys if k in EXCLUDE_PRESETS))


SPECIAL_NAMES = {"dockerfile": "dockerfile", "makefile": "makefile", "readme": "txt", "license": "txt"}

CHUNK_CHARS = 1000
CHUNK_OVERLAP = 120
MAX_CHUNKS = 400
MAX_RENDERED_PAGES = 30


def classify(path: Path) -> tuple[str, str] | None:
    """返回 (kind, ext)；不支持的文件返回 None。"""
    ext = path.suffix.lower().lstrip(".")
    if not ext:
        ext = SPECIAL_NAMES.get(path.name.lower(), "")
    if ext in IMAGE_EXT:
        return "image", ext
    if ext in VIDEO_EXT:
        return "video", ext
    if ext in AUDIO_EXT:
        return "audio", ext
    if ext in DOC_EXT:
        return "document", ext
    if ext in TEXT_EXT:
        return "text", ext
    return None


def is_excluded(name: str, patterns: list[str], include_hidden: bool) -> bool:
    if not include_hidden and name.startswith("."):
        return True
    if name in (".DS_Store", "Thumbs.db", "desktop.ini") or name.startswith(("~$", "._")):
        return True
    return any(fnmatch.fnmatch(name, p) for p in patterns)


@dataclass
class TextExtraction:
    chunks: list[dict[str, Any]] = field(default_factory=list)  # {text, start}
    pages: list[tuple[int, Image.Image]] = field(default_factory=list)  # 需按图像编码的扫描页
    thumb: Image.Image | None = None
    meta: dict[str, Any] = field(default_factory=dict)


def read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    if b"\x00" in raw[:8192]:
        raise ValueError("二进制文件")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        from charset_normalizer import from_bytes

        best = from_bytes(raw).best()
        if best is None:
            raise ValueError("无法识别文本编码") from None
        return str(best)


_HTML_TAG = re.compile(r"<(script|style)[^>]*>.*?</\1>|<[^>]+>", re.DOTALL | re.IGNORECASE)
_SPACES = re.compile(r"[ \t　]+")
_BLANKS = re.compile(r"\n{3,}")


def normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _SPACES.sub(" ", text)
    return _BLANKS.sub("\n\n", text).strip()


def split_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """按段落聚合到约 size 字，超长段落硬切，相邻块保留 overlap 字重叠。"""
    text = normalize(text)
    if not text:
        return []
    if len(text) <= size:
        return [text]
    paras: list[str] = []
    for p in text.split("\n"):
        while len(p) > size:
            cut = max(p.rfind(sep, 0, size) for sep in ("。", ". ", "！", "？", "; ", "，", ", ", " "))
            cut = cut + 1 if cut > size // 2 else size
            paras.append(p[:cut])
            p = p[cut:]
        paras.append(p)
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if buf and len(buf) + len(p) + 1 > size:
            chunks.append(buf.strip())
            tail = buf[-overlap:]
            buf = tail[tail.find(" ") + 1 :] if " " in tail else tail
        buf = f"{buf}\n{p}" if buf else p
    if buf.strip():
        chunks.append(buf.strip())
    return [c for c in chunks if c][:MAX_CHUNKS]


def extract_text(path: Path, ext: str) -> TextExtraction:
    out = TextExtraction()
    if ext == "pdf":
        return _extract_pdf(path)
    if ext == "docx":
        text = _docx_text(path)
    elif ext == "pptx":
        return _extract_pptx(path)
    elif ext == "ipynb":
        text = _notebook_text(path)
    else:
        text = read_text_file(path)
        if ext in ("html", "htm", "xml"):
            text = _HTML_TAG.sub(" ", text)
    out.chunks = [{"text": c} for c in split_text(text)]
    out.meta["chars"] = len(text)
    return out


def _docx_text(path: Path) -> str:
    import docx

    d = docx.Document(str(path))
    parts = [p.text for p in d.paragraphs]
    for table in d.tables:
        for row in table.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(parts)


def _notebook_text(path: Path) -> str:
    import json

    nb = json.loads(read_text_file(path))
    cells = nb.get("cells", [])
    return "\n\n".join("".join(c.get("source", [])) for c in cells)


def _extract_pptx(path: Path) -> TextExtraction:
    from pptx import Presentation

    out = TextExtraction()
    prs = Presentation(str(path))
    total = 0
    for i, slide in enumerate(prs.slides, start=1):
        texts = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                texts.append(shape.text_frame.text)
        body = normalize("\n".join(texts))
        total += len(body)
        for c in split_text(body):
            out.chunks.append({"text": c, "start": i})
    out.meta.update(pages=len(prs.slides), chars=total)
    out.chunks = out.chunks[:MAX_CHUNKS]
    return out


def _extract_pdf(path: Path) -> TextExtraction:
    import pypdfium2 as pdfium

    out = TextExtraction()
    pdf = pdfium.PdfDocument(str(path))
    try:
        n = len(pdf)
        out.meta["pages"] = n
        total = 0
        for i in range(n):
            page = pdf[i]
            try:
                tp = page.get_textpage()
                text = normalize(tp.get_text_bounded() or "")
                tp.close()
                total += len(text)
                if len(text) >= 40:
                    for c in split_text(text):
                        out.chunks.append({"text": c, "start": i + 1})
                elif len(out.pages) < MAX_RENDERED_PAGES:
                    out.pages.append((i + 1, _render_page(page)))
                if i == 0:
                    out.thumb = out.pages[0][1] if out.pages else _render_page(page, 640)
            finally:
                page.close()
            if len(out.chunks) >= MAX_CHUNKS:
                break
        out.meta["chars"] = total
    finally:
        pdf.close()
    out.chunks = out.chunks[:MAX_CHUNKS]
    return out


def _render_page(page: Any, width: int = 1024) -> Image.Image:
    w = page.get_width() or 612
    bitmap = page.render(scale=max(0.5, min(3.0, width / w)))
    return bitmap.to_pil().convert("RGB")
