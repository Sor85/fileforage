import { useSyncExternalStore } from "react"

/** 极简路由：pathname 决定页面，search 参数保存检索词，支持前进后退。 */

export type Route = "search" | "library" | "settings"

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
window.addEventListener("popstate", emit)

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

const href = () => location.pathname + location.search

export function useLocation() {
  const h = useSyncExternalStore(subscribe, href)
  const url = new URL(h, location.origin)
  const route: Route = url.pathname.startsWith("/library")
    ? "library"
    : url.pathname.startsWith("/settings")
      ? "settings"
      : "search"
  return { route, params: url.searchParams }
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === href()) return
  if (opts.replace) history.replaceState(null, "", to)
  else history.pushState(null, "", to)
  emit()
}

export function setSearchParams(params: Record<string, string | null>, replace = true) {
  const url = new URL(location.href)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
    else url.searchParams.delete(k)
  }
  navigate(url.pathname + url.search, { replace })
}
