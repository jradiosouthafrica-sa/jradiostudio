import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { StudioEngine, type MeterChannel } from "@/lib/audio-engine";
import { AUTO_CROSSFADE_SECONDS, otherDeck, pickAutoTransition } from "@/lib/studio-logic";
import type { DeckId, QueueItem, Track } from "@/lib/studio-types";

export type DeckState = {
  track: Track | null;
  playing: boolean;
  loading: boolean;
  duration: number;
  error: string | null;
  /** "Play to end" is on: the deck stops when its song ends and Auto DJ doesn't alternate. */
  stopAtEnd: boolean;
};

export type LevelChannel = DeckId | "mic" | "master";

type StudioState = {
  decks: Record<DeckId, DeckState>;
  levels: Record<LevelChannel, number>;
  crossfader: number;
  micOpen: boolean;
  duck: boolean;
  autoDj: boolean;
  transitioning: boolean;
  queue: QueueItem[];
};

type StudioActions = {
  loadTrack: (deck: DeckId, track: Track) => void;
  togglePlay: (deck: DeckId) => void;
  /** Starts the deck (if stopped) and makes it stop at the end of the song; pressed again while playing, cancels. */
  playToEnd: (deck: DeckId) => void;
  cue: (deck: DeckId) => void;
  eject: (deck: DeckId) => void;
  seek: (deck: DeckId, seconds: number) => void;
  setLevel: (channel: LevelChannel, value: number) => void;
  setCrossfader: (value: number) => void;
  toggleMic: () => void;
  setDuck: (on: boolean) => void;
  setAutoDj: (on: boolean) => void;
  addToQueue: (track: Track) => void;
  /** Adds several tracks at once, keeping their order (select all / whole folder). */
  addManyToQueue: (tracks: Track[], label?: string) => void;
  removeFromQueue: (uid: string) => void;
  moveInQueue: (uid: string, dir: -1 | 1) => void;
  clearQueue: () => void;
  playNext: () => void;
  /** Live playhead read straight from the audio element (no re-render). */
  getPosition: (deck: DeckId) => { current: number; duration: number };
  meter: (channel: MeterChannel) => number;
  /** The program feed (decks + mic) to send to the bridge. Creates the audio engine if needed. */
  getProgramStream: () => Promise<MediaStream>;
};

const emptyDeck: DeckState = {
  track: null,
  playing: false,
  loading: false,
  duration: 0,
  error: null,
  stopAtEnd: false,
};

const StateCtx = createContext<StudioState | null>(null);
const ActionsCtx = createContext<StudioActions | null>(null);

let uidCounter = 0;
const newUid = () => `q${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>({
    decks: { A: emptyDeck, B: emptyDeck },
    levels: { A: 0.85, B: 0.85, mic: 0.9, master: 0.9 },
    crossfader: -1,
    micOpen: false,
    duck: true,
    autoDj: true,
    transitioning: false,
    queue: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const engineRef = useRef<StudioEngine | null>(null);
  const fadeRaf = useRef<number | null>(null);
  /** Guards the gap between Auto DJ firing and the next deck actually starting. */
  const pendingRef = useRef(false);

  const patchDeck = useCallback((deck: DeckId, patch: Partial<DeckState>) => {
    setState((s) => ({ ...s, decks: { ...s.decks, [deck]: { ...s.decks[deck], ...patch } } }));
  }, []);

  const ensureEngine = useCallback((): StudioEngine => {
    if (engineRef.current) return engineRef.current;
    const engine = new StudioEngine();
    const s = stateRef.current;
    engine.setChannelLevel("A", s.levels.A);
    engine.setChannelLevel("B", s.levels.B);
    engine.setMicLevel(s.levels.mic);
    engine.setMaster(s.levels.master);
    engine.setCrossfader(s.crossfader);
    engine.setDucking(s.duck);
    (["A", "B"] as DeckId[]).forEach((deck) => {
      const el = engine.element(deck);
      el.addEventListener("play", () => patchDeck(deck, { playing: true }));
      el.addEventListener("pause", () => patchDeck(deck, { playing: false }));
      el.addEventListener("ended", () => patchDeck(deck, { playing: false, stopAtEnd: false }));
      el.addEventListener("waiting", () => patchDeck(deck, { loading: true }));
      el.addEventListener("canplay", () => patchDeck(deck, { loading: false, error: null }));
      el.addEventListener("loadedmetadata", () => {
        if (Number.isFinite(el.duration)) patchDeck(deck, { duration: el.duration });
      });
      el.addEventListener("error", () => {
        if (!el.getAttribute("src")) return;
        patchDeck(deck, { loading: false, playing: false, error: "Couldn't load this track" });
      });
    });
    engineRef.current = engine;
    return engine;
  }, [patchDeck]);

  const stopFade = () => {
    if (fadeRaf.current !== null) cancelAnimationFrame(fadeRaf.current);
    fadeRaf.current = null;
  };

  const animateCrossfader = useCallback((target: number, seconds: number) => {
    stopFade();
    const start = stateRef.current.crossfader;
    const t0 = performance.now();
    setState((s) => ({ ...s, transitioning: true }));
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      const v = start + (target - start) * k;
      engineRef.current?.setCrossfader(v);
      setState((s) => ({ ...s, crossfader: v, transitioning: k < 1 }));
      fadeRaf.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    fadeRaf.current = requestAnimationFrame(step);
  }, []);

  const loadTrack = useCallback(
    (deck: DeckId, track: Track) => {
      const engine = ensureEngine();
      engine.load(deck, `/api/audio/${encodeURIComponent(track.id)}`);
      patchDeck(deck, {
        track,
        playing: false,
        loading: true,
        duration: track.duration,
        error: null,
        stopAtEnd: false,
      });
    },
    [ensureEngine, patchDeck],
  );

  const play = useCallback(
    async (deck: DeckId) => {
      const engine = ensureEngine();
      try {
        await engine.play(deck);
      } catch (err) {
        console.error(err);
        toast.error(`Deck ${deck} couldn't start`, {
          description: "The track may still be loading. Try again.",
        });
      }
    },
    [ensureEngine],
  );

  /** Starts the deck and crossfades over to it. */
  const fadeInto = useCallback(
    (to: DeckId, fadeSeconds: number) => {
      pendingRef.current = true;
      void play(to).finally(() => {
        pendingRef.current = false;
        if (engineRef.current && !engineRef.current.element(to).paused) {
          animateCrossfader(to === "A" ? -1 : 1, fadeSeconds);
        }
      });
    },
    [animateCrossfader, play],
  );

  const startNext = useCallback(
    (to: DeckId, fadeSeconds: number) => {
      const [next, ...rest] = stateRef.current.queue;
      if (!next) return;
      setState((s) => ({ ...s, queue: rest }));
      loadTrack(to, next.track);
      fadeInto(to, fadeSeconds);
    },
    [fadeInto, loadTrack],
  );

  // Auto DJ: watch the playing deck and crossfade into the next queued track.
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      const s = stateRef.current;
      if (!engine || pendingRef.current) return;
      const snap = (deck: DeckId) => {
        const el = engine.element(deck);
        const dur = Number.isFinite(el.duration) ? el.duration : s.decks[deck].duration;
        return {
          playing: !el.paused && !el.ended,
          remaining: dur - el.currentTime,
          hasTrack: !!s.decks[deck].track,
          cued:
            !!s.decks[deck].track &&
            !s.decks[deck].error &&
            el.paused &&
            !el.ended &&
            el.currentTime < 1,
          stopAtEnd: s.decks[deck].stopAtEnd,
        };
      };
      const t = pickAutoTransition({
        autoDj: s.autoDj,
        transitioning: s.transitioning,
        queueLength: s.queue.length,
        decks: { A: snap("A"), B: snap("B") },
      });
      if (!t) return;
      const fade = Math.max(1, Math.min(AUTO_CROSSFADE_SECONDS, snap(t.from).remaining));
      if (t.source === "deck") fadeInto(t.to, fade);
      else startNext(t.to, fade);
    }, 250);
    return () => window.clearInterval(id);
  }, [fadeInto, startNext]);

  useEffect(() => () => stopFade(), []);

  const actions = useMemo<StudioActions>(
    () => ({
      loadTrack,
      togglePlay: (deck) => {
        const engine = ensureEngine();
        const el = engine.element(deck);
        if (!stateRef.current.decks[deck].track) return;
        if (el.paused) {
          patchDeck(deck, { stopAtEnd: false });
          void play(deck);
        } else engine.pause(deck);
      },
      playToEnd: (deck) => {
        const engine = ensureEngine();
        const el = engine.element(deck);
        const d = stateRef.current.decks[deck];
        if (!d.track || d.error) return;
        if (el.paused || el.ended) {
          patchDeck(deck, { stopAtEnd: true });
          void play(deck);
          return;
        }
        patchDeck(deck, { stopAtEnd: !d.stopAtEnd });
      },
      cue: (deck) => {
        const engine = ensureEngine();
        engine.pause(deck);
        engine.seek(deck, 0);
      },
      eject: (deck) => {
        engineRef.current?.unload(deck);
        patchDeck(deck, { ...emptyDeck });
      },
      seek: (deck, seconds) => engineRef.current?.seek(deck, seconds),
      setLevel: (channel, value) => {
        setState((s) => ({ ...s, levels: { ...s.levels, [channel]: value } }));
        const e = engineRef.current;
        if (!e) return;
        if (channel === "master") e.setMaster(value);
        else if (channel === "mic") e.setMicLevel(value);
        else e.setChannelLevel(channel, value);
      },
      setCrossfader: (value) => {
        stopFade();
        setState((s) => ({ ...s, crossfader: value, transitioning: false }));
        engineRef.current?.setCrossfader(value);
      },
      toggleMic: () => {
        const engine = ensureEngine();
        if (stateRef.current.micOpen) {
          engine.closeMic();
          setState((s) => ({ ...s, micOpen: false }));
          return;
        }
        engine
          .openMic()
          .then(() => setState((s) => ({ ...s, micOpen: true })))
          .catch((err) => {
            console.error(err);
            toast.error("Microphone unavailable", {
              description: "Allow microphone access in your browser, then try again.",
            });
          });
      },
      setDuck: (on) => {
        setState((s) => ({ ...s, duck: on }));
        engineRef.current?.setDucking(on);
      },
      setAutoDj: (on) => setState((s) => ({ ...s, autoDj: on })),
      addToQueue: (track) => {
        setState((s) => ({ ...s, queue: [...s.queue, { uid: newUid(), track }] }));
        toast.success("Added to running order", {
          description: `${track.artist} — ${track.title}`,
        });
      },
      addManyToQueue: (tracks, label) => {
        if (!tracks.length) return;
        setState((s) => ({
          ...s,
          queue: [...s.queue, ...tracks.map((track) => ({ uid: newUid(), track }))],
        }));
        toast.success(
          `Added ${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} to running order`,
          label ? { description: label } : undefined,
        );
      },
      removeFromQueue: (uid) =>
        setState((s) => ({ ...s, queue: s.queue.filter((q) => q.uid !== uid) })),
      moveInQueue: (uid, dir) =>
        setState((s) => {
          const i = s.queue.findIndex((q) => q.uid === uid);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.queue.length) return s;
          const q = [...s.queue];
          const a = q[i];
          const b = q[j];
          if (!a || !b) return s;
          q[i] = b;
          q[j] = a;
          return { ...s, queue: q };
        }),
      clearQueue: () => setState((s) => ({ ...s, queue: [] })),
      playNext: () => {
        const engine = ensureEngine();
        const s = stateRef.current;
        if (!s.queue.length) return;
        const aPlaying = !engine.element("A").paused;
        const bPlaying = !engine.element("B").paused;
        if (aPlaying && bPlaying) {
          toast.error("Both decks are on air", {
            description: "Stop one deck before starting the next track.",
          });
          return;
        }
        const from: DeckId | null = aPlaying ? "A" : bPlaying ? "B" : null;
        const to: DeckId = from ? otherDeck(from) : s.crossfader <= 0 ? "A" : "B";
        startNext(to, from ? AUTO_CROSSFADE_SECONDS / 2 : 0.05);
      },
      getPosition: (deck) => {
        const el = engineRef.current?.element(deck);
        if (!el) return { current: 0, duration: stateRef.current.decks[deck].duration };
        const duration = Number.isFinite(el.duration)
          ? el.duration
          : stateRef.current.decks[deck].duration;
        return { current: el.currentTime, duration };
      },
      meter: (channel) => engineRef.current?.level(channel) ?? 0,
      getProgramStream: async () => {
        const engine = ensureEngine();
        await engine.resume();
        return engine.programStream;
      },
    }),
    [ensureEngine, loadTrack, patchDeck, play, startNext],
  );

  return (
    <ActionsCtx.Provider value={actions}>
      <StateCtx.Provider value={state}>{children}</StateCtx.Provider>
    </ActionsCtx.Provider>
  );
}

export function useStudio() {
  const s = useContext(StateCtx);
  if (!s) throw new Error("useStudio must be used inside StudioProvider");
  return s;
}

export function useStudioActions() {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error("useStudioActions must be used inside StudioProvider");
  return a;
}

/** Re-renders at ~10 fps with the deck's live playhead. */
export function useDeckClock(deck: DeckId, active: boolean) {
  const { getPosition } = useStudioActions();
  const [pos, setPos] = useState(() => getPosition(deck));
  useEffect(() => {
    setPos(getPosition(deck));
    if (!active) return;
    const id = window.setInterval(() => setPos(getPosition(deck)), 100);
    return () => window.clearInterval(id);
  }, [active, deck, getPosition]);
  return pos;
}
