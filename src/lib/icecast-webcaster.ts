export type WebcasterStatus = "idle" | "connecting" | "live" | "error";
export class IcecastWebcaster {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  onStatus: (status: WebcasterStatus, message?: string) => void = () => {};
  start(stream: MediaStream, token: string) {
    this.stop();
    const mime = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) { this.onStatus("error", "This browser cannot encode audio. Please use Chrome or Edge."); return; }
    this.onStatus("connecting");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${scheme}//${location.host}/broadcast-ws?token=${encodeURIComponent(token)}`);
    ws.binaryType = "arraybuffer"; this.ws = ws;
    ws.onmessage = (event) => {
      let msg: { type?: string; message?: string };
      try { msg = JSON.parse(String(event.data)) as typeof msg; } catch { return; }
      if (msg.type === "ready" && this.ws === ws) {
        const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 128_000 });
        recorder.ondataavailable = async (event) => {
          if (!event.data.size || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 2_000_000) { this.onStatus("error", "Network cannot keep up with live audio."); this.stop(); return; }
          ws.send(await event.data.arrayBuffer());
        };
        recorder.onerror = () => this.onStatus("error", "Browser audio encoder failed.");
        recorder.start(250); this.recorder = recorder; this.onStatus("live");
      } else if (msg.type === "error") {
        this.onStatus("error", msg.message || "VPS relay could not start."); this.stopSocketOnly();
      }
    };
    ws.onerror = () => this.onStatus("error", "Could not connect to the AirDesk VPS relay.");
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.stopRecorder(); this.ws = null;
      this.onStatus(event.code === 1000 ? "idle" : "error", event.code === 1000 ? undefined : "VPS relay disconnected.");
    };
  }
  sendMetadata(_title: string, _artist: string) {}
  private stopRecorder() { if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop(); this.recorder = null; }
  private stopSocketOnly() { this.stopRecorder(); const ws = this.ws; this.ws = null; ws?.close(1011, "Relay error"); }
  stop() { this.stopRecorder(); const ws = this.ws; this.ws = null; if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, "Broadcast ended"); this.onStatus("idle"); }
}
