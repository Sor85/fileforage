import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQuery } from "@tanstack/react-query"
import { IconFolderPlus, IconLoader2, IconMoodEmpty, IconPhotoSearch, IconSparkles } from "@tabler/icons-react"

import { FILTERS, KIND_COLOR, KIND_LABEL, type FilterKey } from "@/components/kind"
import { ResultsGrid } from "@/components/search/results-grid"
import { SearchBox } from "@/components/search/search-box"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useStatus } from "@/hooks/use-status"
import { api, type Kind, type SearchResult } from "@/lib/api"
import { formatNumber } from "@/lib/format"
import { navigate, setSearchParams, useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import { viewer } from "@/lib/viewer"

const EXAMPLES = ["海边的日落", "猫咪在晒太阳", "会议里提到的发布计划", "红烧肉的做法", "城市夜景", "季度财务报告"]

export function SearchPage() {
  const { params } = useLocation()
  const q = params.get("q") ?? ""
  const filter = (params.get("k") as FilterKey) || "all"
  const [input, setInput] = React.useState(q)
  const [image, setImage] = React.useState<{ file: File; url: string } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const status = useStatus()

  React.useEffect(() => setInput(q), [q])

  // 输入停顿后自动检索
  React.useEffect(() => {
    if (image) return
    const v = input.trim()
    if (v === q) return
    const t = window.setTimeout(() => setSearchParams({ q: v || null }, !!q && !!v), v ? 450 : 0)
    return () => window.clearTimeout(t)
  }, [input, q, image])

  const textQuery = useQuery({
    queryKey: ["search", q],
    queryFn: ({ signal }) => api.search(q, undefined, undefined, signal),
    enabled: !!q && !image,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    retry: (n, e) => n < 20 && (e as { status?: number }).status === 503,
    retryDelay: 1500,
  })

  const imageQuery = useQuery({
    queryKey: ["search-image", image?.url],
    queryFn: () => api.searchImage(image!.file),
    enabled: !!image,
    staleTime: Infinity,
  })

  const active = image ? imageQuery : textQuery
  const hasQuery = !!image || !!q
  const all = active.data?.results ?? []
  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: all.length }
    for (const f of FILTERS) if (f.kinds) c[f.key] = all.filter((r) => (f.kinds as readonly Kind[]).includes(r.file.kind)).length
    return c
  }, [all])
  const visible = React.useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)
    return f?.kinds ? all.filter((r) => (f.kinds as readonly Kind[]).includes(r.file.kind)) : all
  }, [all, filter])

  const setImageFile = React.useCallback((file: File) => {
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return { file, url: URL.createObjectURL(file) }
    })
    setInput("")
  }, [])

  const clearImage = () => {
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  const open = (r: SearchResult) =>
    viewer.open({ type: "file", fileId: r.file.id, focus: r.match, query: image ? null : q })

  const submit = () => {
    if (image) return
    const v = input.trim()
    if (v) setSearchParams({ q: v }, false)
  }

  const noCollections = status.data && status.data.stats.collections === 0
  const modelLoading = status.data?.model.status === "loading"

  return (
    <div
      className="relative min-h-full"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith("image/"))) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"))
        setDragging(false)
        if (f) {
          e.preventDefault()
          setImageFile(f)
        }
      }}
    >
      {!hasQuery ? (
        <div className="relative mx-auto flex min-h-[calc(100dvh-64px)] max-w-3xl flex-col items-center justify-center px-5 pb-[12vh]">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
            className="flex flex-col items-center text-center"
          >
            <span className="mb-6 inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1 text-[12px] font-medium text-muted-foreground shadow-(--shadow-card) backdrop-blur">
              <IconSparkles className="size-3.5 text-brand" />
              EmbeddingGemma 2 · 全部在本机运行
            </span>
            <h1 className="text-[40px] leading-[1.1] font-semibold tracking-[-0.035em] text-balance sm:text-[56px]">
              用一句话，
              <span className="font-display text-[1.12em] font-normal tracking-[-0.01em] italic">
                <span className="text-gradient pr-1">找到</span>
              </span>
              任何文件
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
              文档、图片、视频与音频共享同一个语义空间。描述画面、复述一句台词，或丢进一张相似的图片。
            </p>
          </motion.div>

          <div className="mt-9 w-full">
            <SearchBox
              size="hero"
              value={input}
              onChange={setInput}
              onSubmit={submit}
              onImage={setImageFile}
              imagePreview={null}
              onClearImage={clearImage}
              autoFocus
            />
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.6 }}
            className="mt-5 flex flex-wrap justify-center gap-2"
          >
            {EXAMPLES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setSearchParams({ q: e }, false)}
                className="rounded-full border bg-card/60 px-3 py-1 text-[12.5px] text-muted-foreground backdrop-blur transition-colors outline-none hover:border-foreground/15 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {e}
              </button>
            ))}
          </motion.div>

          {noCollections ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.6 }}
              className="mt-12 flex w-full max-w-md items-center gap-4 rounded-2xl border border-dashed bg-card/60 p-4 text-left backdrop-blur"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <IconFolderPlus className="size-5" stroke={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">还没有添加任何目录</p>
                <p className="text-[12.5px] text-muted-foreground">选择一个目录，建立索引后即可检索。</p>
              </div>
              <Button size="sm" onClick={() => navigate("/library?add=1")}>
                添加目录
              </Button>
            </motion.div>
          ) : (
            status.data && <HeroStats byKind={status.data.stats.by_kind} total={status.data.stats.indexed} />
          )}
        </div>
      ) : (
        <div className="relative mx-auto max-w-[1400px] px-4 pb-16 sm:px-6">
          <div className="sticky top-0 z-10 -mx-4 bg-linear-to-b from-background via-background/92 to-background/0 px-4 pt-3 pb-4 sm:-mx-6 sm:px-6">
            <div className="mx-auto max-w-3xl">
              <SearchBox
                size="compact"
                value={input}
                onChange={setInput}
                onSubmit={submit}
                onImage={setImageFile}
                imagePreview={image?.url ?? null}
                onClearImage={clearImage}
              />
            </div>
            <div className="mx-auto mt-4 flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex gap-1" role="tablist" aria-label="按类型筛选">
                {FILTERS.map((f) => {
                  const on = f.key === filter
                  const n = counts[f.key] ?? 0
                  return (
                    <button
                      key={f.key}
                      role="tab"
                      aria-selected={on}
                      type="button"
                      onClick={() => setSearchParams({ k: f.key === "all" ? null : f.key })}
                      className={cn(
                        "relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                        on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                        !on && n === 0 && "opacity-45"
                      )}
                    >
                      {on && (
                        <motion.span
                          layoutId="filter-pill"
                          className="absolute inset-0 rounded-full border bg-card shadow-(--shadow-card)"
                          transition={{ type: "spring", bounce: 0.15, duration: 0.45 }}
                        />
                      )}
                      <span className="relative">{f.label}</span>
                      <span className="relative text-[11px] text-muted-foreground tabular-nums">{n}</span>
                    </button>
                  )
                })}
              </div>
              <p className="ml-auto text-[12px] text-muted-foreground">
                {active.isFetching ? (
                  <span className="inline-flex items-center gap-1.5">
                    <IconLoader2 className="size-3.5 animate-spin" /> {modelLoading ? "等待模型加载" : "检索中"}
                  </span>
                ) : active.data ? (
                  <>
                    {formatNumber(all.length)} 个相关文件 · {active.data.timing.embed_ms + active.data.timing.search_ms} ms
                  </>
                ) : null}
              </p>
            </div>
          </div>

          {active.isError ? (
            <EmptyState title="检索失败" body={(active.error as Error).message} />
          ) : !active.data ? (
            <LoadingGrid />
          ) : visible.length === 0 ? (
            <EmptyState
              title={all.length ? `没有${FILTERS.find((f) => f.key === filter)?.label}类型的结果` : "没有找到相关文件"}
              body={
                all.length
                  ? "切换到其他类型查看已找到的结果。"
                  : noCollections
                    ? "资料库为空，添加目录并完成索引后再试。"
                    : "换一种描述方式，或在设置中调低相似度阈值。"
              }
            />
          ) : (
            <ResultsGrid results={visible} query={image ? null : q} onOpen={open} />
          )}
        </div>
      )}

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-3 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-brand/50 bg-background/70 backdrop-blur-md"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-brand/12 text-brand">
                <IconPhotoSearch className="size-7" stroke={1.6} />
              </span>
              <p className="text-[15px] font-medium">松开即以图搜索</p>
              <p className="text-[13px] text-muted-foreground">查找画面相似的图片与视频片段</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function HeroStats({ byKind, total }: { byKind: Partial<Record<Kind, number>>; total: number }) {
  const kinds: Kind[] = ["document", "text", "image", "video", "audio"]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.6 }}
      className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-muted-foreground"
    >
      <span>
        已索引 <span className="font-medium text-foreground tabular-nums">{formatNumber(total)}</span> 个文件
      </span>
      {kinds
        .filter((k) => byKind[k])
        .map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full bg-current", KIND_COLOR[k])} />
            {KIND_LABEL[k]} <span className="text-foreground tabular-nums">{formatNumber(byKind[k] ?? 0)}</span>
          </span>
        ))}
    </motion.div>
  )
}

export function Aurora({ compact }: { compact: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 -z-0 overflow-hidden transition-[height,opacity] duration-700 ease-(--ease-sheet)",
        compact ? "h-[280px] opacity-60" : "h-[720px] opacity-100"
      )}
    >
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]" />
      <div className="aurora-a absolute -top-40 left-[12%] h-[480px] w-[560px] rounded-full bg-brand/22 blur-[110px]" />
      <div className="aurora-b absolute -top-24 right-[10%] h-[420px] w-[520px] rounded-full bg-brand-2/20 blur-[110px]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
    </div>
  )
}

function LoadingGrid() {
  const heights = [220, 180, 260, 200, 170, 240, 210, 190]
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {heights.map((h, i) => (
        <Skeleton key={i} className="rounded-2xl" style={{ height: h }} />
      ))}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto mt-16 flex max-w-sm flex-col items-center text-center"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <IconMoodEmpty className="size-6" stroke={1.6} />
      </span>
      <p className="mt-4 text-[15px] font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </motion.div>
  )
}
