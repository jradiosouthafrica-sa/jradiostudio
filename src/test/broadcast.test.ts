import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { mintPresenterToken, passwordMatches, presenterIdentity, TOKEN_TTL_SECONDS } from "@/lib/broadcast.server";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("presenter token", () => {
  const token = mintPresenterToken({
    apiKey: "APIkey",
    apiSecret: "secret-value",
    room: "studio",
    identity: "presenter-clifford-abc123",
    name: "Clifford",
    nowSeconds: 1_000_000,
  });
  const [h, p, s] = token.split(".");

  it("is signed with the LiveKit API secret", () => {
    const expected = createHmac("sha256", "secret-value").update(`${h}.${p}`).digest("base64url");
    expect(s).toBe(expected);
  });

  it("lets the presenter join the studio room, publish and hear the return", () => {
    const payload = decode(p!);
    expect(payload.iss).toBe("APIkey");
    expect(payload.sub).toBe("presenter-clifford-abc123");
    expect(payload.video).toMatchObject({ room: "studio", roomJoin: true, canPublish: true, canSubscribe: true });
  });

  it("expires after 8 hours", () => {
    expect(decode(p!).exp - 1_000_000).toBe(TOKEN_TTL_SECONDS);
    expect(TOKEN_TTL_SECONDS).toBe(8 * 60 * 60);
  });
});

describe("studio password", () => {
  it("only accepts the exact password", () => {
    expect(passwordMatches("on-air", "on-air")).toBe(true);
    expect(passwordMatches("on-air ", "on-air")).toBe(false);
    expect(passwordMatches("", "")).toBe(false);
  });
});

describe("presenterIdentity", () => {
  it("is unique per join and readable", () => {
    const a = presenterIdentity("DJ Thabo!");
    expect(a).toMatch(/^presenter-dj-thabo-[0-9a-f]{6}$/);
    expect(presenterIdentity("DJ Thabo!")).not.toBe(a);
  });
});
