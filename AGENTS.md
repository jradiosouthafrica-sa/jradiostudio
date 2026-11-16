<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules

- Studio audio runs in the browser (`src/lib/audio-engine.ts`, Web Audio); the mic feeds only the program bus, never the speakers, so `programStream` is the single feed published to the bridge.
- Live broadcasting goes through the VPS LiveKit server: `joinBroadcast` checks STUDIO_PASSWORD and signs a short-lived presenter token server-side (LIVEKIT_API_KEY/SECRET never reach the browser); the client publishes `programStream` and plays remote tracks as monitor-only return audio, never into the program bus (avoids re-broadcasting co-hosts).
- AzuraCast is reached only server-side (`src/lib/azuracast.server.ts`) using the AZURACAST_BASE_URL / AZURACAST_API_KEY / AZURACAST_STATION_ID secrets; the app falls back to the demo library when they are missing or fail.
- Track audio streams through `/api/audio/$trackId`, which accepts only ids matching `parseTrackId` so the proxy can never be pointed at arbitrary URLs.
- Pure studio rules (crossfade curve, Auto DJ trigger, AzuraCast mapping) live in `src/lib/studio-logic.ts` with tests in `src/test/studio-logic.test.ts`.
