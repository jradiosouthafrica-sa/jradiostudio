import { parseTrackId } from "./studio-logic";
import type { DeckId, QueueItem, Track } from "./studio-types";

/** Browser storage key for the presenter's studio (running order, decks, mixer). */
export const STUDIO_STORAGE_KEY = "airdesk.studio.v1";

export type SavedDeck = { track: Track; position: number };

export type SavedStudio = {
  queue: QueueItem[];
  decks: Record<DeckId, SavedDeck | null>;
  levels: { A: number; B: number; mic: number; master: number };
  crossfader: number;
  autoDj: boolean;
  duck: boolean;
};

const clamp = (n: unknown, lo: number, hi: number, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Rebuilds a track from storage; drops anything whose id the audio proxy would refuse. */
export function parseSavedTrack(raw: unknown): Track | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const id = text(t["id"]);
  const parsed = parseTrackId(id);
  if (!parsed) return null;
  return {
    id,
    source: parsed.source,
    title: text(t["title"]) || id,
    artist: text(t["artist"]) || "Unknown artist",
    album: text(t["album"]),
    genre: text(t["genre"]),
    duration: clamp(t["duration"], 0, 86_400, 0),
    art: typeof t["art"] === "string" && t["art"] ? t["art"] : null,
    playlists: Array.isArray(t["playlists"])
      ? t["playlists"].filter((p): p is string => typeof p === "string")
      : [],
    path: text(t["path"]),
  };
}

function parseDeck(raw: unknown): SavedDeck | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const track = parseSavedTrack(d["track"]);
  if (!track) return null;
  return { track, position: clamp(d["position"], 0, 86_400, 0) };
}

/** Reads what the studio saved last time. Returns null for missing or unreadable data. */
export function parseSavedStudio(raw: string | null): SavedStudio | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const s = data as Record<string, unknown>;
  const queue: QueueItem[] = [];
  if (Array.isArray(s["queue"])) {
    s["queue"].forEach((item, i) => {
      const q = (item ?? {}) as Record<string, unknown>;
      const track = parseSavedTrack(q["track"]);
      if (!track) return;
      const uid = text(q["uid"]) || `r${i}`;
      queue.push({ uid: queue.some((x) => x.uid === uid) ? `${uid}-${i}` : uid, track });
    });
  }
  const decks = (s["decks"] ?? {}) as Record<string, unknown>;
  const levels = (s["levels"] ?? {}) as Record<string, unknown>;
  return {
    queue,
    decks: { A: parseDeck(decks["A"]), B: parseDeck(decks["B"]) },
    levels: {
      A: clamp(levels["A"], 0, 1, 0.85),
      B: clamp(levels["B"], 0, 1, 0.85),
      mic: clamp(levels["mic"], 0, 1, 0.9),
      master: clamp(levels["master"], 0, 1, 0.9),
    },
    crossfader: clamp(s["crossfader"], -1, 1, -1),
    autoDj: typeof s["autoDj"] === "boolean" ? s["autoDj"] : true,
    duck: typeof s["duck"] === "boolean" ? s["duck"] : true,
  };
}
