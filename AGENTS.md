# FileForage

本地多模态语义文件搜索：把选定目录中的文档、图片、视频、音频用 EmbeddingGemma 2 编码到同一个 768 维向量空间，用自然语言或图片检索。后端 FastAPI（`backend/`），前端 React + Tailwind + shadcn（`web/`），Docker 镜像由 GitHub Actions 发布到 GHCR。

## 子目录说明清单

改动、审查或排查某目录前，先读该目录的 AGENTS.md（从外到内逐层读）。

- `backend/AGENTS.md`：Python 后端（索引、嵌入、检索、API）的约定
- `web/AGENTS.md`：WebUI 的组件、滚动条、模态窗口与视觉约定

## 命令与验证

```bash
# 后端（Python 3.12，uv）
cd backend && uv venv -p 3.12 && uv pip install -e . pytest httpx ruff
.venv/bin/ruff check fileforage tests && .venv/bin/pytest -q
FF_DATA_DIR=./data FF_ROOTS=$HOME .venv/bin/python -m fileforage   # 默认端口 8730

# 前端
cd web && pnpm install && pnpm build    # 产物 web/dist 由后端直接托管
pnpm dev                                # 开发服务器 5173，/api 代理到 8730
```

每次改动后至少运行后端测试与 `pnpm build`。`backend/tests/test_repo_guards.py` 守住前端滚动条、指针样式与本清单的完整性。

## 数据安全

- 服务只读用户文件；所有写入都在 `FF_DATA_DIR`（SQLite 索引库 + 缩略图），扫描时会跳过数据目录本身。
- `/api/files/{id}/raw` 只按已索引的文件 id 提供内容，`/api/fs` 只能浏览 `FF_ROOTS` 之内的目录。
- 服务没有鉴权，只应部署在可信局域网内。

## 跨领域术语

- **目录（collection）**：用户添加的一个根目录，目录之间不允许嵌套重叠。
- **分块（chunk）**：一个向量及其来源。种类：`name` 文件名、`text` 文本片段、`page` 扫描版 PDF 页面图像、`image`、`audio` 音频段、`video` 音画段、`transcript` 语音转写段。
- **文件种类（kind）**：`text` / `document` / `image` / `video` / `audio`；前端“文档”筛选同时包含 text 与 document。
