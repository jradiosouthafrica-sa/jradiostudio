import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Headphones, Loader2, Radio, Square } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { bridgeStatusQueryOptions } from "@/lib/broadcast.functions";
import { cn } from "@/lib/utils";
import { useBroadcast } from "./broadcast-context";

const NAME_KEY = "airdesk.presenterName";

export function GoLiveControl() {
  const { state, goLive, endBroadcast } = useBroadcast();
  const { data: bridge } = useQuery(bridgeStatusQueryOptions());
  const [open, setOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(window.localStorage.getItem(NAME_KEY) ?? "");
  }, []);

  const live = state === "live" || state === "reconnecting";
  const connecting = state === "connecting";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    window.localStorage.setItem(NAME_KEY, name.trim());
    const res = await goLive(name.trim(), password);
    if (res.ok) {
      setPassword("");
      setOpen(false);
    } else setError(res.message ?? "Couldn't go live.");
  }

  if (live) {
    return (
      <>
        <Button
          size="sm"
          onClick={() => setConfirmEnd(true)}
          className="bg-secondary font-display text-sm font-bold uppercase tracking-widest text-foreground hover:bg-accent"
        >
          <Square className="fill-current" /> End broadcast
        </Button>
        <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End your broadcast?</AlertDialogTitle>
              <AlertDialogDescription>
                Your decks and mic will stop going out to the station. You can keep preparing tracks
                locally.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay on air</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void endBroadcast()}
                className="bg-on-air text-on-air-foreground hover:bg-on-air/90"
              >
                End broadcast
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={connecting}
        className={cn(
          "font-display text-sm font-bold uppercase tracking-widest",
          "bg-on-air text-on-air-foreground hover:bg-on-air/90",
        )}
      >
        {connecting ? <Loader2 className="animate-spin" /> : <Radio />}
        {connecting ? "Connecting" : "Go live"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Go live on the station</DialogTitle>
              <DialogDescription>
                Your decks and mic will be sent to the studio bridge
                {bridge?.host ? ` at ${bridge.host}` : ""}. You'll hear co-hosts back through this
                browser.
              </DialogDescription>
            </DialogHeader>

            {bridge && !bridge.configured && (
              <p className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
                The bridge keys haven't been added yet, so going live won't work until they are.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="presenter-name">Presenter name</Label>
              <Input
                id="presenter-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. DJ Thabo"
                maxLength={60}
                required
                autoComplete="nickname"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="studio-password">Studio password</Label>
              <Input
                id="studio-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <Headphones className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              Wear headphones. Co-hosts coming out of speakers would be picked up by your mic and
              sent back on air.
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={connecting || !name.trim() || !password}
                className="bg-on-air text-on-air-foreground hover:bg-on-air/90"
              >
                {connecting ? <Loader2 className="animate-spin" /> : <Radio />}
                Go live
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
