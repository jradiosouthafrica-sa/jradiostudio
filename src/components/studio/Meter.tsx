import { useEffect, useRef } from "react";

import type { MeterChannel } from "@/lib/audio-engine";
import { cn } from "@/lib/utils";
import { useStudioActions } from "./studio-context";

const SEGMENTS = 18;

function segColor(i: number) {
  const f = (i + 1) / SEGMENTS;
  if (f > 0.88) return "bg-meter-high";
  if (f > 0.7) return "bg-meter-mid";
  return "bg-meter-low";
}

/** Vertical LED peak meter driven straight from the audio engine (no React re-renders). */
export function Meter({ channel, className }: { channel: MeterChannel; className?: string }) {
  const { meter } = useStudioActions();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let shown = 0;
    let peak = 0;
    let peakHold = 0;
    const tick = () => {
      const lvl = meter(channel);
      shown = lvl > shown ? lvl : shown * 0.9 + lvl * 0.1 - 0.008;
      if (shown < 0) shown = 0;
      if (lvl >= peak) {
        peak = lvl;
        peakHold = 40;
      } else if (peakHold > 0) peakHold--;
      else peak = Math.max(0, peak - 0.01);
      const lit = Math.round(shown * SEGMENTS);
      const peakSeg = Math.min(SEGMENTS - 1, Math.round(peak * SEGMENTS) - 1);
      const kids = ref.current?.children;
      if (kids) {
        for (let i = 0; i < kids.length; i++) {
          const seg = SEGMENTS - 1 - i; // DOM top = loudest
          (kids[i] as HTMLElement).dataset.on = seg < lit || seg === peakSeg ? "1" : "0";
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [channel, meter]);

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("flex h-full w-2.5 flex-col gap-[2px] rounded-sm bg-groove p-[2px]", className)}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <div
          key={i}
          data-on="0"
          className={cn(
            "min-h-0 flex-1 rounded-[1px] transition-opacity duration-75 data-[on=0]:bg-meter-off",
            segColor(SEGMENTS - 1 - i),
          )}
        />
      ))}
    </div>
  );
}
