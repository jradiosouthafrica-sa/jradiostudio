import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Deck } from "@/components/studio/Deck";
import { MixerPanel } from "@/components/studio/MixerPanel";
import { MusicBrowser } from "@/components/studio/MusicBrowser";
import { QueuePanel } from "@/components/studio/QueuePanel";
import { StudioHeader } from "@/components/studio/StudioHeader";
import { StudioProvider } from "@/components/studio/studio-context";
import { libraryQueryOptions } from "@/lib/library.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Presenter Studio — AirDesk" },
      {
        name: "description",
        content: "Remote presenter studio with twin decks, a live mixer and your AzuraCast music library.",
      },
      { property: "og:title", content: "Presenter Studio — AirDesk" },
      {
        property: "og:description",
        content: "Remote presenter studio with twin decks, a live mixer and your AzuraCast music library.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(libraryQueryOptions()),
  component: StudioPage,
});

function StudioPage() {
  const { data: library } = useSuspenseQuery(libraryQueryOptions());

  return (
    <StudioProvider>
      <div className="flex min-h-screen flex-col xl:h-screen xl:overflow-hidden">
        <StudioHeader library={library} />
        <main className="grid min-h-0 flex-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Deck id="A" />
              <MixerPanel />
              <Deck id="B" />
            </div>
            <div className="flex min-h-[420px] flex-1 flex-col xl:min-h-0">
              <MusicBrowser library={library} />
            </div>
          </div>
          <div className="flex min-h-[360px] flex-col xl:min-h-0">
            <QueuePanel />
          </div>
        </main>
      </div>
    </StudioProvider>
  );
}
