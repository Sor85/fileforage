import * as React from "react"
import { motion } from "motion/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  IconAlertTriangle,
  IconDots,
  IconFolder,
  IconFolderPlus,
  IconRefresh,
  IconRotateClockwise2,
  IconTrash,
} from "@tabler/icons-react"

import { FolderPicker } from "@/components/folder-picker"
import { FileGlyph, KIND_COLOR, KIND_LABEL } from "@/components/kind"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Modal } from "@/components/ui/modal"
import { Skeleton } from "@/components/ui/skeleton"
import { useCollections, useStatus } from "@/hooks/use-status"
import { api, type Collection, type Kind, type Progress } from "@/lib/api"
import { formatBytes, formatEta, formatNumber, formatRelative } from "@/lib/format"
import { setSearchParams, useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"

const KINDS: Kind[] = ["document", "text", "image", "video", "audio"]

export function LibraryPage() {
  const { params } = useLocation()
  const qc = useQueryClient()
  const { data: collections, isLoading } = useCollections()
  const { data: status } = useStatus()
  const [adding, setAdding] = React.useState(false)

  React.useEffect(() => {
    if (params.get("add")) {
      setAdding(true)
      setSearchParams({ add: null })
    }
  }, [params])

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["collections"] })
    void qc.invalidateQueries({ queryKey: ["status"] })
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 pb-20 sm:px-6 sm:pt-10">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">资料库</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            已添加的目录会被持续监听，新增、修改与删除的文件自动同步到索引。
          </p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <IconFolderPlus className="size-4" />
          添加目录
        </Button>
      </div>

      {status && (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="已索引文件" value={formatNumber(status.stats.indexed)} />
          <Stat label="向量分块" value={formatNumber(status.stats.chunks)} />
          <Stat label="文件总量" value={formatBytes(status.stats.bytes)} />
          <Stat
            label="索引失败"
            value={formatNumber(status.stats.errors)}
            tone={status.stats.errors ? "warn" : undefined}
          />
        </div>
      )}

      <div className="mt-8 space-y-3">
        {isLoading ? (
          Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)
        ) : collections && collections.length ? (
          collections.map((c, i) => (
            <CollectionCard key={c.id} c={c} index={i} progress={status?.indexer} onChanged={refresh} />
          ))
        ) : (
          <div className="flex flex-col items-center rounded-2xl border bg-card px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <IconFolderPlus className="size-6" stroke={1.6} />
            </span>
            <p className="mt-4 text-[15px] font-medium">还没有添加任何目录</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              选择一个包含文档、照片、视频或录音的目录，FileForage 会在本机完成全部向量化。
            </p>
            <Button className="mt-5" onClick={() => setAdding(true)}>
              添加目录
            </Button>
          </div>
        )}
      </div>

      <FolderPicker
        open={adding}
        onOpenChange={setAdding}
        onConfirm={async (path, name) => {
          const c = await api.addCollection(path, name || undefined)
          toast.success(`已添加「${c.name}」，开始建立索引`)
          refresh()
        }}
      />
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-[20px] leading-tight font-semibold tracking-tight tabular-nums", tone === "warn" && "text-destructive")}>
        {value}
      </p>
    </div>
  )
}

function CollectionCard({
  c,
  index,
  progress,
  onChanged,
}: {
  c: Collection
  index: number
  progress?: Progress
  onChanged: () => void
}) {
  const [confirm, setConfirm] = React.useState<"delete" | "reindex" | null>(null)
  const [showErrors, setShowErrors] = React.useState(false)
  const active = progress && progress.collection_id === c.id && progress.phase !== "idle"
  const queued = progress?.queued.includes(c.id)
  const indexed = KINDS.reduce((n, k) => n + (c.kinds[k] ?? 0), 0)
  const pct = active && progress.total ? (progress.done + progress.current_progress) / progress.total : 0

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: index * 0.03 }}
      className="overflow-hidden rounded-2xl border bg-card"
    >
      <div className="flex items-start gap-4 p-4 sm:p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <IconFolder className="size-5" stroke={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold tracking-tight">{c.name}</p>
            {!c.exists && (
              <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">目录不可访问</span>
            )}
            {queued && !active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">排队中</span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground" title={c.path}>
            {c.path}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
            {KINDS.filter((k) => c.kinds[k]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span className={cn("size-1.5 rounded-full bg-current", KIND_COLOR[k])} />
                {KIND_LABEL[k]}
                <span className="font-medium text-foreground tabular-nums">{formatNumber(c.kinds[k] ?? 0)}</span>
              </span>
            ))}
            {indexed === 0 && !active && <span className="text-muted-foreground">尚无已索引文件</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={`重新扫描 ${c.name}`}
            onClick={async () => {
              await api.scanCollection(c.id)
              toast("已开始扫描变化")
              onChanged()
            }}
          >
            <IconRefresh className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`${c.name} 的更多操作`}>
                <IconDots className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={() => setConfirm("reindex")}>
                <IconRotateClockwise2 className="size-4" />
                重建全部索引
              </DropdownMenuItem>
              {c.errors > 0 && (
                <DropdownMenuItem onSelect={() => setShowErrors(true)}>
                  <IconAlertTriangle className="size-4" />
                  查看失败文件
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <IconTrash className="size-4" />
                移除目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {active ? (
        <div className="border-t bg-muted/30 px-4 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3 text-[12px]">
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {progress.phase === "scanning" ? "正在扫描目录…" : progress.phase === "waiting_model" ? "等待模型加载…" : progress.current}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {progress.phase === "indexing" && (
                <>
                  {progress.done}/{progress.total} · 剩余 {formatEta(progress.eta_seconds)}
                </>
              )}
              {progress.paused && " · 已暂停"}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            {progress.phase === "indexing" ? (
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-700 ease-(--ease-sheet)"
                style={{ width: `${Math.max(2, pct * 100)}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-linear-to-r from-brand/0 via-brand to-brand/0" />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground sm:px-5">
          <span>{formatNumber(indexed)} 个文件</span>
          <span>{formatBytes(c.bytes)}</span>
          <span>上次扫描 {formatRelative(c.last_scan_at)}</span>
          {c.errors > 0 && (
            <button type="button" onClick={() => setShowErrors(true)} className="text-destructive underline-offset-4 hover:underline">
              {c.errors} 个文件失败
            </button>
          )}
          {c.last_error && <span className="text-destructive">{c.last_error}</span>}
        </div>
      )}

      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`移除「${c.name}」？`}
        description="该目录的索引、缩略图与向量会被删除，原始文件不受影响。"
        confirmText="移除"
        destructive
        onConfirm={async () => {
          await api.deleteCollection(c.id)
          toast.success(`已移除「${c.name}」`)
          onChanged()
        }}
      />
      <ConfirmDialog
        open={confirm === "reindex"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="重建全部索引？"
        description="目录中的所有文件将重新提取与向量化，适用于修改了模型或索引设置之后。文件较多时耗时较长。"
        confirmText="重建"
        onConfirm={async () => {
          await api.reindexCollection(c.id)
          toast("已开始重建索引")
          onChanged()
        }}
      />
      <ErrorsModal open={showErrors} onOpenChange={setShowErrors} collection={c} />
    </motion.div>
  )
}

function ErrorsModal({ open, onOpenChange, collection }: { open: boolean; onOpenChange: (o: boolean) => void; collection: Collection }) {
  const { data } = useQuery({
    queryKey: ["errors", collection.id],
    queryFn: () => api.collectionErrors(collection.id),
    enabled: open,
  })
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      closeLabel={`关闭失败文件列表：${collection.name}`}
      icon={
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-destructive/10 text-destructive">
          <IconAlertTriangle className="size-[18px]" />
        </span>
      }
      title="失败文件"
      description={`「${collection.name}」中未能完成索引的文件，文件变化后会自动重试`}
    >
      <div className="divide-y">
        {data?.map((f) => (
          <div key={f.id} className="flex items-start gap-3 py-3">
            <FileGlyph file={f} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{f.rel_path}</p>
              <p className="mt-0.5 text-[12px] break-words text-muted-foreground">{f.error}</p>
            </div>
          </div>
        ))}
        {data && data.length === 0 && <p className="py-10 text-center text-[13px] text-muted-foreground">没有失败的文件</p>}
      </div>
    </Modal>
  )
}
