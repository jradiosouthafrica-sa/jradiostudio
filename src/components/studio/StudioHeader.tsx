import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

import type { LibraryResponse } from "@/lib/studio-types";
import { cn } from "@/lib/utils";
import { AzuraLiveControl } from "./AzuraLiveControl";

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const fmt = (n: number) => String(n).padStart(2, "0");
  return (
    <span
      className="font-mono text-2xl font-semibold tabular-nums tracking-tight"
      aria-label="Studio clock"
    >
      {now
        ? `${fmt(now.getHours())}:${fmt(now.getMinutes())}:${fmt(now.getSeconds())}`
        : "--:--:--"}
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

      <AzuraLiveControl />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <StatusChip
          ok={library.mode === "live"}
          label="AzuraCast"
          value={library.mode === "live" ? `${library.tracks.length} tracks` : "Demo library"}
        />
        <Clock />
      </div>
    </header>
  );
}
