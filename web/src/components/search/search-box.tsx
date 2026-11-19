import * as React from "react"
import { motion } from "motion/react"
import { IconArrowRight, IconPhotoSearch, IconSearch, IconX } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onImage: (file: File) => void
  imagePreview: string | null
  onClearImage: () => void
  size: "hero" | "compact"
  autoFocus?: boolean
  disabled?: boolean
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

export function SearchBox({
  value,
  onChange,
  onSubmit,
  onImage,
  imagePreview,
  onClearImage,
  size,
  autoFocus,
  disabled,
}: Props) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const hero = size === "hero"

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        if (document.querySelector(".modal-layer[data-state=open]")) return
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"))
      if (file) {
        e.preventDefault()
        onImage(file)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [onImage])

  return (
    <motion.form
      layoutId="search-box"
      transition={{ type: "spring", bounce: 0.12, duration: 0.6 }}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className={cn(
        "group relative flex w-full items-center border bg-card shadow-(--shadow-card) transition-[box-shadow,border-color] duration-200 focus-within:border-foreground/25 focus-within:shadow-(--shadow-float)",
        hero ? "h-14 gap-3 rounded-2xl pr-2 pl-4.5" : "h-11 gap-2.5 rounded-xl pr-1.5 pl-3.5"
      )}
    >
      <IconSearch className={cn("shrink-0 text-muted-foreground", hero ? "size-5" : "size-[18px]")} stroke={1.8} />
      {imagePreview && (
        <span className="flex shrink-0 items-center gap-1.5 rounded-xl border bg-muted/60 py-1 pr-1 pl-1">
          <img src={imagePreview} alt="用于检索的图片" className={cn("rounded-lg object-cover", hero ? "size-8" : "size-7")} />
          <span className="text-[12px] text-muted-foreground">以图搜索</span>
          <Button type="button" variant="ghost" size="icon-xs" className="rounded-full" onClick={onClearImage} aria-label="移除检索图片">
            <IconX className="size-3.5" />
          </Button>
        </span>
      )}
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={imagePreview ? "" : "描述要找的内容，例如“海边的日落”或“会议里提到的预算”"}
        aria-label="检索内容"
        className={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70 disabled:opacity-60",
          hero ? "text-[16px]" : "text-[14.5px]"
        )}
      />
      {!hero && !value && !imagePreview && (
        <span className="hidden items-center gap-1 text-muted-foreground sm:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImage(f)
          e.target.value = ""
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("shrink-0 rounded-lg text-muted-foreground", hero ? "size-10" : "size-8")}
            onClick={() => fileRef.current?.click()}
            aria-label="以图搜索"
          >
            <IconPhotoSearch className={hero ? "size-5" : "size-[18px]"} stroke={1.8} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>以图搜索：选择、拖入或粘贴一张图片</TooltipContent>
      </Tooltip>
      <Button
        type="submit"
        size="icon"
        disabled={disabled || (!value.trim() && !imagePreview)}
        className={cn("shrink-0 rounded-lg", hero ? "size-10" : "size-8")}
        aria-label="检索"
      >
        <IconArrowRight className={hero ? "size-5" : "size-4"} stroke={2} />
      </Button>
    </motion.form>
  )
}
