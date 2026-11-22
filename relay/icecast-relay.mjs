// AirDesk VPS encoder: receives the studio mix from the browser over a WebSocket,
// re-encodes it to MP3 with ffmpeg and sends it to AzuraCast as an Icecast SOURCE (like BUTT).
//
//   Browser (Opus/WebM chunks) --wss--> this relay --ffmpeg--> MP3 --Icecast SOURCE--> AzuraCast
//
// Run on the VPS:  node --env-file=.env relay/icecast-relay.mjs   (or with PM2)
// The browser sends the same "hello" as AzuraCast's Web DJ, so AzuraCast itself checks the DJ login.

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { WebSocketServer } from "ws";

import {
  ffmpegArgs,
  metadataPath,
  normalizeMount,
  originAllowed,
  parseHello,
  parseSourceReply,
  refusalMessage,
  sourceRequest,
} from "./icecast-protocol.mjs";

const env = process.env;
const cfg = {
  listenPort: Number(env.ENCODER_PORT || 8090),
  listenHost: env.ENCODER_LISTEN_HOST || "127.0.0.1",
  path: env.ENCODER_PATH || "/encoder",
  iceHost: (env.ICECAST_HOST || "").trim(),
  icePort: Number(env.ICECAST_PORT || 8275),
  mount: normalizeMount(env.ICECAST_MOUNT || "/"),
  name: env.ICECAST_STREAM_NAME || "JRadio Live",
  bitrate: Number(env.ENCODER_BITRATE || 128),
  ffmpeg: env.FFMPEG_PATH || "ffmpeg",
  origins: (env.ENCODER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

if (!cfg.iceHost) {
  console.error("[encoder] ICECAST_HOST is not set — add it to .env");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), "[encoder]", ...a);
const sessions = new Set();
/** Max MP3 bytes held back while AzuraCast is still answering the login (~30s at 128k). */
const MAX_PENDING = 512 * 1024;

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === `${cfg.path}/health`) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        icecast: `${cfg.iceHost}:${cfg.icePort}${cfg.mount}`,
        broadcasting: sessions.size,
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({
  server,
  path: cfg.path,
  maxPayload: 1024 * 1024,
  handleProtocols: (protocols) => (protocols.has("webcast") ? "webcast" : false),
  verifyClient: ({ origin }) => originAllowed(origin, cfg.origins),
});

wss.on("connection", (ws, req) => {
  const who = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  let hello = null;
  let ff = null;
  let ice = null;
  let iceReady = false;
  let replyBuf = "";
  let pending = [];
  let pendingBytes = 0;
  let meta = null;
  let closed = false;
  let alive = true;
  const session = { ws };
  sessions.add(session);

  const end = (code, reason) => {
    if (closed) return;
    closed = true;
    sessions.delete(session);
    clearTimeout(helloTimer);
    clearInterval(pingTimer);
    if (ff) {
      ff.stdout.removeAllListeners();
      ff.removeAllListeners("exit");
      try {
        ff.stdin.end();
      } catch {}
      ff.kill("SIGKILL");
    }
    if (ice) {
      ice.removeAllListeners();
      ice.on("error", () => {});
      ice.destroy();
    }
    if (ws.readyState === ws.OPEN) {
      if (code !== 1000) ws.send(JSON.stringify({ type: "error", data: { message: reason } }));
      ws.close(code, String(reason).slice(0, 120));
    }
    log(`session ended (${who}): ${reason}`);
  };

  const helloTimer = setTimeout(() => end(4001, "No login received"), 10_000);
  const pingTimer = setInterval(() => {
    if (!alive) return end(1011, "Browser stopped responding");
    alive = false;
    ws.ping();
  }, 15_000);
  ws.on("pong", () => (alive = true));

  const sendMeta = () => {
    if (!iceReady || !meta || !hello) return;
    const r = http.get(
      {
        host: cfg.iceHost,
        port: cfg.icePort,
        path: metadataPath(cfg.mount, meta.title, meta.artist),
        auth: `${hello.user}:${hello.password}`,
        headers: { "User-Agent": "AirDesk-Encoder/1.0" },
        timeout: 5000,
      },
      (res) => res.resume(),
    );
    r.on("timeout", () => r.destroy());
    r.on("error", () => {});
  };

  const start = () => {
    // 1) ffmpeg: browser Opus -> MP3
    ff = spawn(cfg.ffmpeg, ffmpegArgs(cfg.bitrate), { stdio: ["pipe", "pipe", "pipe"] });
    ff.on("error", (e) => end(1011, `Encoder could not start ffmpeg (${e.message}) — install it with: apt install -y ffmpeg`));
    ff.stdin.on("error", () => {});
    ff.stderr.on("data", (d) => log("ffmpeg:", d.toString().trim()));
    ff.on("exit", (code) => end(1011, `Encoder stopped (ffmpeg exit ${code})`));
    ff.stdout.on("data", (chunk) => {
      if (iceReady) {
        ice.write(chunk);
      } else if (pendingBytes < MAX_PENDING) {
        pending.push(chunk);
        pendingBytes += chunk.length;
      }
    });

    // 2) Icecast SOURCE login to AzuraCast
    ice = net.connect({ host: cfg.iceHost, port: cfg.icePort });
    ice.setNoDelay(true);
    ice.setKeepAlive(true, 10_000);
    ice.setTimeout(15_000);
    ice.on("connect", () => {
      ice.write(
        sourceRequest({
          host: cfg.iceHost,
          port: cfg.icePort,
          mount: cfg.mount,
          user: hello.user,
          password: hello.password,
          name: cfg.name,
          bitrate: cfg.bitrate,
        }),
      );
    });
    ice.on("timeout", () => {
      if (!iceReady) end(4004, "AzuraCast did not answer the login in time.");
    });
    ice.on("data", (buf) => {
      if (iceReady) return; // server chatter after login is ignored
      replyBuf += buf.toString("latin1");
      const reply = parseSourceReply(replyBuf);
      if (!reply) return;
      if (!reply.ok) return end(4003, refusalMessage(reply));
      iceReady = true;
      ice.setTimeout(0);
      for (const c of pending) ice.write(c);
      pending = [];
      pendingBytes = 0;
      log(`on air via Icecast ${cfg.iceHost}:${cfg.icePort}${cfg.mount} as ${hello.user} (${who})`);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "status", data: { status: "on_air" } }));
      sendMeta();
    });
    ice.on("error", (e) => end(4005, iceReady ? `Lost connection to AzuraCast (${e.message})` : `Could not reach AzuraCast (${e.message})`));
    ice.on("close", () => end(4005, iceReady ? "AzuraCast closed the live connection." : refusalMessage(parseSourceReply(replyBuf))));
  };

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      if (ff && !closed) ff.stdin.write(data);
      return;
    }
    const text = data.toString();
    if (!hello) {
      hello = parseHello(text);
      if (!hello) return end(4002, "Bad login message");
      clearTimeout(helloTimer);
      log(`presenter ${hello.user} connecting (${who}, ${hello.mime || "unknown format"})`);
      start();
      return;
    }
    try {
      const msg = JSON.parse(text);
      if (msg?.type === "metadata" && msg.data) {
        meta = { title: String(msg.data.title ?? "").slice(0, 200), artist: String(msg.data.artist ?? "").slice(0, 200) };
        sendMeta();
      }
    } catch {}
  });
  ws.on("close", () => end(1000, "Presenter disconnected"));
  ws.on("error", () => end(1011, "Browser connection error"));
});

server.listen(cfg.listenPort, cfg.listenHost, () => {
  log(`listening on ${cfg.listenHost}:${cfg.listenPort}${cfg.path} -> Icecast ${cfg.iceHost}:${cfg.icePort}${cfg.mount}`);
});

const shutdown = () => {
  log("shutting down");
  for (const s of sessions) s.ws.close(1001, "Encoder restarting");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
