export type SourceReply = { ok: boolean; status: number | null; message: string };
export function normalizeMount(mount: string | undefined | null): string;
export function sourceRequest(opts: {
  host: string;
  port: number;
  mount: string;
  user: string;
  password: string;
  name: string;
  bitrate: number;
  contentType?: string;
}): string;
export function parseSourceReply(text: string): SourceReply | null;
export function refusalMessage(reply: SourceReply | null): string;
export function metadataPath(mount: string, title: string, artist: string): string;
export function parseHello(raw: unknown): { user: string; password: string; mime: string } | null;
export function originAllowed(origin: string | undefined, allowed: string[]): boolean;
export function ffmpegArgs(bitrate: number | string | undefined): string[];
