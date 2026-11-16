import { Mic, MicOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { MeterChannel } from "@/lib/audio-engine";
import { cn } from "@/lib/utils";
import { Fader } from "./Fader";
import { Meter } from "./Meter";
import { useStudio, useStudioActions, type LevelChannel } from "./studio-context";

function toDb(v: number) {
  if (v <= 0.001) return "-∞";
  const db = 20 * Math.log10(v);
  return `${db > 0 ? "+" : ""}${db.toFixed(0)}`;
}

function Strip({
  channel,
  meter,
  label,
  labelClass,
}: {
  channel: LevelChannel;
  meter: MeterChannel;
  label: string;
  labelClass: string;
}) {
  const { levels } = useStudio();
  const { setLevel } = useStudioActions();
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={cn("console-label", labelClass)}>{label}</span>
      <div className="flex h-44 items-stretch gap-1.5">
        <Meter channel={meter} />
        <Fader label={`${label} level`} value={levels[channel]} onChange={(v) => setLevel(channel, v)} />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{toDb(levels[channel])} dB</span>
    </div>
  );
}

export function MixerPanel() {
  const { crossfader, micOpen, duck, transitioning } = useStudio();
  const { setCrossfader, toggleMic, setDuck } = useStudioActions();

  return (
    <section aria-label="Mixer" className="console-panel flex flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <span className="console-label text-muted-foreground">Mixer</span>
        <span className="console-label text-muted-foreground/70">Local preview</span>
      </header>

      <div className="flex justify-between gap-3 px-1">
        <Strip channel="A" meter="A" label="Deck A" labelClass="text-deck-a" />
        <Strip channel="B" meter="B" label="Deck B" labelClass="text-deck-b" />
        <Strip channel="mic" meter="mic" label="Mic" labelClass="text-mic" />
        <div className="w-px self-stretch bg-border" />
        <Strip channel="master" meter="program" label="Program" labelClass="text-primary" />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={toggleMic}
          aria-pressed={micOpen}
          className={cn(
            "flex-1 font-display text-sm font-bold uppercase tracking-widest",
            micOpen
              ? "glow-on-air bg-on-air text-on-air-foreground hover:bg-on-air/90"
              : "bg-secondary text-secondary-foreground hover:bg-accent",
          )}
        >
          {micOpen ? <Mic /> : <MicOff />}
          {micOpen ? "Mic live" : "Open mic"}
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={duck} onCheckedChange={setDuck} aria-label="Duck music under mic" />
          Duck
        </label>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="console-label text-deck-a">A</span>
          <span className="console-label text-muted-foreground">
            Crossfader{transitioning ? " · fading" : ""}
          </span>
          <span className="console-label text-deck-b">B</span>
        </div>
        <Fader
          label="Crossfader"
          orientation="horizontal"
          min={-1}
          max={1}
          value={crossfader}
          onChange={setCrossfader}
        />
      </div>
    </section>
  );
}
