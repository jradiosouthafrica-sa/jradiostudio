import { Disc3 } from "lucide-react";

import type { Track } from "@/lib/studio-types";
import { cn } from "@/lib/utils";

export function TrackArt({ track, className }: { track: Track | null; className?: string }) {
  if (track?.art) {
    return (
      <img
        src={track.art}
        alt=""
        loading="lazy"
        className={cn("shrink-0 rounded-sm bg-groove object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm bg-groove text-muted-foreground",
        className,
      )}
    >
      <Disc3 className="h-1/2 w-1/2" strokeWidth={1.5} />
    </div>
  );
}
