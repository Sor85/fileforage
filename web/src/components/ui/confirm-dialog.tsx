import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmText: string
  cancelText?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
}

/** 确认框：始终为居中小卡片，叠在其他窗口之上时同样层叠升起。 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText = "取消",
  destructive,
  onConfirm,
}: ConfirmDialogProps) {
  const id = React.useId().replace(/:/g, "")
  const [busy, setBusy] = React.useState(false)
  const returnFocus = React.useRef<HTMLElement | null>(null)

  React.useLayoutEffect(() => {
    if (open) returnFocus.current = document.activeElement as HTMLElement | null
  }, [open])

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          data-overlay-for={id}
          className="modal-overlay fixed inset-0 z-50"
          onClick={() => !busy && onOpenChange(false)}
        />
        <AlertDialogPrimitive.Content
          data-layer-id={id}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            returnFocus.current?.focus?.({ preventScroll: true })
          }}
          className={cn(
            "modal-layer fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-popover p-5 text-popover-foreground shadow-(--shadow-float) ring-1 ring-foreground/8 outline-none"
          )}
        >
          <div className="space-y-1.5">
            <AlertDialogPrimitive.Title className="text-[15px] font-semibold tracking-tight">{title}</AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-[13px] leading-relaxed text-muted-foreground">
              {description ?? ""}
            </AlertDialogPrimitive.Description>
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                {cancelText}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onConfirm()
                  onOpenChange(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {confirmText}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
