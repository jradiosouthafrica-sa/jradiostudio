import { useEffect, useState } from "react";
import { Radio, Server } from "lucide-react";

import type { LibraryResponse } from "@/lib/studio-types";
import { cn } from "@/lib/utils";
import { useStudio } from "./studio-context";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const fmt = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight" aria-label="Studio clock">
      {now ? `${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}` : "--:--:--"}
    </span>
  );
}

function StatusChip({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1">
      <span className={cn("h-2 w-2 rounded-full", ok ? "bg-meter-low" : "bg-meter-mid")} />
      <span className="console-label text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground">{value}</span>
    </div>
  );
}

export function StudioHeader({ library }: { library: LibraryResponse }) {
  const { micOpen, decks, crossfader } = useStudio();
  const musicOnAir =
    (decks.A.playing && crossfader < 0.95) || (decks.B.playing && crossfader > -0.95);

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-panel px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Radio className="h-4.5 w-4.5" />
        </div>
        <div className="leading-tight">
          <p className="font-display text-lg font-bold uppercase tracking-[0.18em]">AirDesk</p>
          <p className="text-xs text-muted-foreground">{library.stationName} · Presenter studio</p>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-1.5 font-display text-sm font-bold uppercase tracking-[0.2em] transition-colors",
          micOpen
            ? "glow-on-air border-on-air bg-on-air text-on-air-foreground"
            : musicOnAir
              ? "border-on-air/60 text-on-air"
              : "border-border text-muted-foreground",
        )}
        aria-live="polite"
      >
        <span className={cn("h-2 w-2 rounded-full", micOpen ? "bg-on-air-foreground" : musicOnAir ? "bg-on-air" : "bg-meter-off")} />
        {micOpen ? "Mic live" : musicOnAir ? "Music playing" : "Standby"}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <StatusChip
          ok={library.mode === "live"}
          label="AzuraCast"
          value={library.mode === "live" ? `${library.tracks.length} tracks` : "Demo library"}
        />
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-2.5 py-1">
          <Server className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="console-label text-muted-foreground">VPS mixer</span>
          <span className="text-xs text-muted-foreground">Not connected</span>
        </div>
        <Clock />
      </div>
    </header>
  );
}
