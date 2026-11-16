import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type BridgeConfig = { url: string; apiKey: string; apiSecret: string; room: string; password: string };

/** Reads the LiveKit bridge settings. Returns null when anything required is missing. */
export function getBridgeConfig(): BridgeConfig | null {
  const url = (process.env["LIVEKIT_URL"] ?? "").trim();
  const apiKey = (process.env["LIVEKIT_API_KEY"] ?? "").trim();
  const apiSecret = (process.env["LIVEKIT_API_SECRET"] ?? "").trim();
  const password = process.env["STUDIO_PASSWORD"] ?? "";
  const room = (process.env["LIVEKIT_ROOM"] ?? "").trim() || DEFAULT_ROOM;
  if (!/^wss?:\/\//i.test(url) || !apiKey || !apiSecret || !password) return null;
  return { url, apiKey, apiSecret, room, password };
}

export const DEFAULT_ROOM = "studio";
/** Presenter tokens last a full long shift. */
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** Constant-time password check (hashing first so lengths never leak). */
export function passwordMatches(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

export function presenterIdentity(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return `presenter-${slug || "guest"}-${randomBytes(3).toString("hex")}`;
}

/** Signs a LiveKit access token (HS256 JWT) that lets a presenter join, publish and listen. */
export function mintPresenterToken(opts: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  name: string;
  nowSeconds?: number;
}): string {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: opts.apiKey,
    sub: opts.identity,
    name: opts.name,
    jti: opts.identity,
    nbf: now - 10,
    exp: now + TOKEN_TTL_SECONDS,
    metadata: JSON.stringify({ role: "presenter" }),
    video: {
      room: opts.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: ["microphone"],
    },
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createHmac("sha256", opts.apiSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
