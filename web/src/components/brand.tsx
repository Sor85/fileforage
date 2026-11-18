import { cn } from "@/lib/utils"

/** 品牌标识：一枚由两道弧线构成的放大镜，内含闪光点，象征“在文件中觅得”。 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("size-7", className)} aria-hidden>
      <defs>
        <linearGradient id="ff-g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand)" />
          <stop offset="1" stopColor="var(--brand-2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#ff-g)" />
      <rect x="1" y="1" width="30" height="30" rx="9" fill="white" fillOpacity="0.06" />
      <circle cx="14.5" cy="14.5" r="6.5" stroke="white" strokeWidth="2.2" />
      <path d="M19.4 19.4 24 24" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M14.5 10.6c.32 1.68 1.22 2.58 2.9 2.9-1.68.32-2.58 1.22-2.9 2.9-.32-1.68-1.22-2.58-2.9-2.9 1.68-.32 2.58-1.22 2.9-2.9Z"
        fill="white"
      />
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-[22px] leading-none tracking-[-0.01em]", className)}>
      File<span className="italic">Forage</span>
    </span>
  )
}
