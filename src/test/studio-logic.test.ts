import { describe, expect, it } from "vitest";

import {
  crossfadeGains,
  mapAzuraMedia,
  parseTrackId,
  pickAutoTransition,
  queueStartTimes,
} from "@/lib/studio-logic";

describe("parseTrackId", () => {
  it("accepts AzuraCast and demo ids", () => {
    expect(parseTrackId("az-123")).toEqual({ source: "azuracast", num: 123 });
    expect(parseTrackId("demo-4")).toEqual({ source: "demo", num: 4 });
  });
  it("rejects anything that could reach another URL", () => {
    expect(parseTrackId("az-1/../../admin")).toBeNull();
    expect(parseTrackId("https://evil.example")).toBeNull();
    expect(parseTrackId("az-0")).toBeNull();
  });
});

describe("crossfadeGains", () => {
  it("is full A at the left, full B at the right", () => {
    expect(crossfadeGains(-1)).toEqual({ A: 1, B: 0 });
    expect(crossfadeGains(1).B).toBe(1);
    expect(crossfadeGains(1).A).toBeCloseTo(0, 5);
  });
  it("keeps equal power in the centre", () => {
    const g = crossfadeGains(0);
    expect(g.A).toBeCloseTo(0.7071, 3);
    expect(g.B).toBeCloseTo(0.7071, 3);
  });
});

describe("pickAutoTransition", () => {
  const idle = { playing: false, remaining: 0, hasTrack: false };
  it("starts the next track on the free deck inside the 8 second window", () => {
    expect(
      pickAutoTransition({
        autoDj: true,
        transitioning: false,
        queueLength: 1,
        decks: { A: { playing: true, remaining: 7.5, hasTrack: true }, B: idle },
      }),
    ).toEqual({ from: "A", to: "B" });
  });
  it("waits while more than 8 seconds remain", () => {
    expect(
      pickAutoTransition({
        autoDj: true,
        transitioning: false,
        queueLength: 1,
        decks: { A: { playing: true, remaining: 9, hasTrack: true }, B: idle },
      }),
    ).toBeNull();
  });
  it("does nothing when Auto DJ is off or the queue is empty", () => {
    const decks = { A: { playing: true, remaining: 2, hasTrack: true }, B: idle };
    expect(pickAutoTransition({ autoDj: false, transitioning: false, queueLength: 3, decks })).toBeNull();
    expect(pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 0, decks })).toBeNull();
  });
});

describe("mapAzuraMedia", () => {
  it("maps an AzuraCast file into a track", () => {
    const t = mapAzuraMedia({
      id: 42,
      path: "music/artist - song.mp3",
      title: "Song",
      artist: "Artist",
      album: "LP",
      length: 215.4,
      art: "https://radio.example/api/station/1/art/abc",
      playlists: [{ id: 1, name: "Daytime" }],
    });
    expect(t).toMatchObject({ id: "az-42", title: "Song", artist: "Artist", duration: 215.4, playlists: ["Daytime"] });
  });
  it("falls back to the file name when the title is missing", () => {
    expect(mapAzuraMedia({ id: 7, path: "music/Intro Jingle.mp3" })?.title).toBe("Intro Jingle");
  });
});

describe("queueStartTimes", () => {
  it("overlaps each queued track by the crossfade", () => {
    expect(queueStartTimes(0, 10, [68, 100])).toEqual([10_000, 70_000]);
  });
});
