import { useSyncExternalStore } from "react"

export type ThemePref = "light" | "dark" | "system"

const KEY = "fileforage-theme"
const listeners = new Set<() => void>()
const media = matchMedia("(prefers-color-scheme: dark)")

function read(): ThemePref {
  const v = localStorage.getItem(KEY)
  return v === "light" || v === "dark" ? v : "system"
}

export function resolvedTheme(pref = read()): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref
}

function apply() {
  document.documentElement.classList.toggle("dark", resolvedTheme() === "dark")
}

export function initTheme() {
  apply()
  media.addEventListener("change", () => {
    apply()
    listeners.forEach((l) => l())
  })
}

export function setTheme(pref: ThemePref) {
  if (pref === "system") localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, pref)
  apply()
  listeners.forEach((l) => l())
}

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read
  )
  return { pref, resolved: resolvedTheme(pref), setTheme }
}
