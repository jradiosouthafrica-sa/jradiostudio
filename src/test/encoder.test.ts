import { describe, expect, it } from "vitest";

import {
  metadataPath,
  normalizeMount,
  originAllowed,
  parseHello,
  parseSourceReply,
  refusalMessage,
  sourceRequest,
} from "../../relay/icecast-protocol.mjs";
import { encoderUrl, liveUrl } from "@/lib/studio-logic";

describe("Icecast SOURCE login (VPS encoder)", () => {
  const req = sourceRequest({
    host: "65.108.143.81",
    port: 8275,
    mount: "/",
    user: "cn007",
    password: "secret",
    name: "JRadio Live",
    bitrate: 128,
  });

  it("logs in to AzuraCast port 8275 with the DJ username and password, sending MP3", () => {
    expect(req.startsWith("SOURCE / HTTP/1.0\r\n")).toBe(true);
    expect(req).toContain("Host: 65.108.143.81:8275\r\n");
    expect(req).toContain(`Authorization: Basic ${Buffer.from("cn007:secret").toString("base64")}\r\n`);
    expect(req).toContain("Content-Type: audio/mpeg\r\n");
    expect(req.endsWith("\r\n\r\n")).toBe(true);
  });

  it("cannot be broken by line breaks in the stream name", () => {
    const r = sourceRequest({ host: "h", port: 1, mount: "live", user: "u", password: "p", name: "A\r\nX-Evil: 1", bitrate: 128 });
    expect(r).not.toContain("\r\nX-Evil");
    expect(r.startsWith("SOURCE /live HTTP/1.0")).toBe(true);
  });

  it("goes on air only on a 2xx reply", () => {
    expect(parseSourceReply("HTTP/1.0 200 OK\r\n\r\n")).toMatchObject({ ok: true, status: 200 });
    expect(parseSourceReply("HTTP/1.0 401 Authentication Required\r\n\r\n")).toMatchObject({ ok: false, status: 401 });
    expect(parseSourceReply("HTTP/1.0 2")).toBeNull();
  });

  it("explains a refused login in plain words", () => {
    expect(refusalMessage({ ok: false, status: 401, message: "" })).toMatch(/DJ username and password/);
    expect(refusalMessage(null)).toMatch(/another DJ may already be live/);
  });

  it("sends song titles as 'Artist - Title' to the same mount", () => {
    const p = metadataPath("/", "Song", "Artist");
    const q = new URLSearchParams(p.split("?")[1]);
    expect(p.startsWith("/admin/metadata?")).toBe(true);
    expect(q.get("mode")).toBe("updinfo");
    expect(q.get("mount")).toBe("/");
    expect(q.get("song")).toBe("Artist - Song");
  });

  it("normalizes mount points", () => {
    expect(normalizeMount("live")).toBe("/live");
    expect(normalizeMount("//live")).toBe("/live");
    expect(normalizeMount("")).toBe("/");
  });

  it("accepts only a well-formed hello", () => {
    expect(parseHello(JSON.stringify({ type: "hello", data: { user: "cn007", password: "x", mime: "audio/webm" } }))).toEqual({
      user: "cn007",
      password: "x",
      mime: "audio/webm",
    });
    expect(parseHello("nope")).toBeNull();
    expect(parseHello(JSON.stringify({ type: "hello", data: { user: "", password: "x" } }))).toBeNull();
  });

  it("limits which sites may use the encoder when a list is set", () => {
    expect(originAllowed("https://studio.example.com", [])).toBe(true);
    expect(originAllowed("https://studio.example.com", ["https://studio.example.com/"])).toBe(true);
    expect(originAllowed("https://evil.example", ["https://studio.example.com"])).toBe(false);
    expect(originAllowed(undefined, ["https://studio.example.com"])).toBe(false);
  });
});

describe("Go Live routes", () => {
  it("uses the VPS encoder only when ENCODER_URL is a ws(s) address", () => {
    expect(encoderUrl("wss://studio.jradiosouthafrica.co.za/encoder")).toBe("wss://studio.jradiosouthafrica.co.za/encoder");
    expect(encoderUrl("https://studio.jradiosouthafrica.co.za/encoder")).toBeNull();
    expect(encoderUrl(undefined)).toBeNull();
  });

  it("sends Direct to AzuraCast's Web DJ and Encoder to the VPS", () => {
    const opts = { encoder: "wss://vps/encoder", azuraBase: "https://radio.example.com/", shortcode: "j_radio" };
    expect(liveUrl("direct", opts)).toBe("wss://radio.example.com/webdj/j_radio/");
    expect(liveUrl("encoder", opts)).toBe("wss://vps/encoder");
    expect(liveUrl("encoder", { ...opts, encoder: null })).toBeNull();
  });
});
