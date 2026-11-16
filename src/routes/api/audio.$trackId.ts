import { createFileRoute } from "@tanstack/react-router";

import { demoAudioUrl } from "@/lib/demo-library";
import { parseTrackId } from "@/lib/studio-logic";

const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

// Streams a track to the studio's audio engine from the same origin, so the
// AzuraCast API key stays on the server and the browser can meter the audio.
export const Route = createFileRoute("/api/audio/$trackId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const parsed = parseTrackId(params.trackId);
        if (!parsed) return new Response("Invalid track id", { status: 400 });

        const upstreamHeaders = new Headers();
        const range = request.headers.get("range");
        if (range && /^bytes=\d*-\d*$/.test(range)) upstreamHeaders.set("range", range);

        let upstreamUrl: string | null;
        if (parsed.source === "demo") {
          upstreamUrl = demoAudioUrl(parsed.num);
        } else {
          const { getAzuraConfig, azuraPlayUrl } = await import("@/lib/azuracast.server");
          const cfg = getAzuraConfig();
          if (!cfg) return new Response("AzuraCast is not connected", { status: 503 });
          upstreamUrl = azuraPlayUrl(cfg, parsed.num);
          upstreamHeaders.set("X-API-Key", cfg.apiKey);
        }
        if (!upstreamUrl) return new Response("Track not found", { status: 404 });

        const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders });
        if (!upstream.ok && upstream.status !== 206) {
          return new Response("Could not load track", { status: upstream.status === 404 ? 404 : 502 });
        }
        const headers = new Headers();
        for (const h of PASS_HEADERS) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        headers.set("cache-control", "private, max-age=3600");
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
