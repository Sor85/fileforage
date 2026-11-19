# backend 约定

适用范围：`backend/` 下的 Python 代码与测试。同时遵守根目录 `AGENTS.md`。前端相关约定见 `web/AGENTS.md`。

## 模型

- 嵌入模型固定为 EmbeddingGemma 2（`FF_MODEL`），所有模态共享一个空间；查询加 `task: search result | query: ` 前缀，文档写成 `title: {标题} | text: {内容}`，媒体输入不加前缀（`embedder.py`）。
- 只用 float32 或 bfloat16，float16 会输出 NaN；`Embedder._encode` 会检查非有限值。
- 视频不交给 transformers 解码（torchcodec 在部分文件上失败），由 `media.decode_frames` 用 ffmpeg 抽帧后以 `(N,H,W,3)` 数组传入，同段音轨用 `<|video|><|audio|>` 交错编码成一个向量；单段最多 32 帧。
- 推理串行，`_PriorityLock` 让检索查询优先于索引任务；索引按小批次调用以便让出。

## 检索打分

- 余弦相似度在不同模态间不可直接比较：`vindex.CHUNK_BIAS` 给图像 / 视频 / 页面分块加分、给文件名分块减分，只对文本查询生效。
- `search.py` 的 `SCORE_FLOOR/SCORE_CEIL`（文本查询）与 `MEDIA_FLOOR/MEDIA_CEIL`（以图搜图、查找相似）把分数映射为前端显示的相关度；`TOP_WINDOW` 截掉与最佳结果差距过大的尾部。调整这些常量前用真实样本跑一遍中文查询对比。
- Whisper 在无人声音频上会产生幻觉文本，`transcriber.py` 按语种置信度、`avg_logprob`、`no_speech_prob` 过滤，不要放宽。

## 索引

- 增量依据为 (size, mtime)；失败的文件只在变化后自动重试，解析逻辑修复后由用户通过 `/retry` 手动重试（失败文件弹窗中的按钮）。新增目录不得与已有目录嵌套（`files.path` 唯一）。
- `extractors.read_text_file` 先按 BOM、再按 00 字节的奇偶分布识别 UTF-16/32，之后才判定二进制：无 BOM 的 UTF-16 文本里 ASCII 字符本身就带 00。
- 新增目录默认 `enabled=0`：不扫描、不监听，等用户在卡片上设好排除的文件种类（`excluded_kinds`）后调用 `/start` 才开始索引；迁移前已有的目录视为已启用。
- 被排除种类的文件在扫描时不计入，已索引的同类文件按“已删除”移除；修改已启用目录的排除范围会立即重新扫描。
- 全局排除有两层：`Settings.excludes`（文件名/目录名通配）与 `Settings.exclude_presets`（`extractors.EXCLUDE_PRESETS` 中按扩展名整组排除）。这两项或 `include_hidden` 变化后对所有已启用目录重新扫描（`AppState.update_settings`）。
- 取消目录索引（`/stop`）把目录设回 `enabled=0` 并保留已索引结果；取消正在运行的目录会同时解除全局暂停，避免下一个目录卡在暂停中。暂停只在内存中，服务重启后恢复运行。
- 处理顺序为文本 → 文档 → 图片 → 音频 → 视频，让结果尽早可搜。
- 每个文件都额外生成一个 `name` 分块，用于按文件名检索。

## 测试

- `tests/conftest.py` 用 `FakeEmbedder` 替换真实模型，API 测试不下载权重；需要真实模型的验证手动进行。
