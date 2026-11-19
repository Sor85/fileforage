import { cn } from "@/lib/utils"

/** 品牌标识：字母 F 与右下角的放大镜，纯色圆角底。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <g stroke="white" strokeLinecap="round" transform="translate(-1.3 -0.4)">
        <path d="M10 8.5h7.5M10 8.5v15M10 15.5h5" strokeWidth="2.4" />
        <circle cx="20" cy="19.5" r="3.6" strokeWidth="2.2" />
        <path d="m22.7 22.2 2 2" strokeWidth="2.4" />
      </g>
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-[16px] leading-none font-semibold tracking-[-0.02em]", className)}>FileForage</span>
  )
}
