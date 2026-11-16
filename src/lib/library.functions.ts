import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";

import { DEMO_TRACKS } from "./demo-library";
import type { LibraryResponse } from "./studio-types";

export const getLibrary = createServerFn({ method: "GET" }).handler(async (): Promise<LibraryResponse> => {
  const { getAzuraConfig, fetchAzuraLibrary } = await import("./azuracast.server");
  const cfg = getAzuraConfig();
  if (!cfg) {
    return { mode: "demo", stationName: "Demo station", tracks: DEMO_TRACKS };
  }
  try {
    const { stationName, tracks } = await fetchAzuraLibrary(cfg);
    return { mode: "live", stationName, tracks };
  } catch (err) {
    console.error("AzuraCast library fetch failed", err);
    return {
      mode: "demo",
      stationName: "Demo station",
      tracks: DEMO_TRACKS,
      error: err instanceof Error ? err.message : "Could not reach AzuraCast",
    };
  }
});

export const libraryQueryOptions = () =>
  queryOptions({
    queryKey: ["library"],
    queryFn: () => getLibrary(),
    staleTime: 5 * 60 * 1000,
  });
