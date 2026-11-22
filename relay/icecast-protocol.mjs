// Pure helpers for the AirDesk Icecast encoder (no I/O), shared by the relay and its tests.

/** Makes sure a mount point starts with exactly one "/". */
export function normalizeMount(mount) {
  const m = String(mount ?? "").trim().replace(/^\/+/, "");
  return "/" + m;
}

/** The request that opens an Icecast SOURCE connection (the same handshake BUTT uses). */
export function sourceRequest({ host, port, mount, user, password, name, bitrate, contentType = "audio/mpeg" }) {
  const auth = Buffer.from(`${user}:${password}`, "utf8").toString("base64");
  const clean = (v) => String(v).replace(/[\r\n]/g, " ");
  return [
    `SOURCE ${normalizeMount(mount)} HTTP/1.0`,
    `Host: ${clean(host)}:${port}`,
    `Authorization: Basic ${auth}`,
    "User-Agent: AirDesk-Encoder/1.0",
    `Content-Type: ${clean(contentType)}`,
    `Ice-Name: ${clean(name)}`,
    "Ice-Public: 0",
    `Ice-Audio-Info: bitrate=${Number(bitrate) || 128}`,
    "",
    "",
  ].join("\r\n");
}

/**
 * Reads the server's reply to SOURCE. Returns null until the full header has arrived,
 * then { ok, status, message }.
 */
export function parseSourceReply(text) {
  const end = text.indexOf("\r\n\r\n");
  const lineEnd = text.indexOf("\r\n");
  if (end === -1 && lineEnd === -1) return null;
  const line = text.slice(0, lineEnd === -1 ? end : lineEnd).trim();
  const m = /^(?:HTTP|ICE)\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i.exec(line);
  if (!m) return { ok: line.toUpperCase() === "OK2", status: null, message: line };
  const status = Number(m[1]);
  return { ok: status >= 200 && status < 300, status, message: m[2] || "" };
}

/** Plain-language reason for a refused SOURCE login. */
export function refusalMessage(reply) {
  if (!reply) return "AzuraCast closed the connection — another DJ may already be live, or the DJ login was refused.";
  if (reply.status === 401 || reply.status === 403)
    return "AzuraCast refused the DJ login — check the DJ username and password.";
  if (reply.status === 409 || /in use|already/i.test(reply.message))
    return "Someone else is already live on AzuraCast (BUTT or another presenter).";
  return `AzuraCast refused the connection (${reply.status ?? "?"} ${reply.message}).`.trim();
}

/** Path for an Icecast metadata update ("Artist - Title"). */
export function metadataPath(mount, title, artist) {
  const song = [artist, title].map((s) => String(s ?? "").trim()).filter(Boolean).join(" - ");
  const q = new URLSearchParams({ mode: "updinfo", mount: normalizeMount(mount), song });
  return `/admin/metadata?${q.toString()}`;
}

/** Validates the browser's "hello" message (same shape as AzuraCast's Web DJ). */
export function parseHello(raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return null;
  }
  const d = msg && msg.type === "hello" ? msg.data : null;
  if (!d || typeof d.user !== "string" || typeof d.password !== "string") return null;
  const user = d.user.trim();
  if (!user || user.length > 100 || d.password.length > 200) return null;
  return { user, password: d.password, mime: typeof d.mime === "string" ? d.mime.slice(0, 60) : "" };
}

/** True when the browser's page origin may use the encoder (empty list = any origin). */
export function originAllowed(origin, allowed) {
  if (!allowed || allowed.length === 0) return true;
  if (!origin) return false;
  const o = origin.replace(/\/+$/, "").toLowerCase();
  return allowed.some((a) => a.replace(/\/+$/, "").toLowerCase() === o);
}

/** ffmpeg arguments: browser Opus (WebM/Ogg) in on stdin, constant-bitrate MP3 out on stdout, no buffering. */
export function ffmpegArgs(bitrate) {
  const kbps = Math.min(320, Math.max(64, Number(bitrate) || 128));
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-fflags", "+nobuffer",
    "-probesize", "32768",
    "-i", "pipe:0",
    "-vn",
    "-ac", "2",
    "-ar", "44100",
    "-c:a", "libmp3lame",
    "-b:a", `${kbps}k`,
    "-f", "mp3",
    "-flush_packets", "1",
    "pipe:1",
  ];
}
