import { cn } from "@/lib/utils"

// 20 道长短不一的放射刻度：[路径, 不透明度]。长度来自固定的伪随机序列，保持图形稳定
const TICKS: [string, number][] = [
  ["M16 11.4L16 6.93", 0.71],
  ["M17.42 11.63L19.32 5.77", 0.88],
  ["M18.7 12.28L20.57 9.72", 0.58],
  ["M19.72 13.3L23.85 10.3", 0.77],
  ["M20.37 14.58L24.1 13.37", 0.66],
  ["M20.6 16L22.96 16", 0.5],
  ["M20.37 17.42L26.51 19.42", 0.91],
  ["M19.72 18.7L23.65 21.55", 0.75],
  ["M18.7 19.72L21.07 22.97", 0.67],
  ["M17.42 20.37L18.43 23.49", 0.59],
  ["M16 20.6L16 25.28", 0.73],
  ["M14.58 20.37L12.95 25.38", 0.79],
  ["M13.3 19.72L9.89 24.41", 0.84],
  ["M12.28 18.7L10.59 19.93", 0.48],
  ["M11.63 17.42L6.1 19.22", 0.84],
  ["M11.4 16L7.39 16", 0.67],
  ["M11.63 14.58L9.25 13.81", 0.52],
  ["M12.28 13.3L7.29 9.67", 0.88],
  ["M13.3 12.28L10.83 8.89", 0.68],
  ["M14.58 11.63L12.89 6.44", 0.81],
]

/** 品牌标识“嵌入指纹”：一圈长短不一的刻度，像向量的可视化，也像每个文件独有的语义签名。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="4.5 4.5 23 23" fill="none" className={cn("size-7", className)} aria-hidden>
      <g stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round">
        {TICKS.map(([d, o]) => (
          <path key={d} d={d} opacity={o} />
        ))}
      </g>
      <circle cx="16" cy="16" r="2.1" fill="var(--brand-dot)" />
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[16px] leading-none font-semibold tracking-[-0.02em]", className)}>FileForage</span>
  )
}
