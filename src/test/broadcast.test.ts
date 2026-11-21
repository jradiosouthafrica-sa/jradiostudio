import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mintBroadcastToken, passwordMatches } from "@/lib/broadcast.server";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("VPS broadcast token", () => {
  it("is signed with the shared relay secret and has the expected audience", () => {
    const token = mintBroadcastToken("shared-secret", 1_000_000);
    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", "shared-secret").update(`${header}.${payload}`).digest("base64url");
    expect(signature).toBe(expected);
    expect(decode(header!)).toMatchObject({ alg: "HS256", typ: "JWT" });
    expect(decode(payload!)).toMatchObject({ aud: "airdesk-icecast-relay", iat: 1_000_000, exp: 1_000_120 });
  });
});

describe("studio password", () => {
  it("only accepts the exact password", () => {
    expect(passwordMatches("on-air", "on-air")).toBe(true);
    expect(passwordMatches("on-air ", "on-air")).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
  });
});
