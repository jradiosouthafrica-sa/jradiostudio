import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.BROADCAST_RELAY_PORT || 3001);
const PATH = "/broadcast-ws";
function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function validToken(token) {
  try {
    const secret = process.env.BROADCAST_TOKEN_SECRET || required("STUDIO_PASSWORD");
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const body = `${parts[0]}.${parts[1]}`;
    const expected = createHmac("sha256", secret).update(body).digest();
    const actual = Buffer.from(parts[2], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    return payload.aud === "airdesk-icecast-relay" && payload.exp > now && payload.iat <= now + 10;
  } catch { return false; }
}
function openIcecastSocket() {
  const host = required("ICECAST_HOST");
  const port = Number(required("ICECAST_PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ICECAST_PORT must be a valid TCP port");
  return (process.env.ICECAST_TLS || "true").toLowerCase() !== "false"
    ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
    : net.connect({ host, port });
}
function startIcecastSource() {
  const mount = required("ICECAST_MOUNT");
  if (!mount.startsWith("/") || /[\r\n ]/.test(mount)) throw new Error("ICECAST_MOUNT must be a valid path beginning with /");
  const username = (process.env.ICECAST_SOURCE_USER || "source").trim();
  const password = required("ICECAST_SOURCE_PASSWORD");
  const host = required("ICECAST_HOST");
  const port = Number(required("ICECAST_PORT"));
  const socket = openIcecastSocket();
  const connectEvent = (process.env.ICECAST_TLS || "true").toLowerCase() !== "false" ? "secureConnect" : "connect";
  const authorization = Buffer.from(`${username}:${password}`).toString("base64");
  const request = [
    `SOURCE ${mount} ICE/1.0`, `Host: ${host}:${port}`,
    `Authorization: Basic ${authorization}`, "Content-Type: audio/mpeg",
    "ice-name: JRadio Live Studio", "ice-description: JRadio live programme",
    "ice-public: 1", "ice-audio-info: bitrate=128;samplerate=44100;channels=2",
    "User-Agent: AirDesk-Icecast-Relay/1.0", "", "",
  ].join("\r\n");
  return new Promise((resolve, reject) => {
    let response = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => fail(new Error("Icecast handshake timed out")), 10000);
    const fail = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy(); reject(error);
    };
    socket.once("error", fail);
    socket.once(connectEvent, () => socket.write(request));
    socket.on("data", function handshake(data) {
      response = Buffer.concat([response, data]);
      const end = response.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.removeListener("data", handshake);
      const status = response.subarray(0, end).toString("latin1").split("\r\n", 1)[0] || "";
      if (!/^HTTP\/1\.[01] 200\b/.test(status) && !/^ICE\/1\.0 200\b/.test(status))
        return fail(new Error(`Icecast rejected SOURCE connection: ${status}`));
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(socket);
    });
  });
}

let active = null;
const server = http.createServer((_req, res) => { res.writeHead(404); res.end("Not found"); });
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", "http://localhost");
  const origin = process.env.BROADCAST_ALLOWED_ORIGIN || "https://studio.jradiosouthafrica.co.za";
  if (url.pathname !== PATH || req.headers.origin !== origin || !validToken(url.searchParams.get("token") || "")) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
  }
  if (active) { socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", async (ws) => {
  const session = { ws, ffmpeg: null, icecast: null, ended: false }; active = session;
  const end = (reason = "Broadcast ended") => {
    if (session.ended) return;
    session.ended = true;
    try { session.ffmpeg?.stdin.destroy(); session.ffmpeg?.kill("SIGTERM"); } catch {}
    try { session.icecast?.destroy(); } catch {}
    if (ws.readyState === WebSocket.OPEN) ws.close(1000, reason.slice(0, 120));
    if (active === session) active = null;
    console.log("[relay] session closed:", reason);
  };
  try {
    const ffmpeg = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "warning", "-f", "webm", "-i", "pipe:0",
      "-vn", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame",
      "-b:a", process.env.ICECAST_BITRATE || "128k", "-content_type", "audio/mpeg", "-f", "mp3", "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    session.ffmpeg = ffmpeg;
    ffmpeg.stdin.on("error", (error) => { if (!session.ended) end(`FFmpeg input error: ${error.message}`); });
    ffmpeg.stderr.on("data", (chunk) => console.error("[ffmpeg]", chunk.toString().trim()));
    ffmpeg.on("error", (error) => end(`FFmpeg error: ${error.message}`));
    ffmpeg.on("close", (code) => { if (!session.ended && code !== 0) end(`FFmpeg exited with code ${code}`); });
    const icecast = await startIcecastSource();
    if (session.ended) { icecast.destroy(); return; }
    session.icecast = icecast;
    ffmpeg.stdout.pipe(icecast);
    icecast.on("error", (error) => end(`Icecast socket error: ${error.message}`));
    icecast.on("close", () => { if (!session.ended) end("Icecast disconnected"); });
    ws.send(JSON.stringify({ type: "ready" }));
    console.log("[relay] Icecast SOURCE connected; studio is live");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[relay] start failed:", message);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "error", message }));
    end(message); return;
  }
  ws.on("message", (data, isBinary) => {
    if (session.ended || !isBinary) return;
    if (!session.ffmpeg || session.ffmpeg.stdin.destroyed) return end("FFmpeg input is closed");
    if (ws.bufferedAmount > 2_000_000) return end("Browser audio queue exceeded its safety limit");
    if (!session.ffmpeg.stdin.write(Buffer.from(data))) {
      ws._socket?.pause();
      session.ffmpeg.stdin.once("drain", () => ws._socket?.resume());
    }
  });
  ws.on("close", () => end());
  ws.on("error", (error) => end(error.message));
});
server.listen(PORT, "127.0.0.1", () => console.log(`[relay] listening on 127.0.0.1:${PORT}${PATH}`));
process.on("SIGINT", () => { active?.ws.close(1001, "Server shutting down"); server.close(); });
process.on("SIGTERM", () => { active?.ws.close(1001, "Server shutting down"); server.close(); });
