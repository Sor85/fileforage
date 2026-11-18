import * as React from "react"

import { highlightTerms } from "@/lib/format"

export function Highlight({ text, query, className }: { text: string; query?: string | null; className?: string }) {
  const parts = React.useMemo(() => {
    const terms = query ? highlightTerms(query) : []
    if (!terms.length) return [text]
    const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
    return text.split(re)
  }, [text, query])
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="hl">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        )
      )}
    </span>
  )
}

export function RelevanceMeter({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(value * 100)
  return (
    <span className={className} title={`相关度 ${pct}%`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">
        <span className="relative h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-brand to-brand-2"
            style={{ width: `${Math.max(6, pct)}%` }}
          />
        </span>
        {pct}%
      </span>
    </span>
  )
}
