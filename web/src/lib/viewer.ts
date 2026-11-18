import { useSyncExternalStore } from "react"

import type { Chunk } from "@/lib/api"

/**
 * 文件查看相关的窗口栈（文件详情 → 相似文件 → 文件详情 …）。
 * 关闭第 i 层会一并关闭其上的所有窗口；每层带唯一 key，重新打开时使用全新状态。
 */

type LayerBase = { key: number; closing?: boolean }
export type ViewerLayer = LayerBase &
  (
    | { type: "file"; fileId: number; focus?: Chunk | null; query?: string | null }
    | { type: "similar"; fileId: number; fileName: string }
  )

type NewLayer =
  | { type: "file"; fileId: number; focus?: Chunk | null; query?: string | null }
  | { type: "similar"; fileId: number; fileName: string }

let layers: ViewerLayer[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export const viewer = {
  open(layer: NewLayer) {
    layers = [...layers, { ...layer, key: ++seq } as ViewerLayer]
    emit()
  },
  /** 关闭指定层及其上所有层：先标记退场，退场动画播完后再卸载 */
  close(key: number) {
    const i = layers.findIndex((l) => l.key === key)
    if (i < 0) return
    const doomed = new Set(layers.slice(i).map((l) => l.key))
    layers = layers.map((l) => (doomed.has(l.key) ? { ...l, closing: true } : l))
    emit()
    window.setTimeout(() => {
      layers = layers.filter((l) => !doomed.has(l.key))
      emit()
    }, 420)
  },
  closeAll() {
    if (layers[0]) viewer.close(layers[0].key)
  },
}

export function useViewerLayers() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => layers
  )
}
