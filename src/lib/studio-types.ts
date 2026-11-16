export type TrackSource = "azuracast" | "demo";

export type Track = {
  /** "az-<mediaId>" for AzuraCast files, "demo-<n>" for the built-in demo library */
  id: string;
  source: TrackSource;
  title: string;
  artist: string;
  album: string;
  genre: string;
  /** seconds, 0 when unknown */
  duration: number;
  art: string | null;
  playlists: string[];
  path: string;
};

export type LibraryResponse = {
  mode: "live" | "demo";
  stationName: string;
  tracks: Track[];
  /** set when AzuraCast is configured but could not be reached */
  error?: string;
};

export type DeckId = "A" | "B";

export type QueueItem = { uid: string; track: Track };
