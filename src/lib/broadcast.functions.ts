import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const azuraLiveInput = z.object({ password: z.string().min(1).max(200) });

export type AzuraLiveResult =
  | { ok: true; url: string; user: string; djPassword: string }
  | { ok: false; reason: "not_configured" | "wrong_password" };

/** Checks the studio password, then hands back the AzuraCast DJ login for the browser broadcaster. */
export const getAzuraLiveLogin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => azuraLiveInput.parse(data))
  .handler(async ({ data }): Promise<AzuraLiveResult> => {
    const { passwordMatches } = await import("./broadcast.server");
    const studioPw = (process.env["STUDIO_PASSWORD"] ?? "").trim();
    const base = (process.env["AZURACAST_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
    const user = (process.env["AZURACAST_DJ_USER"] ?? "").trim();
    const djPassword = process.env["AZURACAST_DJ_PASSWORD"] ?? "";
    const shortcode = (process.env["AZURACAST_SHORTCODE"] ?? "j_radio").trim();
    if (!studioPw || !base || !user || !djPassword) return { ok: false, reason: "not_configured" };
    if (!passwordMatches(data.password, studioPw)) {
      await new Promise((r) => setTimeout(r, 600));
      return { ok: false, reason: "wrong_password" };
    }
    const url = base.replace(/^http/, "ws") + `/webdj/${shortcode}/`;
    return { ok: true, url, user, djPassword };
  });

export type AzuraOnAir = { isLive: boolean; streamer: string | null; listeners: number | null };

/** Asks AzuraCast whether a live DJ is actually on air right now (public now-playing data). */
export const getAzuraOnAir = createServerFn({ method: "GET" }).handler(async (): Promise<AzuraOnAir> => {
  const base = (process.env["AZURACAST_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const station = (process.env["AZURACAST_STATION_ID"] ?? "").trim();
  if (!base || !station) return { isLive: false, streamer: null, listeners: null };
  try {
    const res = await fetch(`${base}/api/nowplaying/${encodeURIComponent(station)}`);
    if (!res.ok) return { isLive: false, streamer: null, listeners: null };
    const j = (await res.json()) as { live?: { is_live?: boolean; streamer_name?: string }; listeners?: { current?: number } };
    return { isLive: !!j.live?.is_live, streamer: j.live?.streamer_name || null, listeners: j.listeners?.current ?? null };
  } catch {
    return { isLive: false, streamer: null, listeners: null };
  }
});
