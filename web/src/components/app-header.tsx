import { motion } from "motion/react"
import {
  IconAdjustmentsHorizontal,
  IconDeviceDesktop,
  IconFolders,
  IconLoader2,
  IconMoon,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconSearch,
  IconSun,
  IconX,
} from "@tabler/icons-react"

import { BrandMark, BrandWordmark } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useStatus } from "@/hooks/use-status"
import { api, type Status } from "@/lib/api"
import { formatEta, formatNumber } from "@/lib/format"
import { navigate, type Route } from "@/lib/router"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

const NAV: { route: Route; href: string; label: string; icon: typeof IconSearch }[] = [
  { route: "search", href: "/", label: "检索", icon: IconSearch },
  { route: "library", href: "/library", label: "资料库", icon: IconFolders },
  { route: "settings", href: "/settings", label: "设置", icon: IconAdjustmentsHorizontal },
]

export function AppHeader({ route }: { route: Route }) {
  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-2 px-3 sm:gap-3 sm:px-6">
      <a
        href="/"
        onClick={(e) => {
          e.preventDefault()
          navigate("/")
        }}
        className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        <BrandMark />
        <BrandWordmark className="hidden sm:inline" />
      </a>

      <nav className="mx-auto flex items-center gap-0.5 rounded-full border bg-card/70 p-1 shadow-(--shadow-card) backdrop-blur-xl">
        {NAV.map((n) => {
          const active = n.route === route
          return (
            <a
              key={n.route}
              href={n.href}
              onClick={(e) => {
                e.preventDefault()
                navigate(n.href)
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors sm:px-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", bounce: 0.18, duration: 0.5 }}
                />
              )}
              <n.icon className="relative size-4" stroke={1.9} />
              <span className="relative">{n.label}</span>
            </a>
          )
        })}
      </nav>

      <div className="flex items-center gap-1.5">
        <IndexingIndicator />
        <ThemeToggle />
      </div>
    </header>
  )
}

function ProgressRing({ value, spinning }: { value: number; spinning?: boolean }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 18 18" className={cn("size-[18px] -rotate-90", spinning && "animate-spin [animation-duration:1.6s]")}>
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.16" strokeWidth="2.2" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="url(#ring-g)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - (spinning ? 0.28 : Math.max(0.02, value)))}
        style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.32,0.72,0,1)" }}
      />
      <defs>
        <linearGradient id="ring-g" x1="0" y1="0" x2="18" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function summary(s: Status): { label: string; busy: boolean; value: number; spinning: boolean } {
  const ix = s.indexer
  if (s.model.status === "loading") return { label: "模型加载中", busy: true, value: 0, spinning: true }
  if (s.model.status === "error") return { label: "模型异常", busy: true, value: 0, spinning: false }
  if (ix.phase === "scanning") return { label: "扫描中", busy: true, value: 0, spinning: true }
  if (ix.phase === "waiting_model") return { label: "等待模型", busy: true, value: 0, spinning: true }
  if (ix.phase === "indexing") {
    const v = ix.total ? (ix.done + ix.current_progress) / ix.total : 0
    return { label: ix.paused ? "已暂停" : `${ix.done}/${ix.total}`, busy: true, value: v, spinning: false }
  }
  return { label: "就绪", busy: false, value: 1, spinning: false }
}

function IndexingIndicator() {
  const { data: s } = useStatus()
  if (!s) return null
  const sum = summary(s)
  const ix = s.indexer
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            "h-8 gap-2 rounded-full border bg-card/70 px-2.5 text-[12px] font-medium tabular-nums shadow-(--shadow-card) backdrop-blur-xl",
            s.model.status === "error" && "text-destructive"
          )}
          aria-label="索引状态"
        >
          {sum.busy ? (
            <ProgressRing value={sum.value} spinning={sum.spinning} />
          ) : (
            <span className="relative flex size-[18px] items-center justify-center">
              <span className="absolute size-2 animate-ping rounded-full bg-emerald-500/40 [animation-duration:2.4s]" />
              <span className="size-2 rounded-full bg-emerald-500" />
            </span>
          )}
          <span className="hidden sm:inline">{sum.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-0 text-[13px] leading-5">
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="font-medium">索引状态</span>
            <span className="text-[12px] text-muted-foreground">
              {formatNumber(s.stats.indexed)} 个文件 · {formatNumber(s.stats.chunks)} 个向量
            </span>
          </div>
          {s.model.status === "error" && (
            <p className="rounded-lg bg-destructive/8 p-2.5 text-[12px] text-destructive">{s.model.error}</p>
          )}
          {s.model.status === "loading" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <IconLoader2 className="size-4 animate-spin" /> 正在加载 {s.model.name}
            </p>
          )}
          {ix.phase === "idle" && s.model.status === "ready" && (
            <p className="text-muted-foreground">所有目录均已是最新状态，目录变化时自动增量索引。</p>
          )}
          {ix.phase !== "idle" && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{ix.collection_name}</span>
                <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                  {ix.phase === "indexing" ? `${ix.done} / ${ix.total}` : ix.phase === "scanning" ? `已发现 ${ix.total}` : "等待模型"}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-linear-to-r from-brand to-brand-2 transition-[width] duration-700 ease-(--ease-sheet)"
                  style={{ width: `${Math.round(sum.value * 100)}%` }}
                />
              </div>
              {ix.current && (
                <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={ix.current}>
                  {ix.current}
                </p>
              )}
              <p className="text-[12px] text-muted-foreground">
                {ix.phase === "indexing" && <>剩余 {formatEta(ix.eta_seconds)}</>}
                {ix.failed > 0 && <span className="text-destructive"> · {ix.failed} 个失败</span>}
                {ix.queued.length > 0 && <> · 队列中还有 {ix.queued.length} 个目录</>}
              </p>
            </div>
          )}
        </div>
        {ix.phase !== "idle" && (
          <div className="flex justify-end gap-2 border-t bg-muted/40 px-4 py-2.5">
            <Button size="sm" variant="outline" onClick={() => api.indexer(ix.paused ? "resume" : "pause")}>
              {ix.paused ? <IconPlayerPlayFilled className="size-3.5" /> : <IconPlayerPauseFilled className="size-3.5" />}
              {ix.paused ? "继续" : "暂停"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => api.indexer("cancel")}>
              <IconX className="size-3.5" />
              停止
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ThemeToggle() {
  const { pref, setTheme } = useTheme()
  const next = pref === "system" ? "light" : pref === "light" ? "dark" : "system"
  const Icon = pref === "system" ? IconDeviceDesktop : pref === "light" ? IconSun : IconMoon
  const label = { system: "跟随系统", light: "浅色", dark: "深色" }[pref]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full border bg-card/70 shadow-(--shadow-card) backdrop-blur-xl"
          onClick={() => setTheme(next)}
          aria-label={`主题：${label}`}
        >
          <motion.span key={pref} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} className="flex">
            <Icon className="size-4" stroke={1.8} />
          </motion.span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>主题：{label}</TooltipContent>
    </Tooltip>
  )
}
