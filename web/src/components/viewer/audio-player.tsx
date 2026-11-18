import * as React from "react"
import { IconPlayerPauseFilled, IconPlayerPlayFilled } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import { formatDuration, waveform } from "@/lib/format"
import { cn } from "@/lib/utils"

export type MediaHandle = { seek: (t: number, play?: boolean) => void }

/** 自绘音频播放器：波形即进度条，点击或拖动波形定位。 */
export const AudioPlayer = React.forwardRef<
  MediaHandle,
  { src: string; seed: number; duration?: number; startAt?: number | null; onTime?: (t: number) => void }
>(function AudioPlayer({ src, seed, duration: hint, startAt, onTime }, ref) {
  const audio = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(startAt ?? 0)
  const [duration, setDuration] = React.useState(hint ?? 0)
  const bars = React.useMemo(() => waveform(seed, 96), [seed])
  const scrub = React.useRef(false)

  React.useImperativeHandle(ref, () => ({
    seek: (t, play = true) => {
      const a = audio.current
      if (!a) return
      a.currentTime = t
      setTime(t)
      if (play) void a.play()
    },
  }))

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (duration || 0)
    if (audio.current) audio.current.currentTime = t
    setTime(t)
  }

  const progress = duration ? time / duration : 0

  return (
    <div className="rounded-2xl bg-linear-to-br from-kind-audio/16 via-kind-audio/6 to-transparent p-4 ring-1 ring-kind-audio/15">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || hint || 0)
          if (startAt) e.currentTarget.currentTime = startAt
        }}
        onTimeUpdate={(e) => {
          if (scrub.current) return
          setTime(e.currentTarget.currentTime)
          onTime?.(e.currentTarget.currentTime)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-4">
        <Button
          size="icon"
          className="size-12 shrink-0 rounded-full bg-kind-audio text-white shadow-lg shadow-kind-audio/25 hover:bg-kind-audio/90 dark:text-black"
          onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <IconPlayerPauseFilled className="size-5" /> : <IconPlayerPlayFilled className="size-5" />}
        </Button>
        <div className="min-w-0 flex-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label="播放进度"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            onKeyDown={(e) => {
              const a = audio.current
              if (!a) return
              if (e.key === "ArrowRight") a.currentTime = Math.min(duration, a.currentTime + 5)
              if (e.key === "ArrowLeft") a.currentTime = Math.max(0, a.currentTime - 5)
            }}
            onPointerDown={(e) => {
              scrub.current = true
              e.currentTarget.setPointerCapture(e.pointerId)
              seekFromEvent(e)
            }}
            onPointerMove={(e) => scrub.current && seekFromEvent(e)}
            onPointerUp={() => (scrub.current = false)}
            className="flex h-14 touch-none items-center gap-[2px] rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {bars.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors duration-150",
                  i / bars.length < progress ? "bg-kind-audio" : "bg-kind-audio/25"
                )}
                style={{ height: `${h * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
            <span>{formatDuration(time)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      </div>
    </div>
  )
})
