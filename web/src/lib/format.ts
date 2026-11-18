export function formatBytes(n: number): string {
  if (!n) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "--:--"
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = h ? String(m).padStart(2, "0") : String(m)
  return `${h ? `${h}:` : ""}${mm}:${String(r).padStart(2, "0")}`
}

const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return "从未"
  const diff = ts * 1000 - Date.now()
  const abs = Math.abs(diff)
  if (abs < 45_000) return "刚刚"
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute")
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour")
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day")
  return formatDate(ts)
}

export function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN")
}

export function formatEta(sec: number | null | undefined): string {
  if (sec == null) return "估算中"
  if (sec < 60) return `约 ${Math.max(1, Math.round(sec))} 秒`
  if (sec < 3600) return `约 ${Math.round(sec / 60)} 分钟`
  return `约 ${(sec / 3600).toFixed(1)} 小时`
}

/** 把查询拆成用于高亮的词：中文按连续片段，英文按单词。 */
export function highlightTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[\s,，。.!！?？、;；:："'“”‘’()（）[\]【】]+/)
    .filter((t) => t.length >= 2 || /[一-鿿]/.test(t))
  return Array.from(new Set(terms)).sort((a, b) => b.length - a.length)
}

/** 在稳定的伪随机序列上生成波形条高度（同一文件始终相同）。 */
export function waveform(seed: number, bars: number): number[] {
  let x = (seed * 2654435761) % 4294967296
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296
    const r = x / 4294967296
    const env = Math.sin((i / bars) * Math.PI) * 0.55 + 0.45
    out.push(Math.max(0.12, Math.min(1, env * (0.35 + r * 0.75))))
  }
  return out
}
