import { mapAzuraMedia } from "./studio-logic";
import type { Track } from "./studio-types";

export type AzuraConfig = { baseUrl: string; apiKey: string; station: string };

/** Reads the AzuraCast connection from server secrets. Returns null when not configured. */
export function getAzuraConfig(): AzuraConfig | null {
  const baseUrl = (process.env["AZURACAST_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env["AZURACAST_API_KEY"] ?? "").trim();
  const station = (process.env["AZURACAST_STATION_ID"] ?? "").trim();
  if (!baseUrl || !apiKey || !station) return null;
  if (!/^https?:\/\//i.test(baseUrl)) return null;
  return { baseUrl, apiKey, station };
}

function stationPath(cfg: AzuraConfig) {
  return `${cfg.baseUrl}/api/station/${encodeURIComponent(cfg.station)}`;
}

export async function fetchAzuraLibrary(cfg: AzuraConfig): Promise<{ stationName: string; tracks: Track[] }> {
  const headers = { "X-API-Key": cfg.apiKey, Accept: "application/json" };
  const [filesRes, stationRes] = await Promise.all([
    fetch(`${stationPath(cfg)}/files`, { headers }),
    fetch(stationPath(cfg), { headers }).catch(() => null),
  ]);
  if (!filesRes.ok) {
    throw new Error(`AzuraCast returned ${filesRes.status} for the media library`);
  }
  const data: unknown = await filesRes.json();
  const tracks = (Array.isArray(data) ? data : [])
    .map(mapAzuraMedia)
    .filter((t): t is Track => t !== null);

  let stationName = `Station ${cfg.station}`;
  if (stationRes?.ok) {
    const s = (await stationRes.json().catch(() => null)) as { name?: unknown } | null;
    if (s && typeof s.name === "string" && s.name.trim()) stationName = s.name.trim();
  }
  return { stationName, tracks };
}

export function azuraPlayUrl(cfg: AzuraConfig, mediaId: number): string {
  return `${stationPath(cfg)}/file/${mediaId}/play`;
}
