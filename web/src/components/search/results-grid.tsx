import * as React from "react"

import { ResultCard } from "@/components/search/result-card"
import type { SearchResult } from "@/lib/api"

function estimateHeight(r: SearchResult, colWidth: number): number {
  const { width, height } = r.file.meta
  switch (r.file.kind) {
    case "image": {
      const ratio = width && height ? Math.min(1.9, Math.max(0.62, width / height)) : 1
      return colWidth / ratio + 60
    }
    case "video": {
      const ratio = width && height ? Math.min(1.9, Math.max(0.75, width / height)) : 16 / 9
      return colWidth / ratio + 60 + (r.match.kind === "transcript" ? 84 : 0)
    }
    case "audio":
      return 200 + (r.match.kind === "transcript" ? 84 : 0)
    default:
      if (r.match.kind === "page") return colWidth * 1.3 + 100
      return 196
  }
}

/** 瀑布流：按排名依次放入当前最矮的一列，排名靠前的结果始终在上方。 */
export function ResultsGrid({
  results,
  query,
  onOpen,
}: {
  results: SearchResult[]
  query?: string | null
  onOpen: (r: SearchResult) => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  const gap = 16
  const cols = width < 480 ? 1 : width < 780 ? 2 : width < 1120 ? 3 : 4
  const colWidth = (width - gap * (cols - 1)) / cols

  const columns = React.useMemo(() => {
    const out: { r: SearchResult; i: number }[][] = Array.from({ length: cols }, () => [])
    const heights = new Array(cols).fill(0)
    results.forEach((r, i) => {
      let c = 0
      for (let j = 1; j < cols; j++) if (heights[j] < heights[c] - 24) c = j
      out[c].push({ r, i })
      heights[c] += estimateHeight(r, colWidth) + gap
    })
    return out
  }, [results, cols, colWidth])

  return (
    <div ref={ref} className="flex items-start" style={{ gap }}>
      {width > 0 &&
        columns.map((col, ci) => (
          <div key={ci} className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
            {col.map(({ r, i }) => (
              <ResultCard key={r.file.id} result={r} query={query} index={i} onOpen={onOpen} />
            ))}
          </div>
        ))}
    </div>
  )
}
