import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpDown, ListPlus, Library, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime, isInFolder, listFolders, sortByPath } from "@/lib/studio-logic";
import type { DeckId, LibraryResponse, Track } from "@/lib/studio-types";
import { cn } from "@/lib/utils";
import { TrackArt } from "./TrackArt";
import { useStudio, useStudioActions } from "./studio-context";

const MAX_ROWS = 300;
type SortKey = "title" | "artist" | "album" | "duration";
const ALL = "__all";
const TOP = "__top";
const folderLabel = (f: string) => (f === "" ? "Top level (no folder)" : f);

const Row = memo(function Row({
  track,
  busyA,
  busyB,
  selected,
  onLoad,
  onQueue,
  onSelect,
}: {
  track: Track;
  busyA: boolean;
  busyB: boolean;
  selected: boolean;
  onLoad: (deck: DeckId, t: Track) => void;
  onQueue: (t: Track) => void;
  onSelect: (id: string, on: boolean) => void;
}) {
  return (
    <tr
      className={cn(
        "group border-b border-border/50 hover:bg-panel-raised",
        selected && "bg-primary/10",
      )}
      onDoubleClick={() => onQueue(track)}
    >
      <td className="py-1.5 pl-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(track.id, v === true)}
          aria-label={`Select ${track.title}`}
        />
      </td>
      <td className="py-1.5 pr-2">
        <TrackArt track={track} className="h-8 w-8" />
      </td>
      <td className="max-w-0 py-1.5 pr-3">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground md:hidden">{track.artist}</p>
      </td>
      <td className="hidden max-w-0 truncate py-1.5 pr-3 text-sm text-muted-foreground md:table-cell">
        {track.artist}
      </td>
      <td className="hidden max-w-0 truncate py-1.5 pr-3 text-sm text-muted-foreground lg:table-cell">
        {track.album || "—"}
      </td>
      <td className="hidden py-1.5 pr-3 xl:table-cell">
        <div className="flex flex-wrap gap-1">
          {track.playlists.slice(0, 2).map((p) => (
            <span
              key={p}
              className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
            >
              {p}
            </span>
          ))}
        </div>
      </td>
      <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {track.duration ? formatTime(track.duration) : "—"}
      </td>
      <td className="py-1.5 pr-3">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => onLoad("A", track)}
            disabled={busyA}
            title={busyA ? "Deck A is playing" : "Load to Deck A"}
            aria-label={`Load ${track.title} to Deck A`}
            className="h-7 w-7 rounded-sm border border-deck-a/40 font-display text-xs font-bold text-deck-a hover:bg-deck-a hover:text-deck-a-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-deck-a"
          >
            A
          </button>
          <button
            type="button"
            onClick={() => onLoad("B", track)}
            disabled={busyB}
            title={busyB ? "Deck B is playing" : "Load to Deck B"}
            aria-label={`Load ${track.title} to Deck B`}
            className="h-7 w-7 rounded-sm border border-deck-b/40 font-display text-xs font-bold text-deck-b hover:bg-deck-b hover:text-deck-b-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-deck-b"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => onQueue(track)}
            title="Add to running order"
            aria-label={`Add ${track.title} to running order`}
            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
});

export function MusicBrowser({ library }: { library: LibraryResponse }) {
  const { decks } = useStudio();
  const { loadTrack, addToQueue, addManyToQueue } = useStudioActions();
  const [query, setQuery] = useState("");
  const [playlist, setPlaylist] = useState("all");
  const [folder, setFolder] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "artist", dir: 1 });
  const deferredQuery = useDeferredValue(query);

  const playlists = useMemo(
    () =>
      Array.from(new Set(library.tracks.flatMap((t) => t.playlists))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [library.tracks],
  );

  const folders = useMemo(() => listFolders(library.tracks.map((t) => t.path)), [library.tracks]);
  const folderPath = folder === ALL ? null : folder === TOP ? "" : folder;

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const list = library.tracks.filter((t) => {
      if (playlist !== "all" && !t.playlists.includes(playlist)) return false;
      if (folderPath !== null && !isInFolder(t.path, folderPath)) return false;
      if (!terms.length) return true;
      const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.path}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
    const { key, dir } = sort;
    return list.sort((a, b) =>
      key === "duration" ? (a.duration - b.duration) * dir : a[key].localeCompare(b[key]) * dir,
    );
  }, [library.tracks, deferredQuery, playlist, folderPath, sort]);

  const folderTracks = useMemo(
    () =>
      folderPath === null
        ? []
        : sortByPath(library.tracks.filter((t) => isInFolder(t.path, folderPath))),
    [library.tracks, folderPath],
  );

  const selectedInView = filtered.filter((t) => selected.has(t.id)).length;
  const allChecked = filtered.length > 0 && selectedInView === filtered.length;
  const headerChecked = allChecked ? true : selectedInView > 0 ? "indeterminate" : false;

  const onSelect = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) filtered.forEach((t) => next.delete(t.id));
      else filtered.forEach((t) => next.add(t.id));
      return next;
    });

  const addSelected = () => {
    // Keep the order the presenter sees in the list.
    const picked = filtered.filter((t) => selected.has(t.id));
    const hidden = library.tracks.filter(
      (t) => selected.has(t.id) && !picked.some((p) => p.id === t.id),
    );
    addManyToQueue([...picked, ...hidden]);
    setSelected(new Set());
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const SortHead = ({
    k,
    children,
    className,
  }: {
    k: SortKey;
    children: string;
    className?: string;
  }) => (
    <th className={cn("py-2 pr-3 font-normal", className)}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          "console-label inline-flex items-center gap-1 hover:text-foreground",
          sort.key === k ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  return (
    <section aria-label="Music library" className="console-panel flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="mr-2 flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" />
          <span className="console-label">Music library</span>
          <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
            {library.mode === "live" ? "AzuraCast" : "Demo"}
          </span>
        </div>
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, artist, album or file…"
            aria-label="Search music"
            className="h-8 bg-groove pl-8"
          />
        </div>
        <Select value={playlist} onValueChange={setPlaylist}>
          <SelectTrigger className="h-8 w-44 bg-groove" aria-label="Filter by playlist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All playlists</SelectItem>
            {playlists.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={folder} onValueChange={setFolder}>
          <SelectTrigger className="h-8 w-52 bg-groove" aria-label="Filter by folder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All folders</SelectItem>
            {folders.map(({ folder: f, count }) => (
              <SelectItem key={f || TOP} value={f === "" ? TOP : f}>
                {`${folderLabel(f)} (${count})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtered.length.toLocaleString()} of {library.tracks.length.toLocaleString()}
        </span>
      </header>

      {(folderPath !== null || selected.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel-raised/60 px-3 py-2">
          {folderPath !== null && (
            <Button
              size="sm"
              onClick={() => addManyToQueue(folderTracks, `Folder: ${folderLabel(folderPath)}`)}
              disabled={!folderTracks.length}
            >
              <ListPlus /> Add whole folder ({folderTracks.length})
            </Button>
          )}
          {selected.size > 0 && (
            <>
              <Button size="sm" variant="secondary" onClick={addSelected}>
                <Plus /> Add {selected.size} selected
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
              >
                <X /> Clear
              </Button>
            </>
          )}
          {folderPath !== null && (
            <span className="text-xs text-muted-foreground">
              Whole folder is added in file-name order, including sub-folders.
            </span>
          )}
        </div>
      )}

      {library.mode === "demo" && (
        <div className="flex items-start gap-2 border-b border-border bg-primary/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <p>
            {library.error
              ? `AzuraCast couldn't be reached (${library.error}). Showing sample tracks instead.`
              : "Showing free sample tracks. Connect your AzuraCast station to browse your own music."}
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed text-left">
          <colgroup>
            <col className="w-9" />
            <col className="w-12" />
            <col />
            <col className="hidden md:table-column" />
            <col className="hidden lg:table-column" />
            <col className="hidden w-36 xl:table-column" />
            <col className="w-16" />
            <col className="w-28" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-border">
              <th className="py-2 pl-3 text-left">
                <Checkbox
                  checked={headerChecked}
                  onCheckedChange={toggleAll}
                  disabled={!filtered.length}
                  aria-label={`Select all ${filtered.length} tracks`}
                  title="Select all tracks in this list"
                />
              </th>
              <th className="py-2" />
              <SortHead k="title">Title</SortHead>
              <SortHead k="artist" className="hidden md:table-cell">
                Artist
              </SortHead>
              <SortHead k="album" className="hidden lg:table-cell">
                Album
              </SortHead>
              <th className="console-label hidden py-2 pr-3 font-normal text-muted-foreground xl:table-cell">
                Playlists
              </th>
              <SortHead k="duration" className="text-right">
                Time
              </SortHead>
              <th className="console-label py-2 pr-3 text-right font-normal text-muted-foreground">
                Load
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, MAX_ROWS).map((t) => (
              <Row
                key={t.id}
                track={t}
                busyA={decks.A.playing}
                busyB={decks.B.playing}
                selected={selected.has(t.id)}
                onLoad={loadTrack}
                onQueue={addToQueue}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">
            No tracks match your search.
          </p>
        )}
        {filtered.length > MAX_ROWS && (
          <p className="px-3 py-3 text-center text-xs text-muted-foreground">
            Showing the first {MAX_ROWS} results — refine your search to see more.
          </p>
        )}
      </div>
    </section>
  );
}
