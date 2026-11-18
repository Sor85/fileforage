# web 约定

适用范围：`web/` 下的 WebUI。同时遵守根目录 `AGENTS.md`。后端接口与打分含义见 `backend/AGENTS.md`。

## 组件与图标

- React 19 + Tailwind v4 + shadcn（Radix 版，`components.json` 的 iconLibrary 为 tabler）。图标统一用 `@tabler/icons-react`。
- 不写任何 `cursor-*` 类或 `cursor:` 声明；用 shadcn CLI 新增组件后删除其中的 cursor 类（守卫测试会检查）。

## 滚动

- 所有滚动区只用 `components/ui/scroll-area.tsx`：轨道透明、滑块离边 1px、5px→7px、命中区 16px、两端让出 16px 圆角。间距只在该组件里定义，页面不覆盖。
- 不用 `overflow-auto/scroll` 暴露原生滚动条，不用 `::-webkit-scrollbar`；`scrollbar-color` 只在 `index.css` 的根元素声明一次。

## 模态窗口

- 统一用 `components/ui/modal.tsx`（三段式，窄屏为可下拉关闭的底部面板）与 `components/ui/confirm-dialog.tsx`（始终居中）。
- 层叠由 `lib/modal-stack.ts` 全局处理：只看 `.modal-layer` 的 `data-state`，用 WAAPI 把下层缩小上移，页面根 `[data-modal-stack-root]` 按层数虚化。进退场动画与窄屏样式写在 `index.css`。
- 文件详情 / 相似文件这类可连续打开的窗口放在 `lib/viewer.ts` 的窗口栈里：关闭某层会关闭其上所有层，先标记 `closing` 播完退场再卸载。

## 视觉

- 主题色、模态色（`--kind-*`）、阴影都在 `index.css` 的 CSS 变量里，深浅色分别定义；新增颜色同时补齐两套。
- 根容器 `.app-root` 与 `.modal-layer` 显式声明 14px / 1.5 的排版基线。
- UI 文案用陈述式，不用对话式或感叹语气。
