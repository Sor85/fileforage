import * as React from "react"
import { motion } from "motion/react"
import { IconPlayerPlayFilled, IconQuote } from "@tabler/icons-react"

import { FileGlyph, isCode } from "@/components/kind"
import { Highlight, RelevanceMeter } from "@/components/search/highlight"
import { fileUrl, type Chunk, type SearchResult } from "@/lib/api"
import { formatBytes, formatDuration, waveform } from "@/lib/format"
import { cn } from "@/lib/utils"

type CardProps = { result: SearchResult; query?: string | null; index: number; onOpen: (r: SearchResult) => void }

export function ResultCard(props: CardProps) {
  const { result, index, onOpen } = props
  const k = result.file.kind
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1], delay: Math.min(index, 16) * 0.03 }}
      onClick={() => onOpen(result)}
      className="group/card relative flex w-full flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-(--shadow-card) transition-[transform,box-shadow,border-color] duration-300 ease-(--ease-sheet) outline-none hover:-translate-y-0.5 hover:border-foreground/12 hover:shadow-(--shadow-float) focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      {k === "image" && <ImageBody {...props} />}
      {k === "video" && <VideoBody {...props} />}
      {k === "audio" && <AudioBody {...props} />}
      {(k === "text" || k === "document") && <DocBody {...props} />}
    </motion.button>
  )
}

function Footer({ result, children }: { result: SearchResult; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-5 font-medium" title={result.file.name}>
          {result.file.name}
        </p>
        <p className="truncate text-[11.5px] leading-4 text-muted-foreground" title={result.file.rel_path}>
          {children ?? (result.file.dir || "根目录")}
        </p>
      </div>
      <RelevanceMeter value={result.relevance} className="shrink-0 self-end pb-px" />
    </div>
  )
}

function TimeChip({ chunk, className }: { chunk: Chunk; className?: string }) {
  if (chunk.start == null) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-md",
        className
      )}
    >
      <IconPlayerPlayFilled className="size-2.5" />
      {formatDuration(chunk.start)}
      {chunk.end != null && chunk.end - chunk.start > 1 && <> – {formatDuration(chunk.end)}</>}
    </span>
  )
}

function Thumb({ src, ratio, alt }: { src: string; ratio: number; alt: string }) {
  const [loaded, setLoaded] = React.useState(false)
  return (
    <div className="relative overflow-hidden bg-muted" style={{ aspectRatio: String(ratio) }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          "size-full object-cover transition-[opacity,transform,filter] duration-700 ease-(--ease-sheet) group-hover/card:scale-[1.035]",
          loaded ? "opacity-100 blur-0" : "opacity-0 blur-md"
        )}
      />
    </div>
  )
}

function ratioOf(r: SearchResult, fallback: number, min = 0.62, max = 1.9) {
  const { width, height } = r.file.meta
  if (!width || !height) return fallback
  return Math.min(max, Math.max(min, width / height))
}

function ImageBody({ result }: CardProps) {
  return (
    <>
      <Thumb src={fileUrl.thumb(result.file.id)} ratio={ratioOf(result, 1)} alt={result.file.name} />
      <Footer result={result}>
        {result.file.meta.width && result.file.meta.height
          ? `${result.file.meta.width} × ${result.file.meta.height} · ${formatBytes(result.file.size)}`
          : formatBytes(result.file.size)}
      </Footer>
    </>
  )
}

function useHoverPreview(delay = 380) {
  const [active, setActive] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  const bind = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse") return
      timer.current = window.setTimeout(() => setActive(true), delay)
    },
    onPointerLeave: () => {
      window.clearTimeout(timer.current)
      setActive(false)
    },
  }
  return { active, bind }
}

function VideoBody({ result, query }: CardProps) {
  const m = result.match
  const seg = m.kind === "video" && m.has_thumb ? m : result.extra.find((c) => c.kind === "video" && c.has_thumb)
  const src = seg ? fileUrl.chunkThumb(result.file.id, seg) : fileUrl.thumb(result.file.id)
  const { active, bind } = useHoverPreview()
  const start = m.start ?? 0
  const ratio = ratioOf(result, 16 / 9, 0.75, 1.9)
  return (
    <>
      <div className="relative" {...bind}>
        <Thumb src={src} ratio={ratio} alt={result.file.name} />
        {active && (
          <video
            src={`${fileUrl.raw(result.file.id)}#t=${start}`}
            muted
            autoPlay
            loop
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/45 via-transparent to-transparent" />
        <div className="absolute right-2.5 bottom-2.5 left-2.5 flex items-center justify-between gap-2">
          <TimeChip chunk={m} />
          <span className="ml-auto rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-md">
            {formatDuration(result.file.meta.duration)}
          </span>
        </div>
        <span className="absolute top-1/2 left-1/2 flex size-11 -translate-1/2 scale-90 items-center justify-center rounded-full bg-white/85 text-black opacity-0 shadow-lg backdrop-blur transition-[opacity,scale] duration-300 group-hover/card:scale-100 group-hover/card:opacity-100">
          <IconPlayerPlayFilled className="size-4.5" />
        </span>
      </div>
      {m.kind === "transcript" && m.text && <Transcript text={m.text} query={query} />}
      <Footer result={result} />
    </>
  )
}

function Transcript({ text, query }: { text: string; query?: string | null }) {
  return (
    <div className="mx-3.5 mt-3 flex gap-2 rounded-xl bg-muted/70 px-3 py-2.5 text-[12.5px] leading-[1.6] text-foreground/85">
      <IconQuote className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <Highlight text={text} query={query} className="line-clamp-3" />
    </div>
  )
}

function AudioBody({ result, query }: CardProps) {
  const m = result.match
  const bars = React.useMemo(() => waveform(result.file.id, 42), [result.file.id])
  const dur = result.file.meta.duration ?? 0
  const at = m.start != null && dur ? m.start / dur : null
  return (
    <>
      <div className="relative mx-3.5 mt-3.5 overflow-hidden rounded-xl bg-linear-to-br from-kind-audio/18 via-kind-audio/8 to-transparent px-3.5 pt-3 pb-3.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-kind-audio tabular-nums">
          <span className="flex items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-kind-audio text-white transition-transform duration-300 group-hover/card:scale-110 dark:text-black">
              <IconPlayerPlayFilled className="size-3" />
            </span>
            {m.start != null ? formatDuration(m.start) : "音频"}
          </span>
          <span>{formatDuration(dur)}</span>
        </div>
        <div className="mt-3 flex h-10 items-center gap-[2px]">
          {bars.map((h, i) => {
            const pos = i / bars.length
            const hot = at != null && Math.abs(pos - at) < 0.08
            return (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-[height] duration-500",
                  hot ? "bg-kind-audio" : "bg-kind-audio/35"
                )}
                style={{ height: `${h * 100}%` }}
              />
            )
          })}
        </div>
      </div>
      {m.kind === "transcript" && m.text && <Transcript text={m.text} query={query} />}
      <Footer result={result} />
    </>
  )
}

function DocBody({ result, query }: CardProps) {
  const m = result.match
  const f = result.file
  const pageThumb = m.kind === "page" && m.has_thumb
  const code = isCode(f.ext)
  return (
    <>
      <div className="flex items-start gap-3 px-3.5 pt-3.5">
        <FileGlyph file={f} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] leading-5 font-medium" title={f.name}>
            <Highlight text={f.name} query={query} />
          </p>
          <p className="truncate text-[11.5px] leading-4 text-muted-foreground">{f.dir || "根目录"}</p>
        </div>
      </div>
      {pageThumb ? (
        <div className="mx-3.5 mt-3 overflow-hidden rounded-lg border">
          <Thumb src={fileUrl.chunkThumb(f.id, m)} ratio={0.77} alt={`${f.name} 第 ${m.start} 页`} />
        </div>
      ) : m.text && m.kind !== "name" ? (
        <p
          className={cn(
            "mx-3.5 mt-3 line-clamp-5 text-[12.5px] leading-[1.65] whitespace-pre-line text-foreground/80",
            code && "rounded-lg bg-muted/70 px-2.5 py-2 font-mono text-[11.5px] leading-[1.6] whitespace-pre"
          )}
        >
          <Highlight text={m.text.trim()} query={query} />
        </p>
      ) : f.has_thumb ? (
        <div className="mx-3.5 mt-3 overflow-hidden rounded-lg border">
          <Thumb src={fileUrl.thumb(f.id)} ratio={1.3} alt={f.name} />
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 px-3.5 pt-3 pb-3 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wide uppercase">
          {f.ext}
        </span>
        {m.start != null && <span>第 {m.start} 页</span>}
        <span>{formatBytes(f.size)}</span>
        <RelevanceMeter value={result.relevance} className="ml-auto" />
      </div>
    </>
  )
}
