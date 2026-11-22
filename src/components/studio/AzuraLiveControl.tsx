import { useEffect, useRef, useState } from "react";
import { Loader2, RadioTower, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AzuraWebcaster, type WebcasterStatus } from "@/lib/azura-webcaster";
import { getAzuraLiveLogin, getAzuraOnAir, getLiveRoutes } from "@/lib/broadcast.functions";
import type { LiveRoute } from "@/lib/studio-logic";
import { cn } from "@/lib/utils";
import { useStudio, useStudioActions } from "./studio-context";

const ROUTE_KEY = "airdesk.liveRoute";

/** Single on-air control: streams the studio mix to AzuraCast and confirms with AzuraCast that it's live. */
export function AzuraLiveControl() {
  const { getProgramStream } = useStudioActions();
  const { decks, crossfader, micOpen } = useStudio();
  const caster = useRef<AzuraWebcaster | null>(null);
  const [status, setStatus] = useState<WebcasterStatus>("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [listeners, setListeners] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [encoderReady, setEncoderReady] = useState(false);
  const [route, setRoute] = useState<LiveRoute>("encoder");
  const [activeRoute, setActiveRoute] = useState<LiveRoute | null>(null);

  useEffect(() => () => caster.current?.stop(), []);

  // When the Go Live window opens, check whether the VPS encoder is set up and recall the last choice.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getLiveRoutes()
      .then((r) => {
        if (cancelled) return;
        setEncoderReady(r.encoder);
        const saved = window.localStorage.getItem(ROUTE_KEY);
        setRoute(!r.encoder ? "direct" : saved === "direct" ? "direct" : "encoder");
      })
      .catch(() => {
        if (!cancelled) setRoute("direct");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Poll AzuraCast while connected: only call it "on air" once AzuraCast itself reports a live DJ.
  useEffect(() => {
    if (status !== "live") {
      setConfirmed(false);
      return;
    }
    let cancelled = false;
    let wasConfirmed = false;
    const check = async () => {
      const r = await getAzuraOnAir().catch(() => null);
      if (cancelled || !r) return;
      setConfirmed(r.isLive);
      setListeners(r.listeners);
      if (r.isLive && !wasConfirmed) toast.success("AzuraCast confirms you're on air");
      wasConfirmed = r.isLive;
    };
    check();
    const id = window.setInterval(check, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [status]);

  // Send the audible deck's track to AzuraCast so the public player shows what's playing.
  const audible =
    decks.A.playing && decks.B.playing
      ? crossfader <= 0
        ? decks.A
        : decks.B
      : decks.A.playing
        ? decks.A
        : decks.B.playing
          ? decks.B
          : null;
  const trackKey = audible?.track ? audible.track.id : null;
  useEffect(() => {
    if (status !== "live" || !audible?.track) return;
    caster.current?.sendMetadata(audible.track.title, audible.track.artist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, trackKey]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await getAzuraLiveLogin({ data: { password, route } });
      if (!res.ok) {
        setError(
          res.reason === "wrong_password"
            ? "Wrong studio password."
            : res.reason === "encoder_not_configured"
              ? "The VPS encoder isn't set up on this server yet — choose Direct."
              : "The AzuraCast DJ login hasn't been added yet.",
        );
        return;
      }
      window.localStorage.setItem(ROUTE_KEY, route);
      setActiveRoute(res.route);
      const stream = await getProgramStream();
      const c = new AzuraWebcaster();
      let prev: WebcasterStatus = "idle";
      c.onStatus = (s, msg) => {
        if (s === "error" && msg) toast.error(msg);
        if (s === "reconnecting" && prev === "live")
          toast.warning(res.route === "encoder" ? "Connection to the encoder dropped" : "Connection to AzuraCast dropped", {
            description: "Reconnecting automatically — stay on this tab.",
          });
        if (s === "live" && prev === "reconnecting") toast.success("Reconnected");
        prev = s;
        setStatus(s);
      };
      caster.current = c;
      c.start(stream, res);
      setPassword("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    caster.current?.stop();
    caster.current = null;
  }

  const onAir = status === "live" && confirmed;
  const lamp = onAir
    ? micOpen
      ? "On air · mic live"
      : "On air"
    : status === "live"
      ? "Waiting for AzuraCast…"
      : status === "reconnecting"
        ? "Reconnecting…"
        : status === "connecting"
          ? "Connecting…"
          : micOpen
            ? "Mic open · off air"
            : "Off air";

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-1.5 font-display text-sm font-bold uppercase tracking-[0.2em] transition-colors",
          onAir
            ? "glow-on-air border-on-air bg-on-air text-on-air-foreground"
            : status !== "idle" && status !== "error"
              ? "border-on-air/60 text-on-air"
              : "border-border text-muted-foreground",
        )}
        aria-live="polite"
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            onAir
              ? "bg-on-air-foreground"
              : status === "live" || status === "reconnecting"
                ? "animate-pulse bg-on-air"
                : "bg-meter-off",
          )}
        />
        {lamp}
        {status !== "idle" && status !== "error" && activeRoute && (
          <span className="font-mono text-[10px] normal-case tracking-normal opacity-80">
            {activeRoute === "encoder" ? "· Icecast" : "· Web DJ"}
          </span>
        )}
        {onAir && listeners !== null && (
          <span className="font-mono text-xs normal-case tracking-normal">
            · {listeners} listening
          </span>
        )}
      </div>

      {status === "live" || status === "connecting" || status === "reconnecting" ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={stop}
          className="font-display uppercase tracking-widest"
        >
          {status === "connecting" || status === "reconnecting" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Square className="fill-current" />
          )}
          End broadcast
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          className="bg-on-air font-display font-bold uppercase tracking-widest text-on-air-foreground hover:bg-on-air/90"
        >
          <RadioTower /> Go live
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={start}>
            <DialogHeader>
              <DialogTitle>Go live on AzuraCast</DialogTitle>
              <DialogDescription>
                Your decks and mic go to the station's listeners. Make sure BUTT or any other DJ app
                is closed, and keep this tab open while on air.
              </DialogDescription>
            </DialogHeader>
            <RadioGroup
              value={route}
              onValueChange={(v) => setRoute(v as LiveRoute)}
              className="mt-4"
              aria-label="How to send the studio"
            >
              <Label
                htmlFor="route-encoder"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                  route === "encoder" ? "border-primary" : "border-border",
                  !encoderReady && "cursor-not-allowed opacity-50",
                )}
              >
                <RadioGroupItem id="route-encoder" value="encoder" disabled={!encoderReady} className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block font-semibold">VPS encoder (Icecast)</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {encoderReady
                      ? "Your server encodes MP3 and logs in to AzuraCast like BUTT — fastest takeover."
                      : "Not set up on this server yet."}
                  </span>
                </span>
              </Label>
              <Label
                htmlFor="route-direct"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3",
                  route === "direct" ? "border-primary" : "border-border",
                )}
              >
                <RadioGroupItem id="route-direct" value="direct" className="mt-0.5" />
                <span className="space-y-1">
                  <span className="block font-semibold">Direct (AzuraCast Web DJ)</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    Streams straight to AzuraCast. Use this if the encoder is down.
                  </span>
                </span>
              </Label>
            </RadioGroup>
            <div className="my-4 space-y-2">
              <Label htmlFor="az-pw">Studio password</Label>
              <Input
                id="az-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !password}>
                {busy && <Loader2 className="animate-spin" />} Go live
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
