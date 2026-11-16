import { useMemo } from "react";
import { Eject, Loader2, Pause, Play, SkipBack } from "lucide-react";

import { Button } from "@/components/ui/button";
import { END_OF_TRACK_WARNING_SECONDS, formatTime } from "@/lib/studio-logic";
import type { DeckId } from "@/lib/studio-types";
import { cn } from "@/lib/utils";
import { TrackArt } from "./TrackArt";
import { useDeckClock, useStudio, useStudioActions } from "./studio-context";

const BARS = 72;

/** Decorative bar strip seeded from the track id, used as a clickable seek bar. */
function barHeights(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) + i;
    const r = ((h >>> 0) % 1000) / 1000;
    const env = Math.sin((i / BARS) * Math.PI) * 0.35 + 0.55;
    return Math.max(0.12, Math.min(1, env * (0.55 + r * 0.6)));
  });
}

export function Deck({ id }: { id: DeckId }) {
  const { decks, crossfader } = useStudio();
  const actions = useStudioActions();
  const deck = decks[id];
  const { current, duration } = useDeckClock(id, !!deck.track);
  const bars = useMemo(() => barHeights(deck.track?.id ?? "empty"), [deck.track?.id]);

  const remaining = Math.max(0, duration - current);
  const progress = duration > 0 ? current / duration : 0;
  const ending = deck.playing && remaining <= END_OF_TRACK_WARNING_SECONDS;
  const audible = id === "A" ? crossfader < 0.95 : crossfader > -0.95;
  const onAir = deck.playing && audible;

  const accent = id === "A" ? "text-deck-a" : "text-deck-b";
  const accentBg = id === "A" ? "bg-deck-a" : "bg-deck-b";
  const accentFg = id === "A" ? "text-deck-a-foreground" : "text-deck-b-foreground";

  const status = deck.error
    ? "Error"
    : !deck.track
      ? "Empty"
      : deck.loading && !deck.playing
        ? "Loading"
        : deck.playing
          ? onAir
            ? "On air"
            : "Playing · muted"
          : current > 0.5
            ? "Paused"
            : "Cued";

  return (
    <section aria-label={`Deck ${id}`} className="console-panel flex min-w-0 flex-col gap-3 p-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-sm px-1.5 py-0.5 font-display text-sm font-bold tracking-widest", accentBg, accentFg)}>
            {id}
          </span>
          <span className="console-label text-muted-foreground">Deck {id}</span>
        </div>
        <span
          className={cn(
            "console-label rounded-sm border px-2 py-0.5",
            onAir ? "border-on-air bg-on-air text-on-air-foreground" : "border-border text-muted-foreground",
            deck.error && "border-destructive text-destructive",
          )}
        >
          {status}
        </span>
      </header>

      <div className="flex min-w-0 items-center gap-3">
        <TrackArt track={deck.track} className="h-14 w-14" />
        <div className="min-w-0 flex-1">
          {deck.track ? (
            <>
              <p className="truncate text-base font-semibold leading-tight">{deck.track.title}</p>
              <p className="truncate text-sm text-muted-foreground">{deck.track.artist}</p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold leading-tight text-muted-foreground">No track loaded</p>
              <p className="text-sm text-muted-foreground/70">Load a track from the music library</p>
            </>
          )}
        </div>
        <div className="text-right">
          <p
            className={cn(
              "font-mono text-3xl font-semibold tabular-nums leading-none",
              ending ? "animate-eot text-on-air" : deck.track ? accent : "text-muted-foreground/50",
            )}
            aria-label="Time remaining"
          >
            -{formatTime(deck.track ? remaining : 0)}
          </p>
          <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(deck.track ? current : 0)} / {formatTime(deck.track ? duration : 0)}
          </p>
        </div>
      </div>

      <button
        type="button"
        aria-label={`Seek deck ${id}`}
        disabled={!deck.track}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          actions.seek(id, ((e.clientX - r.left) / r.width) * duration);
        }}
        className="group flex h-12 w-full items-center gap-[2px] rounded-sm bg-groove px-1.5 disabled:cursor-default"
      >
        {bars.map((h, i) => {
          const played = deck.track && i / BARS < progress;
          return (
            <span
              key={i}
              style={{ height: `${h * 100}%` }}
              className={cn(
                "min-w-0 flex-1 rounded-[1px]",
                !deck.track ? "bg-meter-off" : played ? accentBg : "bg-muted-foreground/30",
              )}
            />
          );
        })}
      </button>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => actions.cue(id)}
          disabled={!deck.track}
          aria-label={`Cue deck ${id} to start`}
        >
          <SkipBack /> Cue
        </Button>
        <Button
          size="sm"
          onClick={() => actions.togglePlay(id)}
          disabled={!deck.track || !!deck.error}
          className={cn("min-w-24", accentBg, accentFg, "hover:opacity-90", id === "A" ? "hover:bg-deck-a" : "hover:bg-deck-b")}
        >
          {deck.loading && !deck.playing ? <Loader2 className="animate-spin" /> : deck.playing ? <Pause /> : <Play />}
          {deck.playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => actions.eject(id)}
          disabled={!deck.track || deck.playing}
          aria-label={`Eject deck ${id}`}
          title={deck.playing ? "Stop the deck before ejecting" : "Eject"}
        >
          <Eject />
        </Button>
      </div>
    </section>
  );
}
