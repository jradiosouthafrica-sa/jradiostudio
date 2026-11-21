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

export type DeckSnapshot = {
  playing: boolean;
  remaining: number;
  hasTrack: boolean;
  /** A track is loaded, paused at (or near) its start and hasn't finished — ready to go. */
  cued: boolean;
  /** Presenter pressed "Play to end": this deck finishes its song and stops, nothing follows. */
  stopAtEnd?: boolean;
};

export type AutoTransition = { from: DeckId; to: DeckId; source: "deck" | "queue" };

/**
 * Decides whether Auto DJ should start the next track now.
 * Fires when exactly one deck is playing and it is within the crossfade window.
 * A track the presenter loaded by hand onto the free deck plays first ("deck");
 * otherwise the next running-order track is loaded onto the free deck ("queue").
 */
export function pickAutoTransition(input: {
  autoDj: boolean;
  transitioning: boolean;
  queueLength: number;
  decks: Record<DeckId, DeckSnapshot>;
  crossfadeSeconds?: number;
}): AutoTransition | null {
  const window = input.crossfadeSeconds ?? AUTO_CROSSFADE_SECONDS;
  if (!input.autoDj || input.transitioning) return null;
  const { A, B } = input.decks;
  if (A.playing && B.playing) return null;
  const from: DeckId | null = A.playing ? "A" : B.playing ? "B" : null;
  if (!from) return null;
  const cur = input.decks[from];
  if (cur.stopAtEnd) return null;
  if (cur.remaining > window) return null;
  const to = otherDeck(from);
  if (input.decks[to].cued) return { from, to, source: "deck" };
  if (input.queueLength > 0) return { from, to, source: "queue" };
  return null;
}

/** Wait before reconnecting to AzuraCast: 1s, 2s, 4s, 8s, then every 10s. */
export function reconnectDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(10_000, 1000 * 2 ** Math.min(n, 4));
}

/**
 * Once a broadcast has been live, keep reconnecting until the presenter ends it.
 * A first connection that never got through gives up after 3 tries (likely a wrong login).
 */
export function shouldReconnect(everLive: boolean, failedAttempts: number): boolean {
  return everLive || failedAttempts < 3;
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
  const m = raw as {
    id?: unknown;
    path?: unknown;
    title?: unknown;
    artist?: unknown;
    album?: unknown;
    genre?: unknown;
    length?: unknown;
    art?: unknown;
    links?: unknown;
    playlists?: unknown;
  };
  const id = typeof m.id === "number" ? m.id : Number(m.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const path = str(m.path);
  const length = typeof m.length === "number" ? m.length : Number(m.length);
  const links = (m.links ?? {}) as { art?: unknown };
  const art = str(m.art) || str(links.art) || null;
  const playlists = Array.isArray(m.playlists)
    ? m.playlists
        .map((p) => (p && typeof p === "object" ? str((p as { name?: unknown }).name) : ""))
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
export function queueStartTimes(
  now: number,
  secondsUntilFree: number,
  durations: number[],
): number[] {
  const out: number[] = [];
  let t = now + Math.max(0, secondsUntilFree) * 1000;
  for (const d of durations) {
    out.push(t);
    t += Math.max(0, d - AUTO_CROSSFADE_SECONDS) * 1000;
  }
  return out;
}

/** The folder a library file sits in ("" for the top level). */
export function trackFolder(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** True when the track is in the folder or any of its sub-folders. */
export function isInFolder(path: string, folder: string): boolean {
  const dir = trackFolder(path);
  if (folder === "") return dir === "";
  return dir === folder || dir.startsWith(`${folder}/`);
}

/** Every folder (including parent folders) with how many tracks it holds, sorted by name. */
export function listFolders(paths: string[]): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of paths) {
    const dir = trackFolder(p);
    if (dir === "") {
      counts.set("", (counts.get("") ?? 0) + 1);
      continue;
    }
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const f = parts.slice(0, i).join("/");
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([folder, count]) => ({ folder, count })).sort((a, b) =>
    a.folder.localeCompare(b.folder, undefined, { sensitivity: "base", numeric: true }),
  );
}

/** Sorts tracks in file-name order, the way they sit in the folder. */
export function sortByPath<T extends { path: string }>(tracks: T[]): T[] {
  return [...tracks].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true }),
  );
}

/** Crossfader position used while a deck plays "To end": dead centre, both decks equal. */
export const CROSSFADER_CENTRE = 0;

/** While any deck is set to stop at the end, the crossfader is held in the centre. */
export function crossfaderLocked(decks: Record<DeckId, { stopAtEnd: boolean }>): boolean {
  return decks.A.stopAtEnd || decks.B.stopAtEnd;
}
