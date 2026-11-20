/**
 * Streams a MediaStream to AzuraCast's live DJ input (Liquidsoap "webcast" WebSocket),
 * using the same binary-message ordering as the official webcast.js client.
 */
export type WebcasterStatus = "idle" | "connecting" | "live" | "error";

export class AzuraWebcaster {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  onStatus: (s: WebcasterStatus, msg?: string) => void = () => {};

  start(stream: MediaStream, login: { url: string; user: string; djPassword: string }) {
    this.stop();

    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) {
      this.onStatus("error", "This browser can't encode audio for streaming. Try Chrome or Edge.");
      return;
    }

    this.onStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(login.url, "webcast");
    } catch {
      this.onStatus("error", "Could not open the AzuraCast WebSocket.");
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (ws.protocol !== "webcast") {
        ws.close(4400, "AzuraCast did not accept the webcast protocol.");
        return;
      }

      // The hello message must be the first message sent on this connection.
      ws.send(JSON.stringify({
        type: "hello",
        data: {
          mime,
          user: login.user,
          password: login.djPassword,
          audio: { channels: 2, bitrate: 128, encoder: mime.includes("opus") ? "opus" : "unknown" },
        },
      }));

      try {
        const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });

        // Send each Blob synchronously. WebSocket preserves send order; awaiting
        // arrayBuffer() in separate data events can allow encoded chunks to overtake.
        rec.ondataavailable = (event) => {
          if (!event.data.size || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 4 * 1024 * 1024) {
            this.onStatus("error", "The network cannot keep up with the live audio stream.");
            ws.close(1011, "Audio send buffer exceeded 4 MB.");
            return;
          }
          ws.send(event.data);
        };

        rec.onerror = () => {
          this.onStatus("error", "The browser could not encode the studio audio.");
          ws.close(1011, "MediaRecorder error.");
        };

        rec.start(250);
        this.recorder = rec;
        this.onStatus("live");
      } catch {
        this.onStatus("error", "The browser could not start audio encoding.");
        ws.close(1011, "MediaRecorder could not start.");
      }
    };

    ws.onerror = () => {
      if (this.ws === ws) this.onStatus("error", "Couldn't reach AzuraCast.");
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.stopRecorder();
      this.ws = null;

      const reasons: Record<number, string> = {
        1000: "AzuraCast ended the stream.",
        4400: "AzuraCast rejected the webcast protocol.",
        4401: "AzuraCast rejected the DJ username or password.",
        4404: "The AzuraCast live DJ mount was not found.",
        4409: "Another DJ connection is already using this live mount.",
        4415: "AzuraCast does not support this browser's audio format.",
        1011: "AzuraCast reported a live-stream processing error.",
      };
      const detail = reasons[event.code] ?? `AzuraCast disconnected (code ${event.code}).`;
      this.onStatus("error", event.reason ? `${detail} ${event.reason}` : detail);
    };
  }

  sendMetadata(title: string, artist: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "metadata", data: { title, artist } }));
    }
  }

  private stopRecorder() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
  }

  stop() {
    this.stopRecorder();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "Studio stopped streaming.");
    this.onStatus("idle");
  }
}
