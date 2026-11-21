import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function passwordMatches(input: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
export function mintBroadcastToken(secret: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ aud: "airdesk-icecast-relay", iat: now, exp: now + 120 }));
  const body = `${header}.${payload}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
