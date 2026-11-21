import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({ password: z.string().min(1).max(200) });
export type BroadcastTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "not_configured" | "wrong_password" };

export const getIcecastBroadcastToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }): Promise<BroadcastTokenResult> => {
    const { mintBroadcastToken, passwordMatches } = await import("./broadcast.server");
    const studioPassword = process.env["STUDIO_PASSWORD"] ?? "";
    const sourceHost = (process.env["ICECAST_HOST"] ?? "").trim();
    const sourcePassword = process.env["ICECAST_SOURCE_PASSWORD"] ?? "";
    const sourcePort = (process.env["ICECAST_PORT"] ?? "").trim();
    const mount = (process.env["ICECAST_MOUNT"] ?? "").trim();
    const tokenSecret = process.env["BROADCAST_TOKEN_SECRET"] || studioPassword;
    if (!studioPassword || !sourceHost || !sourcePassword || !Number.isInteger(Number(sourcePort)) || Number(sourcePort) < 1 || Number(sourcePort) > 65535 || !mount.startsWith("/") || !tokenSecret)
      return { ok: false, reason: "not_configured" };
    if (!passwordMatches(data.password, studioPassword)) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { ok: false, reason: "wrong_password" };
    }
    return { ok: true, token: mintBroadcastToken(tokenSecret) };
  });

export type AzuraOnAir = { isLive: boolean; streamer: string | null; listeners: number | null };
export const getAzuraOnAir = createServerFn({ method: "GET" }).handler(async (): Promise<AzuraOnAir> => {
  const base = (process.env["AZURACAST_BASE_URL"] ?? "").trim().replace(/\/+$/, "");
  const station = (process.env["AZURACAST_STATION_ID"] ?? "").trim();
  if (!base || !station) return { isLive: false, streamer: null, listeners: null };
  try {
    const res = await fetch(`${base}/api/nowplaying/${encodeURIComponent(station)}`);
    if (!res.ok) return { isLive: false, streamer: null, listeners: null };
    const json = (await res.json()) as { live?: { is_live?: boolean; streamer_name?: string }; listeners?: { current?: number } };
    return { isLive: !!json.live?.is_live, streamer: json.live?.streamer_name || null, listeners: json.listeners?.current ?? null };
  } catch {
    return { isLive: false, streamer: null, listeners: null };
  }
});
