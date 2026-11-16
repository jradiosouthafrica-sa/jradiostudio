import type { Track } from "./studio-types";

// Free sample songs from soundhelix.com, used only until AzuraCast is connected.
const DURATIONS = [373, 426, 344, 303, 354, 280, 421, 325, 389, 527, 551, 514];
const PLAYLISTS = ["Daytime", "Evening", "Daytime", "Overnight", "Evening", "Daytime"];

export const DEMO_TRACKS: Track[] = DURATIONS.map((duration, i) => ({
  id: `demo-${i + 1}`,
  source: "demo",
  title: `SoundHelix Song ${i + 1}`,
  artist: "SoundHelix",
  album: "Sample library",
  genre: "Electronic",
  duration,
  art: null,
  playlists: [PLAYLISTS[i % PLAYLISTS.length]],
  path: `demo/SoundHelix-Song-${i + 1}.mp3`,
}));

export function demoAudioUrl(num: number): string | null {
  if (num < 1 || num > DEMO_TRACKS.length) return null;
  return `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${num}.mp3`;
}
