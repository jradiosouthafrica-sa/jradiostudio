import { describe, expect, it } from "vitest";

import {
  crossfadeGains,
  isInFolder,
  listFolders,
  mapAzuraMedia,
  parseTrackId,
  pickAutoTransition,
  reconnectDelayMs,
  shouldReconnect,
  queueStartTimes,
  sortByPath,
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
  const idle = { playing: false, remaining: 0, hasTrack: false, cued: false };
  it("starts the next track on the free deck inside the 8 second window", () => {
    expect(
      pickAutoTransition({
        autoDj: true,
        transitioning: false,
        queueLength: 1,
        decks: { A: { playing: true, remaining: 7.5, hasTrack: true, cued: false }, B: idle },
      }),
    ).toEqual({ from: "A", to: "B", source: "queue" });
  });
  it("waits while more than 8 seconds remain", () => {
    expect(
      pickAutoTransition({
        autoDj: true,
        transitioning: false,
        queueLength: 1,
        decks: { A: { playing: true, remaining: 9, hasTrack: true, cued: false }, B: idle },
      }),
    ).toBeNull();
  });
  it("does nothing when Auto DJ is off or the queue is empty", () => {
    const decks = { A: { playing: true, remaining: 2, hasTrack: true, cued: false }, B: idle };
    expect(pickAutoTransition({ autoDj: false, transitioning: false, queueLength: 3, decks })).toBeNull();
    expect(pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 0, decks })).toBeNull();
  });
});

describe("pickAutoTransition with hand-loaded decks", () => {
  const ending = { playing: true, remaining: 5, hasTrack: true, cued: false };
  const cued = { playing: false, remaining: 200, hasTrack: true, cued: true };
  it("crossfades into a track loaded by hand even when the running order is empty", () => {
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 0, decks: { A: ending, B: cued } }),
    ).toEqual({ from: "A", to: "B", source: "deck" });
  });
  it("plays the hand-loaded track before the running order", () => {
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 4, decks: { A: cued, B: ending } }),
    ).toEqual({ from: "B", to: "A", source: "deck" });
  });
  it("does not replay a track that already finished on the free deck", () => {
    const finished = { playing: false, remaining: 0, hasTrack: true, cued: false };
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 0, decks: { A: ending, B: finished } }),
    ).toBeNull();
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 1, decks: { A: ending, B: finished } }),
    ).toEqual({ from: "A", to: "B", source: "queue" });
  });
});

describe("Play to end", () => {
  const cued = { playing: false, remaining: 200, hasTrack: true, cued: true };
  it("does not alternate to a hand-loaded deck when the playing deck is set to stop at the end", () => {
    const ending = { playing: true, remaining: 3, hasTrack: true, cued: false, stopAtEnd: true };
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 0, decks: { A: ending, B: cued } }),
    ).toBeNull();
  });
  it("does not start the next running-order track either", () => {
    const ending = { playing: true, remaining: 3, hasTrack: true, cued: false, stopAtEnd: true };
    const idle = { playing: false, remaining: 0, hasTrack: false, cued: false };
    expect(
      pickAutoTransition({ autoDj: true, transitioning: false, queueLength: 5, decks: { A: idle, B: ending } }),
    ).toBeNull();
  });
});

describe("reconnecting to AzuraCast", () => {
  it("waits 1, 2, 4, 8 seconds, then every 10 seconds", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });
  it("keeps reconnecting forever once the broadcast has been live", () => {
    expect(shouldReconnect(true, 500)).toBe(true);
  });
  it("gives up after 3 failed tries if it never got on air", () => {
    expect(shouldReconnect(false, 2)).toBe(true);
    expect(shouldReconnect(false, 3)).toBe(false);
  });
});

describe("folders", () => {
  const paths = [
    "presenters/weekend/02 b.mp3",
    "presenters/weekend/01 a.mp3",
    "presenters/anthony/x.mp3",
    "jazz/y.mp3",
    "top.mp3",
  ];
  it("counts parent folders with their sub-folders", () => {
    expect(listFolders(paths)).toEqual([
      { folder: "", count: 1 },
      { folder: "jazz", count: 1 },
      { folder: "presenters", count: 3 },
      { folder: "presenters/anthony", count: 1 },
      { folder: "presenters/weekend", count: 2 },
    ]);
  });
  it("includes sub-folder tracks in a parent folder but not look-alike names", () => {
    expect(isInFolder("presenters/weekend/a.mp3", "presenters")).toBe(true);
    expect(isInFolder("presenters2/a.mp3", "presenters")).toBe(false);
    expect(isInFolder("top.mp3", "")).toBe(true);
    expect(isInFolder("jazz/y.mp3", "")).toBe(false);
  });
  it("adds a folder in file-name order", () => {
    expect(sortByPath(paths.slice(0, 2).map((path) => ({ path }))).map((t) => t.path)).toEqual([
      "presenters/weekend/01 a.mp3",
      "presenters/weekend/02 b.mp3",
    ]);
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
