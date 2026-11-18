import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconLoader2,
  IconPlayerPlayFilled,
  IconSparkles,
} from "@tabler/icons-react"

import { FileGlyph, isCode, KIND_LABEL } from "@/components/kind"
import { ResultsGrid } from "@/components/search/results-grid"
import { Highlight } from "@/components/search/highlight"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { AudioPlayer, type MediaHandle } from "@/components/viewer/audio-player"
import { api, fileUrl, type Chunk, type FileDetail } from "@/lib/api"
import { formatBytes, formatDate, formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useViewerLayers, viewer, type ViewerLayer } from "@/lib/viewer"

export function ViewerHost() {
  const layers = useViewerLayers()
  return (
    <>
      {layers.map((l) =>
        l.type === "file" ? <FileModal key={l.key} layer={l} /> : <SimilarModal key={l.key} layer={l} />
      )}
    </>
  )
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 非安全上下文（局域网 http）没有 clipboard API，退回 execCommand
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    document.execCommand("copy")
    ta.remove()
  }
  toast.success("已复制路径")
}

function FileModal({ layer }: { layer: Extract<ViewerLayer, { type: "file" }> }) {
  const { data: file, isError, error } = useQuery({
    queryKey: ["file", layer.fileId],
    queryFn: () => api.file(layer.fileId),
  })

  return (
    <Modal
      open={!layer.closing}
      onOpenChange={(o) => !o && viewer.close(layer.key)}
      size="xl"
      closeLabel={`关闭文件详情${file ? `：${file.name}` : ""}`}
      icon={file ? <FileGlyph file={file} size="md" /> : <Skeleton className="size-9 rounded-[10px]" />}
      title={file?.name ?? "正在加载"}
      description={file ? (file.collection ? `${file.collection.name} / ${file.rel_path}` : file.rel_path) : " "}
      footer={
        file && (
          <>
            <Button
              variant="outline"
              className="mr-auto"
              onClick={() => viewer.open({ type: "similar", fileId: file.id, fileName: file.name })}
            >
              <IconSparkles className="size-4 text-brand" />
              查找相似
            </Button>
            <Button variant="ghost" onClick={() => copy(file.path)}>
              <IconCopy className="size-4" />
              复制路径
            </Button>
            <Button variant="ghost" asChild>
              <a href={fileUrl.raw(file.id)} target="_blank" rel="noreferrer">
                <IconExternalLink className="size-4" />
                <span className="sm:hidden">打开</span>
                <span className="hidden sm:inline">新标签页打开</span>
              </a>
            </Button>
            <Button asChild>
              <a href={fileUrl.download(file.id)}>
                <IconDownload className="size-4" />
                下载
              </a>
            </Button>
          </>
        )
      }
    >
      {isError ? (
        <p className="py-10 text-center text-muted-foreground">{(error as Error).message}</p>
      ) : !file ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Skeleton className="h-[52vh] rounded-2xl" />
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        </div>
      ) : (
        <FileBody file={file} focus={layer.focus ?? null} query={layer.query ?? null} />
      )}
    </Modal>
  )
}

function FileBody({ file, focus, query }: { file: FileDetail; focus: Chunk | null; query: string | null }) {
  const media = React.useRef<MediaHandle>(null)
  const [now, setNow] = React.useState(focus?.start ?? 0)
  const timed = file.chunks.filter((c) => c.kind === "transcript")
  const segments = file.chunks.filter((c) => c.kind === "video" && c.has_thumb)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4">
        {file.kind === "image" && <ImagePreview file={file} />}
        {file.kind === "video" && (
          <VideoPreview ref={media} file={file} startAt={focus?.start ?? null} onTime={setNow} />
        )}
        {file.kind === "audio" && (
          <AudioPlayer
            ref={media}
            src={fileUrl.raw(file.id)}
            seed={file.id}
            duration={file.meta.duration}
            startAt={focus?.start ?? null}
            onTime={setNow}
          />
        )}
        {file.kind === "text" && <TextPreview file={file} focus={focus} query={query} />}
        {file.kind === "document" && <DocumentPreview file={file} focus={focus} query={query} />}

        {segments.length > 1 && (
          <section>
            <SectionTitle>片段</SectionTitle>
            <ScrollArea horizontal className="-mx-1 rounded-xl">
              <div className="flex gap-2 px-1 pb-3">
                {segments.map((c) => {
                  const on = c.start != null && now >= c.start && now < (c.end ?? Infinity)
                  const hit = focus?.id === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => media.current?.seek(c.start ?? 0)}
                      className={cn(
                        "group relative w-36 shrink-0 overflow-hidden rounded-xl border-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                        on ? "border-brand" : hit ? "border-brand/40" : "border-transparent"
                      )}
                    >
                      <img src={fileUrl.chunkThumb(file.id, c)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
                      <span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 text-[10.5px] font-medium text-white tabular-nums">
                        {formatDuration(c.start)}
                      </span>
                      {hit && (
                        <span className="absolute top-1 right-1 rounded-md bg-brand px-1.5 text-[10px] font-medium text-white">
                          匹配
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </ScrollArea>
          </section>
        )}

        {timed.length > 0 && (
          <section>
            <SectionTitle>语音转写</SectionTitle>
            <div className="space-y-1">
              {timed.map((c) => {
                const on = c.start != null && now >= c.start && now < (c.end ?? Infinity) + 0.3
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => media.current?.seek(c.start ?? 0)}
                    className={cn(
                      "flex w-full gap-3 rounded-xl px-3 py-2 text-left text-[13px] leading-relaxed transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40",
                      on && "bg-brand/8 hover:bg-brand/10",
                      focus?.id === c.id && !on && "ring-1 ring-brand/30"
                    )}
                  >
                    <span className="mt-px flex shrink-0 items-center gap-1 font-mono text-[11.5px] text-muted-foreground tabular-nums">
                      <IconPlayerPlayFilled className={cn("size-2.5", on ? "text-brand" : "opacity-40")} />
                      {formatDuration(c.start)}
                    </span>
                    <Highlight text={c.text ?? ""} query={query} />
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-0 lg:self-start">
        {focus && focus.kind !== "name" && (focus.text || focus.start != null) && <MatchCard file={file} focus={focus} query={query} onSeek={(t) => media.current?.seek(t)} />}
        <section>
          <SectionTitle>信息</SectionTitle>
          <dl className="space-y-2 text-[12.5px]">
            <Meta label="类型">
              {KIND_LABEL[file.kind]} · <span className="uppercase">{file.ext}</span>
            </Meta>
            <Meta label="大小">{formatBytes(file.size)}</Meta>
            {file.meta.width && file.meta.height && (
              <Meta label="尺寸">
                {file.meta.width} × {file.meta.height}
              </Meta>
            )}
            {file.meta.duration != null && <Meta label="时长">{formatDuration(file.meta.duration)}</Meta>}
            {file.meta.pages != null && <Meta label="页数">{file.meta.pages}</Meta>}
            <Meta label="修改时间">{formatDate(file.mtime)}</Meta>
            {file.collection && <Meta label="所在目录">{file.collection.name}</Meta>}
            <Meta label="向量分块">{file.chunks.length + 1}</Meta>
          </dl>
        </section>
        <section>
          <SectionTitle>路径</SectionTitle>
          <button
            type="button"
            onClick={() => copy(file.path)}
            className="w-full rounded-xl bg-muted/70 px-3 py-2.5 text-left font-mono text-[11.5px] leading-relaxed break-all text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            title="点击复制"
          >
            {file.path}
          </button>
        </section>
      </aside>
    </div>
  )
}

const CHUNK_LABEL: Record<string, string> = {
  text: "文本片段",
  page: "页面画面",
  image: "图像内容",
  video: "视频画面与声音",
  audio: "音频内容",
  transcript: "语音转写",
}

function MatchCard({
  file,
  focus,
  query,
  onSeek,
}: {
  file: FileDetail
  focus: Chunk
  query: string | null
  onSeek: (t: number) => void
}) {
  const timed = file.kind === "video" || file.kind === "audio"
  return (
    <section className="rounded-2xl border bg-linear-to-br from-brand/7 to-brand-2/5 p-3.5">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-brand">
        <IconSparkles className="size-3.5" />
        最佳匹配 · {CHUNK_LABEL[focus.kind] ?? focus.kind}
      </p>
      {focus.start != null && (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          {timed ? (
            <button type="button" className="font-medium text-foreground underline-offset-4 hover:underline" onClick={() => onSeek(focus.start ?? 0)}>
              {formatDuration(focus.start)}
              {focus.end != null && ` – ${formatDuration(focus.end)}`}
            </button>
          ) : (
            <>第 {focus.start} 页</>
          )}
        </p>
      )}
      {focus.text && (
        <p className="mt-2 line-clamp-6 text-[12.5px] leading-relaxed text-foreground/85">
          <Highlight text={focus.text} query={query} />
        </p>
      )}
    </section>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[11.5px] font-medium tracking-wide text-muted-foreground">{children}</h3>
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

function ImagePreview({ file }: { file: FileDetail }) {
  const [loaded, setLoaded] = React.useState(false)
  return (
    <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl bg-muted/60">
      {!loaded && <img src={fileUrl.thumb(file.id)} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-2xl" />}
      <img
        src={fileUrl.raw(file.id)}
        alt={file.name}
        onLoad={() => setLoaded(true)}
        className={cn("relative max-h-[64vh] w-auto max-w-full object-contain transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
      />
    </div>
  )
}

const VideoPreview = React.forwardRef<
  MediaHandle,
  { file: FileDetail; startAt: number | null; onTime: (t: number) => void }
>(function VideoPreview({ file, startAt, onTime }, ref) {
  const v = React.useRef<HTMLVideoElement>(null)
  React.useImperativeHandle(ref, () => ({
    seek: (t, play = true) => {
      if (!v.current) return
      v.current.currentTime = t
      if (play) void v.current.play()
    },
  }))
  return (
    <div className="overflow-hidden rounded-2xl bg-black">
      <video
        ref={v}
        src={fileUrl.raw(file.id)}
        poster={fileUrl.thumb(file.id)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          if (startAt) e.currentTarget.currentTime = startAt
        }}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        className="max-h-[62vh] w-full"
      />
    </div>
  )
})

function TextPreview({ file, focus, query }: { file: FileDetail; focus: Chunk | null; query: string | null }) {
  const markRef = React.useRef<HTMLElement>(null)
  const content = file.content ?? file.chunks.map((c) => c.text).join("\n\n")
  const code = isCode(file.ext)

  // 在原文中定位最佳匹配的片段
  const range = React.useMemo(() => {
    const t = focus?.kind === "text" ? focus.text?.trim() : null
    if (!t) return null
    const head = t.slice(0, 48)
    let i = content.indexOf(head)
    if (i < 0) i = content.replace(/[ \t]+/g, " ").indexOf(head)
    if (i < 0) return null
    return [i, Math.min(content.length, i + t.length)] as const
  }, [content, focus])

  React.useEffect(() => {
    const t = window.setTimeout(() => markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 520)
    return () => window.clearTimeout(t)
  }, [range])

  const body = range ? (
    <>
      <Highlight text={content.slice(0, range[0])} query={query} />
      <mark ref={markRef} className="rounded-md bg-brand/12 px-0.5 py-0.5 text-inherit ring-1 ring-brand/25 [box-decoration-break:clone]">
        <Highlight text={content.slice(range[0], range[1])} query={query} />
      </mark>
      <Highlight text={content.slice(range[1])} query={query} />
    </>
  ) : (
    <Highlight text={content} query={query} />
  )

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card px-5 py-4 text-[13.5px] leading-[1.8] break-words whitespace-pre-wrap",
        code && "bg-muted/40 font-mono text-[12.5px] leading-[1.7]"
      )}
    >
      {body}
      {file.truncated && <p className="mt-4 text-[12px] text-muted-foreground">内容较长，仅显示前 400 KB。</p>}
    </div>
  )
}

function DocumentPreview({ file, focus, query }: { file: FileDetail; focus: Chunk | null; query: string | null }) {
  if (file.ext === "pdf") {
    const page = focus?.start ? `#page=${focus.start}` : ""
    return (
      <iframe
        title={file.name}
        src={`${fileUrl.raw(file.id)}${page}`}
        className="h-[68vh] w-full rounded-2xl border bg-muted"
      />
    )
  }
  const unit = file.ext === "pptx" ? "幻灯片" : "段"
  return (
    <div className="space-y-2">
      {file.chunks
        .filter((c) => c.kind === "text")
        .map((c) => (
          <div
            key={c.id}
            className={cn(
              "rounded-xl border bg-card px-4 py-3 text-[13px] leading-[1.75] whitespace-pre-wrap",
              focus?.id === c.id && "border-brand/40 bg-brand/5"
            )}
          >
            {c.start != null && (
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                第 {c.start} {unit === "段" ? "页" : "张幻灯片"}
              </p>
            )}
            <Highlight text={c.text ?? ""} query={query} />
          </div>
        ))}
    </div>
  )
}

function SimilarModal({ layer }: { layer: Extract<ViewerLayer, { type: "similar" }> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["similar", layer.fileId],
    queryFn: () => api.similar(layer.fileId),
  })
  return (
    <Modal
      open={!layer.closing}
      onOpenChange={(o) => !o && viewer.close(layer.key)}
      size="xl"
      closeLabel={`关闭相似文件：${layer.fileName}`}
      icon={
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-brand/10 text-brand">
          <IconSparkles className="size-[18px]" />
        </span>
      }
      title="相似文件"
      description={`与「${layer.fileName}」内容相近的文件，跨文本、图片、视频与音频`}
    >
      {isLoading ? (
        <div className="flex h-60 items-center justify-center text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
        </div>
      ) : data && data.results.length ? (
        <ResultsGrid
          results={data.results}
          onOpen={(r) => viewer.open({ type: "file", fileId: r.file.id, focus: r.match })}
        />
      ) : (
        <p className="py-16 text-center text-[13px] text-muted-foreground">没有找到相似的文件。</p>
      )}
    </Modal>
  )
}
