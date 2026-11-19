import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

export type BridgeStatus = { configured: boolean; host: string | null; room: string | null };

export const getBridgeStatus = createServerFn({ method: "GET" }).handler(async (): Promise<BridgeStatus> => {
  const { getBridgeConfig } = await import("./broadcast.server");
  const cfg = getBridgeConfig();
  const rawUrl = process.env["LIVEKIT_URL"] ?? "";
  let host: string | null = null;
  try {
    host = rawUrl ? new URL(rawUrl).host : null;
  } catch {
    host = null;
  }
  return { configured: !!cfg, host, room: cfg?.room ?? null };
});

export const bridgeStatusQueryOptions = () =>
  queryOptions({ queryKey: ["bridge-status"], queryFn: () => getBridgeStatus(), staleTime: 60_000 });

const joinInput = z.object({
  name: z.string().trim().min(1, "Enter your presenter name").max(60),
  password: z.string().min(1).max(200),
});

export type JoinResult =
  | { ok: true; url: string; token: string; room: string; identity: string }
  | { ok: false; reason: "not_configured" | "wrong_password" };

export const joinBroadcast = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => joinInput.parse(data))
  .handler(async ({ data }): Promise<JoinResult> => {
    const { getBridgeConfig, passwordMatches, presenterIdentity, mintPresenterToken } = await import(
      "./broadcast.server"
    );
    const cfg = getBridgeConfig();
    if (!cfg) return { ok: false, reason: "not_configured" };
    if (!passwordMatches(data.password, cfg.password)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return { ok: false, reason: "wrong_password" };
    }
    const identity = presenterIdentity(data.name);
    const token = mintPresenterToken({
      apiKey: cfg.apiKey,
      apiSecret: cfg.apiSecret,
      room: cfg.room,
      identity,
      name: data.name,
    });
    return { ok: true, url: cfg.url, token, room: cfg.room, identity };
  });

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
