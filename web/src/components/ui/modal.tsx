import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

const SIZES = {
  sm: "sm:max-w-md",
  md: "sm:max-w-xl",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-6xl",
} as const

const NARROW = "(max-width: 639.98px)"
const INTERACTIVE = "button, a, input, textarea, select, [role=slider], [role=switch], [data-no-drag], video, audio"

type ModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  /** 关闭按钮的无障碍名称，写明关闭的是哪个窗口 */
  closeLabel: string
  size?: keyof typeof SIZES
  footer?: React.ReactNode
  headerExtra?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
  /** 返回 false 时拦截关闭（例如有未保存修改需先确认） */
  beforeClose?: () => boolean
  className?: string
}

/**
 * 模态窗口：头部 / 可滚动正文 / 可选底部操作栏三段式。
 * 宽屏居中卡片，窄屏为底部面板（支持下拉关闭）；层叠效果由 lib/modal-stack 统一处理。
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  icon,
  closeLabel,
  size = "md",
  footer,
  headerExtra,
  children,
  bodyClassName,
  beforeClose,
  className,
}: ModalProps) {
  const id = React.useId().replace(/:/g, "")
  const contentRef = React.useRef<HTMLDivElement>(null)
  const returnFocus = React.useRef<HTMLElement | null>(null)

  React.useLayoutEffect(() => {
    if (open) returnFocus.current = document.activeElement as HTMLElement | null
  }, [open])

  const requestClose = React.useCallback(() => {
    if (beforeClose && !beforeClose()) return false
    onOpenChange(false)
    return true
  }, [beforeClose, onOpenChange])

  const drag = useSheetDrag(contentRef, requestClose)

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true)
        else requestClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-overlay-for={id} className="modal-overlay fixed inset-0 z-50" />
        <DialogPrimitive.Content
          ref={contentRef}
          data-layer-id={id}
          data-sheet=""
          aria-describedby={description ? undefined : undefined}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            returnFocus.current?.focus?.({ preventScroll: true })
          }}
          onPointerDown={drag.onPointerDown}
          className={cn(
            "modal-layer fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-48px)] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-(--shadow-float) ring-1 ring-foreground/8 outline-none",
            SIZES[size],
            className
          )}
        >
          <div data-drag-zone className="absolute inset-x-[30%] top-0 z-10 h-5 sm:hidden" aria-hidden />
          <div data-drag-zone className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
            {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-[15px] leading-6 font-semibold tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 line-clamp-2 text-[13px] text-pretty text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{closeLabel}</DialogPrimitive.Description>
              )}
            </div>
            {headerExtra}
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" className="-mt-0.5 -mr-1.5 shrink-0 rounded-full" aria-label={closeLabel}>
                <IconX className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <ScrollArea className="flex-1 rounded-b-2xl">
            <div className={cn("px-5 pt-1 pb-5 sm:px-6", bodyClassName)}>{children}</div>
          </ScrollArea>
          {footer && (
            <div
              data-modal-footer
              className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t bg-muted/40 px-5 py-3 sm:px-6"
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** 窄屏底部面板的下拉关闭：按住把手区或头部往下拖，超过 1/4 高度或快速下甩即关闭。 */
function useSheetDrag(ref: React.RefObject<HTMLDivElement | null>, requestClose: () => boolean) {
  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current
      const target = e.target as HTMLElement
      if (!el || e.button !== 0 || !matchMedia(NARROW).matches) return
      if (!target.closest("[data-drag-zone]") || target.closest(INTERACTIVE)) return
      const startY = e.clientY
      const startT = performance.now()
      let dy = 0
      let moved = false
      el.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        dy = Math.max(0, ev.clientY - startY)
        if (dy > 3) moved = true
        el.style.translate = `0 ${dy}px`
      }
      const end = () => {
        el.removeEventListener("pointermove", move)
        el.removeEventListener("pointerup", end)
        el.removeEventListener("pointercancel", end)
        if (moved) {
          // 吞掉拖动结束后补发的那次点击
          el.addEventListener("click", (ev) => ev.stopPropagation(), { capture: true, once: true })
        }
        const velocity = dy / Math.max(1, performance.now() - startT)
        if ((dy > el.offsetHeight / 4 || (velocity > 0.6 && dy > 24)) && requestClose()) return
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
        const a = el.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], {
          duration: reduced ? 0 : 480,
          easing: "cubic-bezier(0.32, 0.72, 0, 1)",
        })
        el.style.translate = ""
        void a.finished.catch(() => undefined)
      }
      el.addEventListener("pointermove", move)
      el.addEventListener("pointerup", end)
      el.addEventListener("pointercancel", end)
    },
    [ref, requestClose]
  )
  return { onPointerDown }
}
