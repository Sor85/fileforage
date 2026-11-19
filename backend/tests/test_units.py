from pathlib import Path

import numpy as np
import pytest

from fileforage import extractors
from fileforage.vindex import KIND_CODES, VectorIndex, chunk_bias


def test_classify():
    assert extractors.classify(Path("a.JPG")) == ("image", "jpg")
    assert extractors.classify(Path("b.ts")) == ("text", "ts")
    assert extractors.classify(Path("c.mts")) == ("video", "mts")
    assert extractors.classify(Path("Dockerfile")) == ("text", "dockerfile")
    assert extractors.classify(Path("d.exe")) is None


def test_excludes():
    pats = ["node_modules", "*.min.js"]
    assert extractors.is_excluded("node_modules", pats, False)
    assert extractors.is_excluded("app.min.js", pats, False)
    assert extractors.is_excluded(".git", pats, False)
    assert not extractors.is_excluded(".config", [], True)
    assert extractors.is_excluded("~$doc.docx", [], True)


def test_read_text_file_encodings(tmp_path):
    text = '<?xml version="1.0"?>\n<config name="存档">\n  <item value="42"/>\n</config>\n'
    cases = {
        "utf16le.xml": text.encode("utf-16-le"),
        "utf16be.xml": text.encode("utf-16-be"),
        "utf16bom.xml": text.encode("utf-16"),
        "utf32bom.txt": text.encode("utf-32"),
        "utf8bom.txt": text.encode("utf-8-sig"),
        "odd.txt": text.encode("utf-16-le") + b"\x0a",  # 截断的末尾半个字符
    }
    for name, data in cases.items():
        p = tmp_path / name
        p.write_bytes(data)
        assert extractors.read_text_file(p) == text, name

    binary = tmp_path / "blob.txt"
    binary.write_bytes(bytes(range(256)) * 40)
    with pytest.raises(ValueError, match="二进制"):
        extractors.read_text_file(binary)
    zeros = tmp_path / "zeros.log"
    zeros.write_bytes(b"A\x00" * 100 + b"\x00\x00" * 200)
    with pytest.raises(ValueError, match="二进制"):
        extractors.read_text_file(zeros)


def test_split_text_overlap_and_limits():
    text = "\n".join(f"第{i}段。" + "内容" * 80 for i in range(30))
    chunks = extractors.split_text(text, size=500, overlap=50)
    assert len(chunks) > 5
    assert all(len(c) <= 600 for c in chunks)
    assert extractors.split_text("   ") == []
    assert extractors.split_text("短文本") == ["短文本"]


def test_vector_index_search_filter_remove():
    idx = VectorIndex(dim=4)
    idx.add(
        np.arange(4),
        np.array([1, 1, 2, 3]),
        np.eye(4, dtype=np.float32),
        np.array([KIND_CODES["text"]] * 2 + [KIND_CODES["image"]] * 2),
        np.array([10, 10, 10, 20]),
        chunk_bias(["text", "name", "image", "image"]),
    )
    hits = idx.search(np.array([0, 0, 1, 0], dtype=np.float32), top=2)
    assert hits.chunk_ids[0] == 2
    hits = idx.search(np.array([0, 0, 1, 0], dtype=np.float32), kinds=["text"])
    assert set(hits.file_ids.tolist()) == {1}
    hits = idx.search(np.array([0, 0, 0, 1], dtype=np.float32), collections=[10])
    assert 3 not in hits.file_ids.tolist()
    idx.remove_files({1})
    assert len(idx) == 2


def test_chunk_bias_favors_visual_and_penalizes_names():
    b = chunk_bias(["text", "image", "name"])
    assert b[1] > b[0] > b[2]
