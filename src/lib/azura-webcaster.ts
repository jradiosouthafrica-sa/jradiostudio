import { reconnectDelayMs, shouldReconnect } from "./studio-logic";

/**
 * Streams a MediaStream to AzuraCast's live DJ input (Liquidsoap "webcast" WebSocket),
 * the same protocol AzuraCast's own Web DJ uses.
 *
 * If the connection drops while on air it reconnects on its own (1s, 2s, 4s, 8s, then every 10s)
 * until `stop()` is called — the presenter is never silently logged off air.
 */
export type WebcasterStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";

type Login = { url: string; user: string; djPassword: string };

/** A connection must stay open this long to count as "got on air" (a rejected login closes at once). */
const STABLE_MS = 4000;

export class AzuraWebcaster {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private login: Login | null = null;
  private mime = "";
  private active = false;
  private everLive = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMeta: { title: string; artist: string } | null = null;
  onStatus: (s: WebcasterStatus, msg?: string) => void = () => {};

  private readonly onOnline = () => {
    // Network came back: retry straight away instead of waiting out the timer.
    if (this.active && !this.ws) {
      this.clearRetry();
      this.connect();
    }
  };

  start(stream: MediaStream, login: Login) {
    this.stop();
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) {
      this.onStatus("error", "This browser can't encode audio for streaming. Try Chrome or Edge.");
      return;
    }
    this.stream = stream;
    this.login = login;
    this.mime = mime;
    this.active = true;
    this.everLive = false;
    this.failures = 0;
    window.addEventListener("online", this.onOnline);
    this.onStatus("connecting");
    this.connect();
  }

  private connect() {
    const { stream, login, mime } = this;
    if (!this.active || !stream || !login) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(login.url, "webcast");
    } catch {
      this.handleDrop();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(
        JSON.stringify({
          type: "hello",
          data: { mime, user: login.user, password: login.djPassword },
        }),
      );
      // Each connection needs a fresh recorder so AzuraCast gets the stream header first.
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = async (e) => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(await e.data.arrayBuffer());
      };
      rec.start(250);
      this.recorder = rec;
      if (this.lastMeta) ws.send(JSON.stringify({ type: "metadata", data: this.lastMeta }));
      this.stableTimer = setTimeout(() => {
        this.everLive = true;
        this.failures = 0;
      }, STABLE_MS);
      this.onStatus("live");
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handleDrop();
    };
  }

  private handleDrop() {
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
    this.stopRecorder();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    if (!this.active) return;
    if (!shouldReconnect(this.everLive, this.failures)) {
      this.teardown();
      this.onStatus(
        "error",
        "AzuraCast refused the connection — check the DJ login, or close BUTT / other DJ apps.",
      );
      return;
    }
    const delay = reconnectDelayMs(this.failures);
    this.failures += 1;
    this.onStatus(
      "reconnecting",
      `Connection to AzuraCast lost — retrying in ${Math.round(delay / 1000)}s`,
    );
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  sendMetadata(title: string, artist: string) {
    this.lastMeta = { title, artist };
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: "metadata", data: { title, artist } }));
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private stopRecorder() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
  }

  private teardown() {
    this.active = false;
    this.clearRetry();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = null;
    window.removeEventListener("online", this.onOnline);
    this.stopRecorder();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onmessage = null;
      ws.close();
    }
  }

  /** Ends the broadcast for good (no reconnecting). */
  stop() {
    this.teardown();
    this.onStatus("idle");
  }
}
