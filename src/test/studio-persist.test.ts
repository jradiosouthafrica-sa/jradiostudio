import { describe, expect, it } from "vitest";

import { crossfaderLocked, CROSSFADER_CENTRE } from "@/lib/studio-logic";
import { parseSavedStudio, type SavedStudio } from "@/lib/studio-persist";
import type { Track } from "@/lib/studio-types";

const track = (id: string): Track => ({
  id,
  source: "azuracast",
  title: `Song ${id}`,
  artist: "Artist",
  album: "",
  genre: "",
  duration: 200,
  art: null,
  playlists: [],
  path: `weekend/${id}.mp3`,
});

describe("crossfader lock for To end", () => {
  it("locks in the centre while either deck stops at the end", () => {
    expect(CROSSFADER_CENTRE).toBe(0);
    expect(crossfaderLocked({ A: { stopAtEnd: true }, B: { stopAtEnd: false } })).toBe(true);
    expect(crossfaderLocked({ A: { stopAtEnd: false }, B: { stopAtEnd: true } })).toBe(true);
  });
  it("is free again when no deck stops at the end", () => {
    expect(crossfaderLocked({ A: { stopAtEnd: false }, B: { stopAtEnd: false } })).toBe(false);
  });
});

describe("saved studio", () => {
  const saved: SavedStudio = {
    queue: [
      { uid: "q1", track: track("az-1") },
      { uid: "q2", track: track("az-2") },
    ],
    decks: { A: { track: track("az-7"), position: 63.5 }, B: null },
    levels: { A: 0.5, B: 0.7, mic: 1, master: 0.8 },
    crossfader: 0.25,
    autoDj: false,
    duck: false,
  };

  it("brings back the running order in order, the decks and the mixer", () => {
    expect(parseSavedStudio(JSON.stringify(saved))).toEqual(saved);
  });

  it("starts fresh when nothing is saved or the data is broken", () => {
    expect(parseSavedStudio(null)).toBeNull();
    expect(parseSavedStudio("{not json")).toBeNull();
  });

  it("drops saved tracks whose id could point the audio player elsewhere", () => {
    const bad = {
      ...saved,
      queue: [{ uid: "x", track: { ...track("az-1"), id: "https://evil.example" } }],
      decks: { A: { track: { ...track("az-1"), id: "az-1/../admin" }, position: 3 }, B: null },
    };
    const out = parseSavedStudio(JSON.stringify(bad));
    expect(out?.queue).toEqual([]);
    expect(out?.decks.A).toBeNull();
  });
});
