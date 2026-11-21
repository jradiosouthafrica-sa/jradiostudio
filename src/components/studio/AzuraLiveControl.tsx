import { useEffect, useRef, useState } from "react";
import { Loader2, RadioTower, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IcecastWebcaster, type WebcasterStatus } from "@/lib/icecast-webcaster";
import { getIcecastBroadcastToken, getAzuraOnAir } from "@/lib/broadcast.functions";
import { cn } from "@/lib/utils";
import { useStudio, useStudioActions } from "./studio-context";

export function AzuraLiveControl() {
  const { getProgramStream } = useStudioActions();
  const { decks, crossfader, micOpen } = useStudio();
  const caster = useRef<IcecastWebcaster | null>(null);
  const [status, setStatus] = useState<WebcasterStatus>("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [listeners, setListeners] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => caster.current?.stop(), []);

  useEffect(() => {
    if (status !== "live") { setConfirmed(false); return; }
    let cancelled = false;
    let wasConfirmed = false;
    const check = async () => {
      const result = await getAzuraOnAir().catch(() => null);
      if (cancelled || !result) return;
      setConfirmed(result.isLive);
      setListeners(result.listeners);
      if (result.isLive && !wasConfirmed) toast.success("AzuraCast confirms you're on air");
      wasConfirmed = result.isLive;
    };
    void check();
    const id = window.setInterval(check, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [status]);

  const audible = decks.A.playing && decks.B.playing
    ? crossfader <= 0 ? decks.A : decks.B
    : decks.A.playing ? decks.A : decks.B.playing ? decks.B : null;
  const trackKey = audible?.track?.id ?? null;
  useEffect(() => {
    if (status === "live" && audible?.track) caster.current?.sendMetadata(audible.track.title, audible.track.artist);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, trackKey]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await getIcecastBroadcastToken({ data: { password } });
      if (!result.ok) {
        setError(result.reason === "wrong_password" ? "Wrong studio password." : "VPS Icecast settings are incomplete. Contact the administrator.");
        return;
      }
      const stream = await getProgramStream();
      const broadcaster = new IcecastWebcaster();
      broadcaster.onStatus = (next, message) => {
        setStatus(next);
        if (next === "error" && message) toast.error(message);
      };
      caster.current = broadcaster;
      broadcaster.start(stream, result.token);
      setPassword("");
      setOpen(false);
    } catch (err) {
      console.error(err);
      setError("Could not start the VPS broadcast. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    caster.current?.stop();
    caster.current = null;
    setStatus("idle");
  }

  const onAir = status === "live" && confirmed;
  const lamp = onAir
    ? micOpen ? "On air · mic live" : "On air"
    : status === "live" ? "Waiting for AzuraCast…"
    : status === "connecting" ? "Connecting to VPS…"
    : micOpen ? "Mic open · off air" : "Off air";

  return (
    <>
      <div className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 font-display text-sm font-bold uppercase tracking-[0.2em] transition-colors",
        onAir ? "glow-on-air border-on-air bg-on-air text-on-air-foreground"
          : status !== "idle" && status !== "error" ? "border-on-air/60 text-on-air" : "border-border text-muted-foreground",
      )} aria-live="polite">
        <span className={cn("h-2 w-2 rounded-full", onAir ? "bg-on-air-foreground" : status === "live" ? "animate-pulse bg-on-air" : "bg-meter-off")} />
        {lamp}
        {onAir && listeners !== null && <span className="font-mono text-xs normal-case tracking-normal">· {listeners} listening</span>}
      </div>
      {status === "live" || status === "connecting" ? (
        <Button size="sm" variant="secondary" onClick={stop} className="font-display uppercase tracking-widest">
          {status === "connecting" ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
          End broadcast
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)} className="bg-on-air font-display font-bold uppercase tracking-widest text-on-air-foreground hover:bg-on-air/90">
          <RadioTower /> Go live
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={start}>
            <DialogHeader>
              <DialogTitle>Go live on AzuraCast</DialogTitle>
              <DialogDescription>
                AirDesk sends your mixed programme audio securely to the VPS. The VPS encodes MP3 and connects to AzuraCast. Keep this tab open while broadcasting.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="az-pw">Studio password</Label>
              <Input id="az-pw" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
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
