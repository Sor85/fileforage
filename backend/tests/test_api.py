import time


def wait_idle(client, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        s = client.get("/api/status").json()
        if s["indexer"]["phase"] == "idle" and not s["indexer"]["queued"]:
            return s
        time.sleep(0.2)
    raise AssertionError("索引未在时限内完成")


def test_index_search_and_files(client, library):
    r = client.post("/api/collections", json={"path": str(library)})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    # 添加后不自动索引，需显式开始
    assert r.json()["enabled"] is False
    assert client.post(f"/api/collections/{cid}/scan").status_code == 409
    assert client.post(f"/api/collections/{cid}/start").json()["enabled"] is True
    time.sleep(0.3)
    s = wait_idle(client)
    # 隐藏文件、空文件、node_modules 均被跳过
    assert s["stats"]["indexed"] == 2

    res = client.get("/api/search", params={"q": "猫"}).json()["results"]
    assert res and res[0]["file"]["name"] == "cat.md"
    assert res[0]["match"]["kind"] in ("text", "name")

    fid = res[0]["file"]["id"]
    detail = client.get(f"/api/files/{fid}").json()
    assert "晒太阳" in detail["content"]
    raw = client.get(f"/api/files/{fid}/raw", headers={"Range": "bytes=0-3"})
    assert raw.status_code == 206

    # 与已有目录重叠的目录被拒绝
    assert client.post("/api/collections", json={"path": str(library / "notes")}).status_code == 409

    # 删除文件后重新扫描，索引同步移除
    (library / "notes" / "fib.py").unlink()
    client.post(f"/api/collections/{cid}/scan")
    time.sleep(0.3)
    assert wait_idle(client)["stats"]["indexed"] == 1

    assert client.delete(f"/api/collections/{cid}").status_code == 200
    assert client.get("/api/search", params={"q": "猫"}).json()["results"] == []


def test_excluded_kinds(client, library):
    cid = client.post("/api/collections", json={"path": str(library)}).json()["id"]
    r = client.patch(f"/api/collections/{cid}", json={"excluded_kinds": ["text"]})
    assert r.json()["excluded_kinds"] == ["text"]
    client.post(f"/api/collections/{cid}/start")
    time.sleep(0.3)
    assert wait_idle(client)["stats"]["indexed"] == 0

    # 取消排除后自动按新范围重新扫描
    client.patch(f"/api/collections/{cid}", json={"excluded_kinds": []})
    time.sleep(0.3)
    assert wait_idle(client)["stats"]["indexed"] == 2

    # 重新排除时移除已索引的同类文件
    client.patch(f"/api/collections/{cid}", json={"excluded_kinds": ["text"]})
    time.sleep(0.3)
    assert wait_idle(client)["stats"]["indexed"] == 0

    all_kinds = ["text", "document", "image", "video", "audio"]
    assert client.patch(f"/api/collections/{cid}", json={"excluded_kinds": all_kinds}).status_code == 422
    assert client.patch(f"/api/collections/{cid}", json={"excluded_kinds": ["exe"]}).status_code == 422


def test_fs_listing_is_confined_to_roots(client, tmp_path):
    roots = client.get("/api/fs").json()
    assert roots["entries"][0]["path"] == str(tmp_path.resolve())
    assert client.get("/api/fs", params={"path": "/"}).status_code == 400


def test_settings_roundtrip(client):
    r = client.put("/api/settings", json={"min_score": 0.5, "excludes": ["*.tmp"]})
    assert r.status_code == 200
    assert r.json()["values"]["min_score"] == 0.5
    assert client.put("/api/settings", json={"video_segment_seconds": 1}).status_code == 422
