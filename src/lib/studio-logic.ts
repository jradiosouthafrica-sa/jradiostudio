import type { DeckId, Track } from "./studio-types";

/** Seconds of overlap used when Auto DJ crossfades into the next queued track. */
export const AUTO_CROSSFADE_SECONDS = 8;
/** Remaining seconds at which a deck's countdown starts flashing. */
export const END_OF_TRACK_WARNING_SECONDS = 10;
/** Music level while the mic is open and talk-over ducking is on. */
export const DUCK_LEVEL = 0.3;

const TRACK_ID_RE = /^(demo|az)-(\d{1,10})$/;

/** Validates a track id from a URL so only demo/AzuraCast media ids are ever proxied. */
export function parseTrackId(id: string): { source: "demo" | "azuracast"; num: number } | null {
  const m = TRACK_ID_RE.exec(id);
  if (!m) return null;
  const num = Number(m[2]);
  if (!Number.isSafeInteger(num) || num < 1) return null;
  return { source: m[1] === "demo" ? "demo" : "azuracast", num };
}

/**
 * Equal-power crossfader. position: -1 = full Deck A, 0 = centre, +1 = full Deck B.
 */
export function crossfadeGains(position: number): { A: number; B: number } {
  const p = Math.min(1, Math.max(-1, position));
  const t = ((p + 1) / 2) * (Math.PI / 2);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { A: round(Math.cos(t)), B: round(Math.sin(t)) };
}

export function otherDeck(deck: DeckId): DeckId {
  return deck === "A" ? "B" : "A";
}

export type DeckSnapshot = { playing: boolean; remaining: number; hasTrack: boolean };

/**
 * Decides whether Auto DJ should start the next queued track now.
 * Fires when exactly one deck is playing, it is within the crossfade window,
 * the other deck is free, and something is queued.
 */
export function pickAutoTransition(input: {
  autoDj: boolean;
  transitioning: boolean;
  queueLength: number;
  decks: Record<DeckId, DeckSnapshot>;
  crossfadeSeconds?: number;
}): { from: DeckId; to: DeckId } | null {
  const window = input.crossfadeSeconds ?? AUTO_CROSSFADE_SECONDS;
  if (!input.autoDj || input.transitioning || input.queueLength === 0) return null;
  const { A, B } = input.decks;
  if (A.playing && B.playing) return null;
  const from: DeckId | null = A.playing ? "A" : B.playing ? "B" : null;
  if (!from) return null;
  const cur = input.decks[from];
  if (cur.remaining > window) return null;
  return { from, to: otherDeck(from) };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fileStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[a-z0-9]{2,5}$/i, "");
}

/** Maps one item from AzuraCast's GET /api/station/{id}/files into a studio Track. */
export function mapAzuraMedia(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = typeof m.id === "number" ? m.id : Number(m.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const path = str(m.path);
  const length = typeof m.length === "number" ? m.length : Number(m.length);
  const links = (m.links ?? {}) as Record<string, unknown>;
  const art = str(m.art) || str(links.art) || null;
  const playlists = Array.isArray(m.playlists)
    ? m.playlists
        .map((p) => (p && typeof p === "object" ? str((p as Record<string, unknown>).name) : ""))
        .filter(Boolean)
    : [];
  return {
    id: `az-${id}`,
    source: "azuracast",
    title: str(m.title) || fileStem(path) || `Track ${id}`,
    artist: str(m.artist) || "Unknown artist",
    album: str(m.album),
    genre: str(m.genre),
    duration: Number.isFinite(length) && length > 0 ? length : 0,
    art,
    playlists,
    path,
  };
}

/** Estimated on-air start time (ms epoch) for each queued track. */
export function queueStartTimes(now: number, secondsUntilFree: number, durations: number[]): number[] {
  const out: number[] = [];
  let t = now + Math.max(0, secondsUntilFree) * 1000;
  for (const d of durations) {
    out.push(t);
    t += Math.max(0, d - AUTO_CROSSFADE_SECONDS) * 1000;
  }
  return out;
}
