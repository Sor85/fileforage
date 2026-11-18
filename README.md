# FileForage

本地多模态语义文件搜索。选择目录后，FileForage 把其中的文档、图片、视频和音频向量化到同一个语义空间，然后用一句话或一张图片检索。模型、索引和文件都留在你自己的机器上。

- **一个模型覆盖四种模态**：[EmbeddingGemma 2](https://huggingface.co/google/embeddinggemma-2)（Google DeepMind，740M，Apache 2.0）把文本、图片、视频、音频编码到同一个 768 维空间，中文查询可以直接命中照片、视频片段和录音。
- **语音可按台词检索**：[faster-whisper](https://github.com/SYSTRAN/faster-whisper) 把音视频里的语音转成带时间戳的文字，检索结果直接跳到对应时刻。
- **定位到片段**：视频按段（默认 20 秒）把画面和声音合并编码，PDF 按页，长文本按段落。命中后会显示具体时间点或页码。
- **以图搜图、查找相似**：可以拖入、粘贴或选择一张图片来检索，也可以从任意文件出发查找内容相近的文件，结果跨模态。
- **增量索引**：自动监听目录变化，只重新处理新增或修改的文件。
- **WebUI**：浅色和深色主题，瀑布流结果，层叠式文件预览窗口，适配手机。

## 支持的文件

| 类型 | 格式 | 处理方式 |
| --- | --- | --- |
| 文本 / 代码 | txt、md、csv、json、html、srt 及 70 多种代码文件 | 按段落切块后编码 |
| 文档 | pdf、docx、pptx | 有文本层的页面抽取文字；扫描页渲染成图像编码 |
| 图片 | jpg、png、webp、gif、heic、avif、tiff 等 | 直接编码图像，并生成缩略图 |
| 视频 | mp4、mov、mkv、webm、avi 等 | 按段抽帧，与同段音轨一起编码；另做语音转写 |
| 音频 | mp3、m4a、wav、flac、ogg、opus 等 | 按段编码声音内容；另做语音转写 |

默认跳过隐藏文件、`node_modules`、`.git`、构建产物、锁文件和小图标。排除规则可以在设置页修改。

## 部署（Docker）

镜像由 GitHub Actions 构建，发布在 GitHub Packages：

| 标签 | 架构 | 说明 |
| --- | --- | --- |
| `ghcr.io/sor85/fileforage:latest` | linux/amd64、linux/arm64 | CPU 推理 |
| `ghcr.io/sor85/fileforage:latest-cuda` | linux/amd64 | NVIDIA GPU，需要安装 nvidia-container-toolkit |

```bash
mkdir fileforage && cd fileforage
curl -O https://raw.githubusercontent.com/sor85/fileforage/main/docker-compose.yml
# 编辑 docker-compose.yml，把要检索的目录挂载到 /media 下
docker compose up -d
```

打开 `http://<服务器 IP>:8730`，在“资料库”里添加 `/media` 下的目录。首次启动会把模型下载到 `./models`，EmbeddingGemma 2 约 1.5 GB，Whisper small 约 0.5 GB。国内网络可以设置 `HF_ENDPOINT=https://hf-mirror.com`。

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FF_ROOTS` | 容器内 `/media`，本地运行时为用户主目录 | WebUI 可以浏览和添加的根目录，多个用逗号分隔 |
| `FF_DATA_DIR` | 容器内 `/data` | 索引数据库和缩略图的存放位置 |
| `FF_MODEL` | `google/embeddinggemma-2` | 嵌入模型 |
| `FF_DEVICE` | `auto` | `auto` / `cpu` / `cuda` / `mps` |
| `FF_MODALITIES` | `text,image,audio,video` | 去掉不需要的模态可少加载对应编码器：纯文本 270M，文本加图片 440M |
| `FF_PORT` | `8730` | 服务端口 |
| `HF_HOME` | 容器内 `/models` | 模型缓存目录 |

### 性能参考

Apple M4（MPS）：每张图片约 0.7 秒，一段 20 秒的视频约 2.5 秒，每段文本约 0.1 秒，一次查询约 40 毫秒。纯 CPU 大约慢 2 到 3 倍。处理顺序是先文本后媒体，所以索引过程中就能开始检索。

## 本地开发

```bash
# 后端（需要 ffmpeg）
cd backend
uv venv -p 3.12 && uv pip install -e . pytest httpx ruff
.venv/bin/pytest -q
FF_DATA_DIR=./data FF_ROOTS=$HOME .venv/bin/python -m fileforage

# 前端
cd web
pnpm install
pnpm dev      # http://localhost:5173，/api 代理到 8730
pnpm build    # 构建产物 web/dist 由后端直接托管
```

## 工作原理

```
目录扫描 ──► 提取 ──────────────────────────► EmbeddingGemma 2 ──► SQLite（分块 + 向量）
            ├ 文本：段落切块                        │                      │
            ├ PDF：文字页 / 扫描页图像               │                启动时载入内存矩阵
            ├ 图片：原图                            │                      │
            ├ 视频：ffmpeg 抽帧 + 同段音轨 ──────────┤                      ▼
            └ 音频：分段 + Whisper 转写 ─────────────┘   查询向量 ──► 余弦相似度 ──► 按文件聚合 ──► 结果
```

- 检索用暴力矩阵乘法，在个人文件规模（几十万个分块）下是毫秒级，不需要额外的向量数据库。
- 文本查询与图像的相似度天然低于文本与文本，所以检索时会按分块类型做小幅补偿，让各模态排序公平。
- 每个文件额外生成一个文件名向量，因此按文件名描述也能找到文件。

## 安全提示

服务没有登录鉴权，任何能访问端口的人都可以检索并下载已索引的文件。请只在可信的局域网内部署，或者放在带鉴权的反向代理之后。媒体目录建议以只读方式（`:ro`）挂载。

## 许可证

[MIT](LICENSE)。EmbeddingGemma 2 模型权重使用 Apache 2.0 许可，使用时需遵守 [Gemma 禁止用途政策](https://ai.google.dev/gemma/prohibited_use_policy)。
