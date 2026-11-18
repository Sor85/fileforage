/**
 * 全局模态层叠管理。
 *
 * 只看 DOM 上真实的开合状态：所有 `.modal-layer` 元素按 `data-state="open"` 的出现顺序组成栈，
 * 不依赖组件父子关系。下层窗口用 Web Animations API 缩小并上移、露出顶边；
 * 栈底页面（`[data-modal-stack-root]`）原地虚化。一次提交里的开合在微任务中统一摆放。
 */

const NARROW = "(max-width: 639.98px)"
const REDUCED = "(prefers-reduced-motion: reduce)"
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)"
const PEEK = 14

let seq = 0
const openedAt = new WeakMap<HTMLElement, number>()
const anims = new WeakMap<HTMLElement, Animation>()
let scheduled = false
let started = false

function schedule() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    layout()
  })
}

function currentTransform(el: HTMLElement): { s: number; ty: number; css: string } {
  const t = getComputedStyle(el).transform
  if (!t || t === "none") return { s: 1, ty: 0, css: "none" }
  const m = new DOMMatrixReadOnly(t)
  return { s: m.a || 1, ty: m.f, css: t }
}

/** 去掉 transform 后的布局矩形（transform-origin 为顶边中点，缩放不改变顶边位置）。 */
function layoutRect(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const { s, ty } = currentTransform(el)
  return { top: r.top - ty, height: r.height / s, width: r.width / s }
}

function animateTo(el: HTMLElement, transform: string, onDone?: () => void) {
  const reduced = matchMedia(REDUCED).matches
  const from = currentTransform(el).css
  const prev = anims.get(el)
  const a = el.animate([{ transform: from }, { transform }], {
    duration: reduced ? 0 : 480,
    easing: EASE,
    fill: "forwards",
  })
  prev?.cancel()
  anims.set(el, a)
  a.onfinish = () => onDone?.()
}

function pushBack(el: HTMLElement, depth: number, top: HTMLElement) {
  const own = layoutRect(el)
  const front = layoutRect(top)
  let scale = Math.max(0.82, 1 - 0.06 * depth)
  // 露出约 14px 顶边；本来就比上层高很多时至少再上移 10px；顶边离视口顶部至少 8px
  let target = Math.min(front.top - PEEK * depth, own.top - 10)
  target = Math.max(target, 8)
  const frontBottom = front.top + front.height
  if (own.width * scale <= front.width + 1 && target + own.height * scale > frontBottom - 4) {
    // 左右都被上层盖住时只露顶边：太高就再缩小，让底边收进上层底边之内
    scale = Math.max(0.5, Math.min(scale, (frontBottom - 4 - target) / own.height))
  }
  el.dataset.stacked = ""
  if (el.dataset.square !== undefined) el.dataset.stackedRound = ""
  animateTo(el, `translateY(${(target - own.top).toFixed(2)}px) scale(${scale.toFixed(4)})`)
}

function restore(el: HTMLElement) {
  delete el.dataset.stacked
  delete el.dataset.stackedRound
  const a = anims.get(el)
  if (!a) return
  animateTo(el, "none", () => {
    // 回到原位后取消动画，避免一直 fill 着的动画压住窗口自己的退场动画
    const cur = anims.get(el)
    if (cur) {
      cur.cancel()
      anims.delete(el)
    }
  })
}

function layout() {
  const narrow = matchMedia(NARROW).matches
  const all = Array.from(document.querySelectorAll<HTMLElement>(".modal-layer"))
  const open = all.filter((el) => el.dataset.state === "open")
  for (const el of open) if (!openedAt.has(el)) openedAt.set(el, ++seq)
  for (const el of all) if (el.dataset.state !== "open") openedAt.delete(el)
  open.sort((a, b) => (openedAt.get(a) ?? 0) - (openedAt.get(b) ?? 0))

  // 窄屏只有底部面板之间层叠；居中确认框叠上来时下层原地不动
  const stacking = narrow ? open.filter((el) => el.dataset.sheet !== undefined) : open
  const top = stacking[stacking.length - 1]
  for (const el of open) {
    const i = stacking.indexOf(el)
    if (i >= 0 && el !== top) pushBack(el, stacking.length - 1 - i, top)
    else restore(el)
    if (el === top && stacking.length > 1) el.dataset.stacking = ""
    else delete el.dataset.stacking
  }

  open.forEach((el, i) => {
    const id = el.dataset.layerId
    const overlay = id ? document.querySelector<HTMLElement>(`[data-overlay-for="${id}"]`) : null
    if (overlay) overlay.dataset.level = String(i)
  })

  const root = document.querySelector<HTMLElement>("[data-modal-stack-root]")
  if (root) {
    if (open.length) root.dataset.modalDepth = String(Math.min(2, open.length))
    else delete root.dataset.modalDepth
  }
}

export function startModalStack() {
  if (started) return
  started = true
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-state"],
  })
  const ro = new ResizeObserver(schedule)
  new MutationObserver(() => {
    document.querySelectorAll<HTMLElement>(".modal-layer").forEach((el) => ro.observe(el))
  }).observe(document.body, { childList: true, subtree: true })
  window.addEventListener("resize", schedule)
  matchMedia(NARROW).addEventListener("change", schedule)
}
