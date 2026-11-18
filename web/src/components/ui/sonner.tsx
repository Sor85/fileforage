import { Toaster as Sonner, type ToasterProps } from "sonner"
import { IconAlertOctagon, IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconLoader } from "@tabler/icons-react"

import { useTheme } from "@/lib/theme"

const Toaster = (props: ToasterProps) => {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      position="bottom-center"
      icons={{
        success: <IconCircleCheck className="size-4 text-emerald-500" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4 text-amber-500" />,
        error: <IconAlertOctagon className="size-4 text-destructive" />,
        loading: <IconLoader className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "14px",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "!shadow-(--shadow-float) !text-[13px]" } }}
      {...props}
    />
  )
}

export { Toaster }
