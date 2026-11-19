import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { IconChevronRight, IconFolder, IconFolderOpen, IconHome, IconLoader2 } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/** 选择服务器上的目录（范围受 FF_ROOTS 限制）。 */
export function FolderPicker({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: (path: string, name: string) => Promise<void>
}) {
  const [path, setPath] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) {
      setPath(null)
      setName("")
      setError(null)
    }
  }, [open])

  const { data, isFetching, isError, error: loadError } = useQuery({
    queryKey: ["fs", path],
    queryFn: () => api.fs(path),
    enabled: open,
  })

  const crumbs = React.useMemo(() => {
    if (!data?.path) return []
    const parts = data.path.split("/").filter(Boolean)
    return parts.map((p, i) => ({ name: p, path: "/" + parts.slice(0, i + 1).join("/") }))
  }, [data?.path])

  const go = (p: string | null) => {
    setPath(p)
    setError(null)
    setName(p ? (p.split("/").filter(Boolean).pop() ?? "") : "")
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      closeLabel="关闭添加目录窗口"
      icon={
        <span className="flex size-9 items-center justify-center rounded-[10px] bg-brand/10 text-brand">
          <IconFolderOpen className="size-[18px]" stroke={1.8} />
        </span>
      }
      title="添加目录"
      description="目录中的文档、图片、视频与音频会被逐个向量化，之后的变化自动增量更新。添加后可在目录卡片中排除文件种类，再开始索引。"
      bodyClassName="space-y-4"
      footer={
        <>
          {error && <p className="mr-auto text-[12.5px] text-destructive">{error}</p>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!data?.path || busy}
            onClick={async () => {
              if (!data?.path) return
              setBusy(true)
              setError(null)
              try {
                await onConfirm(data.path, name.trim())
                onOpenChange(false)
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <IconLoader2 className="size-4 animate-spin" />}
            添加
          </Button>
        </>
      }
    >
      <div className="flex min-h-8 flex-wrap items-center gap-0.5 text-[12.5px]">
        <button
          type="button"
          onClick={() => go(null)}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          <IconHome className="size-3.5" />
          可用位置
        </button>
        {crumbs.map((c, i) => (
          <React.Fragment key={c.path}>
            <IconChevronRight className="size-3.5 text-muted-foreground/60" />
            <button
              type="button"
              onClick={() => go(c.path)}
              className={cn(
                "max-w-40 truncate rounded-md px-1.5 py-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40",
                i === crumbs.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {c.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <ScrollArea className="h-[min(320px,40dvh)]">
          <div className="p-1.5">
            {isError ? (
              <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">{(loadError as Error).message}</p>
            ) : !data ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground">
                <IconLoader2 className="size-5 animate-spin" />
              </div>
            ) : data.entries.length === 0 ? (
              <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">该目录下没有子目录</p>
            ) : (
              data.entries.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => go(e.path)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40",
                    isFetching && "opacity-60"
                  )}
                >
                  <IconFolder className="size-[18px] shrink-0 text-kind-document" stroke={1.7} />
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <IconChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-[12px] text-muted-foreground">已选目录</Label>
          <div className="flex h-9 items-center truncate rounded-lg border bg-muted/50 px-3 font-mono text-[12px]">
            {data?.path ?? <span className="font-sans text-muted-foreground">进入一个目录以选中它</span>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="coll-name" className="text-[12px] text-muted-foreground">
            显示名称
          </Label>
          <Input id="coll-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="默认为目录名" className="h-9" />
        </div>
      </div>
    </Modal>
  )
}
