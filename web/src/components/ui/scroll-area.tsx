import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * 项目唯一的滚动容器。自绘滚动条：轨道透明只画滑块，滑块离边 1px，默认 5px、悬停或拖动 7px，
 * 命中区 16px，两端各让出 16px 避开容器圆角。所有间距与粗细只在这里定义。
 */
function ScrollArea({
  className,
  viewportClassName,
  viewportRef,
  children,
  horizontal = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  horizontal?: boolean
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type="hover"
      scrollHideDelay={800}
      className={cn("relative flex min-h-0 flex-col overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn("min-h-0 w-full flex-1 rounded-[inherit] outline-none", viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      {horizontal && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      forceMount
      className={cn(
        "group/sb z-30 flex touch-none transition-opacity duration-300 select-none data-[state=hidden]:pointer-events-none data-[state=hidden]:opacity-0",
        orientation === "vertical" && "w-4 justify-end py-4 pr-px",
        orientation === "horizontal" && "h-4 flex-col justify-end px-4 pb-px",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative shrink-0 grow-0 rounded-full bg-(--scroll-thumb) transition-[flex-basis,background-color] duration-150 group-hover/sb:bg-(--scroll-thumb-active) group-active/sb:bg-(--scroll-thumb-active)",
          "basis-[5px] group-hover/sb:basis-[7px] group-active/sb:basis-[7px]"
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
