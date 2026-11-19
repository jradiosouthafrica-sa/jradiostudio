/**
 * Streams a MediaStream to AzuraCast's live DJ input (Liquidsoap "webcast" WebSocket),
 * the same protocol AzuraCast's own Web DJ uses.
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
    const ws = new WebSocket(login.url, "webcast");
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "hello", data: { mime, user: login.user, password: login.djPassword } }));
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = async (e) => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(await e.data.arrayBuffer());
      };
      rec.start(250);
      this.recorder = rec;
      this.onStatus("live");
    };
    ws.onerror = () => this.onStatus("error", "Couldn't reach AzuraCast.");
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.stopRecorder();
      this.ws = null;
      this.onStatus("error", e.code === 1000 ? "AzuraCast ended the stream." : "AzuraCast closed the connection — check the DJ login.");
    };
  }

  sendMetadata(title: string, artist: string) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: "metadata", data: { title, artist } }));
  }

  private stopRecorder() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
  }

  stop() {
    this.stopRecorder();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.onStatus("idle");
  }
}
