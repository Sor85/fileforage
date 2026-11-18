import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { IconCpu, IconLoader2, IconPlus, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useStatus } from "@/hooks/use-status"
import { api, type SettingsValues } from "@/lib/api"
import { cn } from "@/lib/utils"

const WHISPER = ["tiny", "base", "small", "medium", "large-v3", "large-v3-turbo"]
const IMAGE_TOKENS = [70, 140, 280, 560, 1120]

export function SettingsPage() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings })
  const { data: status } = useStatus()
  const [draft, setDraft] = React.useState<SettingsValues | null>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (data && !draft) setDraft(data.values)
  }, [data, draft])

  const dirty = !!(data && draft && JSON.stringify(data.values) !== JSON.stringify(draft))
  const set = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const res = await api.saveSettings(draft)
      qc.setQueryData(["settings"], res)
      setDraft(res.values)
      void qc.invalidateQueries({ queryKey: ["search"] })
      toast.success("设置已保存，新设置对之后索引的文件生效")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!data || !draft) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-10 sm:px-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )
  }

  const m = status?.model

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-32 sm:px-6 sm:pt-10">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em]">设置</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">模型、索引与检索选项。环境变量决定的项目只读显示。</p>

      <Section title="嵌入模型" desc="文本、图片、视频与音频统一编码到同一个 768 维向量空间">
        <div className="flex items-center gap-4 p-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand/15 to-brand-2/15 text-brand">
            <IconCpu className="size-[22px]" stroke={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] font-medium">{data.env.model}</p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {m ? (
                <>
                  {m.device.toUpperCase()} · {m.dtype} · {m.dim} 维 · 模态 {m.modalities.join(" / ")}
                  {m.load_seconds != null && ` · 加载 ${m.load_seconds}s`}
                </>
              ) : (
                "读取中"
              )}
            </p>
          </div>
          <ModelBadge status={m?.status} />
        </div>
        {m?.error && <p className="mx-4 mb-4 rounded-lg bg-destructive/8 p-2.5 text-[12px] text-destructive">{m.error}</p>}
      </Section>

      <Section title="语音转写" desc="Whisper 把音视频中的语音转成带时间戳的文字，可直接检索台词与对话">
        <Row label="启用语音转写" hint="关闭后音频仍按声音内容向量化，但无法按具体台词检索">
          <Switch checked={draft.transcribe} onCheckedChange={(v) => set("transcribe", v)} />
        </Row>
        <Row label="转写模型" hint="越大越准确，也越慢；首次使用时自动下载">
          <Select value={draft.whisper_model} onValueChange={(v) => set("whisper_model", v)} disabled={!draft.transcribe}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHISPER.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      </Section>

      <Section title="索引" desc="修改后对新索引的文件生效；如需全部生效，在资料库中重建索引">
        <Row label="图片精度" hint="每张图片的视觉 token 数，越高细节越多、速度越慢">
          <Select value={String(draft.image_tokens)} onValueChange={(v) => set("image_tokens", Number(v))}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMAGE_TOKENS.map((t) => (
                <SelectItem key={t} value={String(t)}>
                  {t} tokens{t === 280 ? "（默认）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="视频分段" hint="每段画面与声音合并为一个向量，检索结果可定位到段">
          <NumberField value={draft.video_segment_seconds} onChange={(v) => set("video_segment_seconds", v)} min={4} max={120} unit="秒" />
        </Row>
        <Row label="单个视频最多抽帧" hint="超长视频自动降低抽帧频率">
          <NumberField value={draft.video_max_frames} onChange={(v) => set("video_max_frames", v)} min={16} max={5000} unit="帧" />
        </Row>
        <Row label="音频分段" hint="每段音频独立向量化">
          <NumberField value={draft.audio_segment_seconds} onChange={(v) => set("audio_segment_seconds", v)} min={5} max={300} unit="秒" />
        </Row>
        <Row label="文本文件大小上限" hint="超过该大小的文本与文档不会被索引">
          <NumberField value={draft.max_text_mb} onChange={(v) => set("max_text_mb", v)} min={1} max={500} unit="MB" />
        </Row>
        <Row label="忽略小图" hint="宽和高都小于该值的图片视为图标">
          <NumberField value={draft.min_image_px} onChange={(v) => set("min_image_px", v)} min={0} max={1024} unit="px" />
        </Row>
        <Row label="包含隐藏文件" hint="以 . 开头的文件与目录">
          <Switch checked={draft.include_hidden} onCheckedChange={(v) => set("include_hidden", v)} />
        </Row>
        <Row label="监听目录变化" hint="文件变化后自动增量索引">
          <Switch checked={draft.watch} onCheckedChange={(v) => set("watch", v)} />
        </Row>
        <div className="border-t px-4 py-3.5">
          <p className="text-[13px] font-medium">排除规则</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">匹配文件名或目录名，支持 * 与 ? 通配符</p>
          <TagEditor values={draft.excludes} onChange={(v) => set("excludes", v)} />
        </div>
      </Section>

      <Section title="检索">
        <Row label="相似度阈值" hint="低于该值的结果不显示；结果太少时调低">
          <div className="flex w-56 items-center gap-3">
            <Slider
              value={[draft.min_score]}
              min={0.4}
              max={0.75}
              step={0.01}
              onValueChange={([v]) => set("min_score", Math.round(v * 100) / 100)}
            />
            <span className="w-9 text-right font-mono text-[12px] tabular-nums">{draft.min_score.toFixed(2)}</span>
          </div>
        </Row>
      </Section>

      <Section title="运行环境" desc="通过环境变量配置，修改后需重启服务">
        <Row label="可浏览的根目录" hint="FF_ROOTS">
          <span className="max-w-72 truncate text-right font-mono text-[12px] text-muted-foreground">{data.env.roots.join(", ")}</span>
        </Row>
        <Row label="数据目录" hint="FF_DATA_DIR · 索引数据库与缩略图">
          <span className="max-w-72 truncate text-right font-mono text-[12px] text-muted-foreground">{data.env.data_dir}</span>
        </Row>
        <Row label="推理设备" hint="FF_DEVICE">
          <span className="font-mono text-[12px] text-muted-foreground">{data.env.device}</span>
        </Row>
      </Section>

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-0 bottom-5 z-30 mx-auto flex w-[calc(100%-32px)] max-w-md items-center gap-3 rounded-2xl border bg-popover/90 py-2.5 pr-2.5 pl-4 shadow-(--shadow-float) backdrop-blur-xl"
          >
            <span className="flex-1 text-[13px]">有尚未保存的修改</span>
            <Button variant="ghost" size="sm" onClick={() => setDraft(data.values)}>
              还原
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <IconLoader2 className="size-3.5 animate-spin" />}
              保存
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ModelBadge({ status }: { status?: string }) {
  const map: Record<string, [string, string]> = {
    ready: ["运行中", "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"],
    loading: ["加载中", "bg-amber-500/12 text-amber-600 dark:text-amber-400"],
    error: ["加载失败", "bg-destructive/10 text-destructive"],
    idle: ["未加载", "bg-muted text-muted-foreground"],
  }
  const [label, cls] = map[status ?? "idle"] ?? map.idle
  return <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium", cls)}>{label}</span>
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
      {desc && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{desc}</p>}
      <div className="mt-3 divide-y overflow-hidden rounded-2xl border bg-card shadow-(--shadow-card)">{children}</div>
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}

function NumberField({
  value,
  onChange,
  min,
  max,
  unit,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  unit: string
}) {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text)
          const v = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value
          setText(String(v))
          if (v !== value) onChange(v)
        }}
        className="h-8 w-20 text-right tabular-nums"
      />
      <span className="w-6 text-[12px] text-muted-foreground">{unit}</span>
    </div>
  )
}

function TagEditor({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = React.useState("")
  const add = () => {
    const v = text.trim()
    if (v && !values.includes(v)) onChange([...values, v])
    setText("")
  }
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {values.map((v) => (
        <span key={v} className="inline-flex h-7 items-center gap-1 rounded-lg border bg-muted/50 pr-1 pl-2.5 font-mono text-[11.5px]">
          {v}
          <button
            type="button"
            onClick={() => onChange(values.filter((x) => x !== v))}
            className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-label={`删除排除规则 ${v}`}
          >
            <IconX className="size-3" />
          </button>
        </span>
      ))}
      <form
        className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed pr-1 pl-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="添加规则"
          aria-label="新的排除规则"
          className="w-24 bg-transparent font-mono text-[11.5px] outline-none placeholder:font-sans placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground"
          aria-label="添加排除规则"
        >
          <IconPlus className="size-3" />
        </button>
      </form>
    </div>
  )
}
