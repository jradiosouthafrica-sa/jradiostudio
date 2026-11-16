import { crossfadeGains, DUCK_LEVEL } from "./studio-logic";
import type { DeckId } from "./studio-types";

type DeckChannel = {
  el: HTMLAudioElement;
  fader: GainNode;
  xfade: GainNode;
  analyser: AnalyserNode;
};

export type MeterChannel = DeckId | "mic" | "program";

/**
 * Browser-side studio mixer.
 *
 *   Deck A/B -> channel fader -> crossfader -> musicBus (duck) -> monitor -> speakers
 *                                                            \-> programBus -> program stream
 *   Mic -> mic fader -------------------------------------------/
 *
 * The mic only feeds the program bus (never the speakers) to avoid feedback.
 * `programStream` is what will be sent to the VPS mixer once it is connected.
 */
export class StudioEngine {
  readonly ctx: AudioContext;
  private decks: Record<DeckId, DeckChannel>;
  private musicBus: GainNode;
  private monitor: GainNode;
  private programBus: GainNode;
  private programAnalyser: AnalyserNode;
  private programDest: MediaStreamAudioDestinationNode;
  private micFader: GainNode;
  private micAnalyser: AnalyserNode;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private buf = new Float32Array(1024);
  private duckOn = false;
  private micOpen = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.musicBus = this.ctx.createGain();
    this.monitor = this.ctx.createGain();
    this.programBus = this.ctx.createGain();
    this.programAnalyser = this.makeAnalyser();
    this.programDest = this.ctx.createMediaStreamDestination();
    this.micFader = this.ctx.createGain();
    this.micAnalyser = this.makeAnalyser();

    this.musicBus.connect(this.monitor);
    this.monitor.connect(this.ctx.destination);
    this.musicBus.connect(this.programBus);
    this.micFader.connect(this.micAnalyser);
    this.micAnalyser.connect(this.programBus);
    this.programBus.connect(this.programAnalyser);
    this.programBus.connect(this.programDest);

    this.decks = { A: this.makeDeck(), B: this.makeDeck() };
  }

  private makeAnalyser() {
    const a = this.ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0.6;
    return a;
  }

  private makeDeck(): DeckChannel {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    const src = this.ctx.createMediaElementSource(el);
    const fader = this.ctx.createGain();
    const xfade = this.ctx.createGain();
    const analyser = this.makeAnalyser();
    src.connect(fader);
    fader.connect(xfade);
    xfade.connect(analyser);
    analyser.connect(this.musicBus);
    return { el, fader, xfade, analyser };
  }

  get programStream(): MediaStream {
    return this.programDest.stream;
  }

  element(deck: DeckId): HTMLAudioElement {
    return this.decks[deck].el;
  }

  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  load(deck: DeckId, url: string) {
    const el = this.decks[deck].el;
    el.pause();
    el.src = url;
    el.load();
  }

  unload(deck: DeckId) {
    const el = this.decks[deck].el;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  async play(deck: DeckId) {
    await this.resume();
    await this.decks[deck].el.play();
  }

  pause(deck: DeckId) {
    this.decks[deck].el.pause();
  }

  seek(deck: DeckId, seconds: number) {
    const el = this.decks[deck].el;
    if (Number.isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(seconds, el.duration - 0.05));
  }

  private ramp(param: AudioParam, value: number, time = 0.03) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, time);
  }

  setChannelLevel(deck: DeckId, v: number) {
    this.ramp(this.decks[deck].fader.gain, v);
  }

  setCrossfader(position: number) {
    const g = crossfadeGains(position);
    this.ramp(this.decks.A.xfade.gain, g.A, 0.015);
    this.ramp(this.decks.B.xfade.gain, g.B, 0.015);
  }

  setMaster(v: number) {
    this.ramp(this.programBus.gain, v);
    this.ramp(this.monitor.gain, v);
  }

  setMicLevel(v: number) {
    this.ramp(this.micFader.gain, v);
  }

  setDucking(on: boolean) {
    this.duckOn = on;
    this.applyDuck();
  }

  private applyDuck() {
    this.ramp(this.musicBus.gain, this.duckOn && this.micOpen ? DUCK_LEVEL : 1, 0.12);
  }

  async openMic() {
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
      this.micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.micSource.connect(this.micFader);
    }
    await this.resume();
    this.micStream.getAudioTracks().forEach((t) => (t.enabled = true));
    this.micOpen = true;
    this.applyDuck();
  }

  closeMic() {
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = false));
    this.micOpen = false;
    this.applyDuck();
  }

  /** Peak level mapped from -48 dBFS..0 dBFS to 0..1. */
  level(channel: MeterChannel): number {
    const a =
      channel === "program" ? this.programAnalyser : channel === "mic" ? this.micAnalyser : this.decks[channel].analyser;
    a.getFloatTimeDomainData(this.buf);
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = Math.abs(this.buf[i]);
      if (v > peak) peak = v;
    }
    if (peak <= 0.0001) return 0;
    const db = 20 * Math.log10(peak);
    return Math.max(0, Math.min(1, (db + 48) / 48));
  }
}
