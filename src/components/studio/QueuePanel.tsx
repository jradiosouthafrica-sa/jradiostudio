import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FastForward, ListMusic, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { formatTime, queueStartTimes } from "@/lib/studio-logic";
import { TrackArt } from "./TrackArt";
import { useStudio, useStudioActions } from "./studio-context";

function useSecondsUntilFree() {
  const { decks } = useStudio();
  const { getPosition } = useStudioActions();
  const [state, setState] = useState({ now: 0, secs: 0 });
  useEffect(() => {
    const calc = () => {
      let secs = 0;
      (["A", "B"] as const).forEach((d) => {
        if (decks[d].playing) {
          const p = getPosition(d);
          secs = Math.max(secs, p.duration - p.current - 8);
        }
      });
      setState({ now: Date.now(), secs });
    };
    calc();
    const id = window.setInterval(calc, 1000);
    return () => window.clearInterval(id);
  }, [decks, getPosition]);
  return state;
}

const clockFmt = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function QueuePanel() {
  const { queue, autoDj } = useStudio();
  const actions = useStudioActions();
  const { now, secs } = useSecondsUntilFree();
  const starts = now ? queueStartTimes(now, secs, queue.map((q) => q.track.duration)) : [];
  const total = queue.reduce((t, q) => t + q.track.duration, 0);

  return (
    <aside aria-label="Running order" className="console-panel flex min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-primary" />
          <span className="console-label">Running order</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Auto DJ
          <Switch checked={autoDj} onCheckedChange={actions.setAutoDj} aria-label="Auto DJ" />
        </label>
      </header>

      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {queue.length} {queue.length === 1 ? "track" : "tracks"} · {formatTime(total)}
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={actions.playNext} disabled={!queue.length}>
            <FastForward /> Next
          </Button>
          <Button size="sm" variant="ghost" onClick={actions.clearQueue} disabled={!queue.length} aria-label="Clear running order">
            <Trash2 />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {queue.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Nothing queued</p>
            <p className="mt-1">
              Add tracks from the music library. With Auto DJ on, each one crossfades in as the previous track ends.
            </p>
          </div>
        ) : (
          <ol className="space-y-1 px-2 pb-2">
            {queue.map((item, i) => (
              <li
                key={item.uid}
                className="group flex items-center gap-2 rounded-md border border-transparent bg-panel-raised/60 p-1.5 hover:border-border"
              >
                <span className="w-9 shrink-0 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
                  {starts[i] ? clockFmt(starts[i]) : "--:--"}
                </span>
                <TrackArt track={item.track} className="h-8 w-8" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-tight">{item.track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.track.artist} · {formatTime(item.track.duration)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col opacity-60 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => actions.moveInQueue(item.uid, -1)}
                    className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={i === queue.length - 1}
                    onClick={() => actions.moveInQueue(item.uid, 1)}
                    className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${item.track.title}`}
                  onClick={() => actions.removeFromQueue(item.uid)}
                  className="rounded p-1 text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </ScrollArea>
    </aside>
  );
}
