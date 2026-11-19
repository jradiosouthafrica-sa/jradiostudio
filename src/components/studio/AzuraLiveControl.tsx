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
import { AzuraWebcaster, type WebcasterStatus } from "@/lib/azura-webcaster";
import { getAzuraLiveLogin } from "@/lib/broadcast.functions";
import { useStudioActions } from "./studio-context";

export function AzuraLiveControl() {
  const { getProgramStream } = useStudioActions();
  const caster = useRef<AzuraWebcaster | null>(null);
  const [status, setStatus] = useState<WebcasterStatus>("idle");
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => caster.current?.stop(), []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await getAzuraLiveLogin({ data: { password } });
      if (!res.ok) {
        setError(
          res.reason === "wrong_password"
            ? "Wrong studio password."
            : "The AzuraCast DJ login hasn't been added yet.",
        );
        return;
      }
      const stream = await getProgramStream();
      const c = new AzuraWebcaster();
      c.onStatus = (s, msg) => {
        setStatus(s);
        if (s === "error" && msg) toast.error(msg);
        if (s === "live") toast.success("You're live on AzuraCast");
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

  if (status === "live" || status === "connecting") {
    return (
      <Button size="sm" variant="secondary" onClick={stop} className="font-display uppercase tracking-widest">
        {status === "connecting" ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
        {status === "connecting" ? "Connecting AzuraCast" : "Stop AzuraCast"}
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-on-air font-display font-bold uppercase tracking-widest text-on-air-foreground hover:bg-on-air/90"
      >
        <RadioTower /> Go live to AzuraCast
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={start}>
            <DialogHeader>
              <DialogTitle>Broadcast to AzuraCast</DialogTitle>
              <DialogDescription>
                Your decks and mic go straight to the station's listeners. Keep this tab open while on air.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 space-y-2">
              <Label htmlFor="az-pw">Studio password</Label>
              <Input id="az-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
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
