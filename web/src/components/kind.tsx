import type { ComponentType } from "react"
import {
  IconCode,
  IconFileText,
  IconFileTypeDocx,
  IconFileTypePdf,
  IconFileTypePpt,
  IconMarkdown,
  IconMovie,
  IconPhoto,
  IconWaveSine,
  type IconProps,
} from "@tabler/icons-react"

import type { FileInfo, Kind } from "@/lib/api"
import { cn } from "@/lib/utils"

export const KIND_LABEL: Record<Kind, string> = {
  text: "文本",
  document: "文档",
  image: "图片",
  video: "视频",
  audio: "音频",
}

/** 筛选标签：文本与文档合并为“文档” */
export const FILTERS = [
  { key: "all", label: "全部", kinds: null },
  { key: "doc", label: "文档", kinds: ["text", "document"] },
  { key: "image", label: "图片", kinds: ["image"] },
  { key: "video", label: "视频", kinds: ["video"] },
  { key: "audio", label: "音频", kinds: ["audio"] },
] as const satisfies readonly { key: string; label: string; kinds: readonly Kind[] | null }[]

export type FilterKey = (typeof FILTERS)[number]["key"]

export const KIND_COLOR: Record<Kind, string> = {
  text: "text-kind-text",
  document: "text-kind-document",
  image: "text-kind-image",
  video: "text-kind-video",
  audio: "text-kind-audio",
}

export const KIND_BG: Record<Kind, string> = {
  text: "bg-kind-text/12",
  document: "bg-kind-document/14",
  image: "bg-kind-image/12",
  video: "bg-kind-video/12",
  audio: "bg-kind-audio/12",
}

const CODE_EXT = new Set([
  "py", "js", "ts", "tsx", "jsx", "java", "kt", "go", "rs", "c", "h", "cpp", "hpp", "cs", "rb", "php", "swift",
  "sh", "bash", "zsh", "sql", "vue", "svelte", "css", "scss", "lua", "dart", "scala", "json", "yaml", "yml", "toml",
  "xml", "html", "htm", "ipynb", "r", "jl", "zig",
])

export function fileIcon(file: Pick<FileInfo, "kind" | "ext">): ComponentType<IconProps> {
  switch (file.kind) {
    case "image":
      return IconPhoto
    case "video":
      return IconMovie
    case "audio":
      return IconWaveSine
    case "document":
      return file.ext === "pdf" ? IconFileTypePdf : file.ext === "pptx" ? IconFileTypePpt : IconFileTypeDocx
    default:
      if (file.ext === "md" || file.ext === "markdown" || file.ext === "mdx") return IconMarkdown
      return CODE_EXT.has(file.ext) ? IconCode : IconFileText
  }
}

export function isCode(ext: string) {
  return CODE_EXT.has(ext)
}

export function FileGlyph({
  file,
  className,
  size = "md",
}: {
  file: Pick<FileInfo, "kind" | "ext">
  className?: string
  size?: "sm" | "md" | "lg"
}) {
  const Icon = fileIcon(file)
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px]",
        KIND_BG[file.kind],
        KIND_COLOR[file.kind],
        size === "sm" && "size-7 rounded-lg [&_svg]:size-4",
        size === "md" && "size-9 [&_svg]:size-[18px]",
        size === "lg" && "size-11 rounded-xl [&_svg]:size-[22px]",
        className
      )}
    >
      <Icon stroke={1.75} />
    </span>
  )
}
