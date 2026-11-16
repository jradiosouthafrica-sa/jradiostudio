import { useQuery } from "@tanstack/react-query";
import { Headphones, Users, Volume2, VolumeX } from "lucide-react";

import { bridgeStatusQueryOptions } from "@/lib/broadcast.functions";
import { cn } from "@/lib/utils";
import { useBroadcast } from "./broadcast-context";
import { Fader } from "./Fader";

export function BridgePanel() {
  const {
    state,
    room,
    participants,
    returnVolume,
    setReturnVolume,
    mutedReturn,
    toggleReturnMute,
  } = useBroadcast();
  const { data: bridge } = useQuery(bridgeStatusQueryOptions());
  const live = state === "live" || state === "reconnecting";

  return (
    <section aria-label="Studio bridge" className="console-panel flex flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="console-label">Studio bridge</span>
        </div>
        <span
          className={cn(
            "console-label rounded-sm border px-2 py-0.5",
            state === "live" && "border-on-air bg-on-air text-on-air-foreground",
            state === "reconnecting" && "border-meter-mid text-meter-mid",
            (state === "off" || state === "connecting") && "border-border text-muted-foreground",
          )}
        >
          {state === "live"
            ? "On air"
            : state === "reconnecting"
              ? "Reconnecting"
              : state === "connecting"
                ? "Connecting"
                : "Off air"}
        </span>
      </header>

      {!live ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {bridge && !bridge.configured
            ? "Waiting for the bridge keys. Once they're added, press Go live to broadcast."
            : "Press Go live to send your decks and mic to the station and hear your co-hosts."}
        </p>
      ) : (
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-3">
            <Headphones className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="console-label w-14 shrink-0 text-muted-foreground">Return</span>
            <Fader
              label="Return volume"
              orientation="horizontal"
              value={returnVolume}
              onChange={setReturnVolume}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Room <span className="font-mono text-foreground">{room}</span> · {participants.length}{" "}
            {participants.length === 1 ? "other connection" : "other connections"}
          </p>
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one else is on the bridge right now.</p>
          ) : (
            <ul className="space-y-1">
              {participants.map((p) => (
                <li
                  key={p.identity}
                  className="flex items-center gap-2 rounded-md bg-panel-raised/60 px-2 py-1.5"
                >
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      p.speaking
                        ? "bg-meter-low"
                        : p.hasAudio
                          ? "bg-muted-foreground"
                          : "bg-meter-off",
                    )}
                    aria-label={p.speaking ? "Speaking" : "Quiet"}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => toggleReturnMute(p.identity)}
                    aria-label={
                      mutedReturn[p.identity]
                        ? `Unmute ${p.name} in my headphones`
                        : `Mute ${p.name} in my headphones`
                    }
                    title="Only affects what you hear"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {mutedReturn[p.identity] ? (
                      <VolumeX className="h-3.5 w-3.5" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
