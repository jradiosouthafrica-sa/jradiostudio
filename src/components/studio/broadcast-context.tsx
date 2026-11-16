import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import type { RemoteAudioTrack, Room } from "livekit-client";
import { toast } from "sonner";

import { joinBroadcast, type BridgeStatus } from "@/lib/broadcast.functions";
import { useStudioActions } from "./studio-context";

export type BridgeState = "off" | "connecting" | "live" | "reconnecting";

export type BridgeParticipant = {
  identity: string;
  name: string;
  speaking: boolean;
  quality: string;
  hasAudio: boolean;
};

type BroadcastValue = {
  bridge: BridgeStatus;
  state: BridgeState;
  room: string | null;
  presenterName: string | null;
  participants: BridgeParticipant[];
  returnVolume: number;
  mutedReturn: Record<string, boolean>;
  goLive: (name: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  endBroadcast: () => Promise<void>;
  setReturnVolume: (v: number) => void;
  toggleReturnMute: (identity: string) => void;
};

const Ctx = createContext<BroadcastValue | null>(null);

export function BroadcastProvider({ children, bridge }: { children: ReactNode; bridge: BridgeStatus }) {
  const { getProgramStream } = useStudioActions();
  const join = useServerFn(joinBroadcast);
  const [state, setState] = useState<BridgeState>("off");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [presenterName, setPresenterName] = useState<string | null>(null);
  const [participants, setParticipants] = useState<BridgeParticipant[]>([]);
  const [returnVolume, setReturnVolumeState] = useState(0.8);
  const [mutedReturn, setMutedReturn] = useState<Record<string, boolean>>({});

  const roomRef = useRef<Room | null>(null);
  const programTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioEls = useRef(
    new Map<string, { track: RemoteAudioTrack; el: HTMLMediaElement; identity: string }>(),
  );
  const volRef = useRef(returnVolume);
  volRef.current = returnVolume;
  const mutedRef = useRef(mutedReturn);
  mutedRef.current = mutedReturn;
  const endingRef = useRef(false);

  const applyVolumes = useCallback(() => {
    audioEls.current.forEach(({ el, identity }) => {
      el.volume = mutedRef.current[identity] ? 0 : volRef.current;
    });
  }, []);

  useEffect(applyVolumes, [returnVolume, mutedReturn, applyVolumes]);

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return setParticipants([]);
    setParticipants(
      Array.from(room.remoteParticipants.values()).map((p) => ({
        identity: p.identity,
        name: p.name || p.identity,
        speaking: p.isSpeaking,
        quality: String(p.connectionQuality),
        hasAudio: Array.from(p.audioTrackPublications.values()).some(
          (t) => t.isSubscribed && !t.isMuted,
        ),
      })),
    );
  }, []);

  const cleanup = useCallback(() => {
    audioEls.current.forEach(({ track, el }) => {
      track.detach(el);
      el.remove();
    });
    audioEls.current.clear();
    roomRef.current = null;
    programTrackRef.current = null;
    setParticipants([]);
    setRoomName(null);
    setState("off");
  }, []);

  const goLive = useCallback<BroadcastValue["goLive"]>(
    async (name, password) => {
      if (roomRef.current) return { ok: true };
      setState("connecting");
      try {
        const res = await join({ data: { name, password } });
        if (!res.ok) {
          setState("off");
          return {
            ok: false,
            message:
              res.reason === "wrong_password"
                ? "That studio password isn't right."
                : "The bridge keys haven't been added yet, so the studio can't go live.",
          };
        }

        const [{ Room, RoomEvent, Track, AudioPresets }, stream] = await Promise.all([
          import("livekit-client"),
          getProgramStream(),
        ]);
        const room = new Room({
          adaptiveStream: false,
          dynacast: false,
          disconnectOnPageLeave: true,
        });
        roomRef.current = room;
        endingRef.current = false;

        room
          .on(RoomEvent.ParticipantConnected, refreshParticipants)
          .on(RoomEvent.ParticipantDisconnected, refreshParticipants)
          .on(RoomEvent.ActiveSpeakersChanged, refreshParticipants)
          .on(RoomEvent.ConnectionQualityChanged, refreshParticipants)
          .on(RoomEvent.TrackMuted, refreshParticipants)
          .on(RoomEvent.TrackUnmuted, refreshParticipants)
          .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
            if (track.kind === Track.Kind.Audio) {
              const el = track.attach();
              el.style.display = "none";
              document.body.appendChild(el);
              el.volume = mutedRef.current[participant.identity] ? 0 : volRef.current;
              audioEls.current.set(pub.trackSid, {
                track: track as RemoteAudioTrack,
                el,
                identity: participant.identity,
              });
            }
            refreshParticipants();
          })
          .on(RoomEvent.TrackUnsubscribed, (track, pub) => {
            const entry = audioEls.current.get(pub.trackSid);
            if (entry) {
              track.detach(entry.el);
              entry.el.remove();
              audioEls.current.delete(pub.trackSid);
            }
            refreshParticipants();
          })
          .on(RoomEvent.Reconnecting, () => setState("reconnecting"))
          .on(RoomEvent.Reconnected, () => setState("live"))
          .on(RoomEvent.Disconnected, () => {
            const unexpected = !endingRef.current;
            cleanup();
            if (unexpected)
              toast.error("Lost connection to the bridge", {
                description: "You are off air. Press Go live to reconnect.",
              });
          });

        await room.connect(res.url, res.token, { autoSubscribe: true });
        await room.startAudio().catch(() => {});

        const programTrack = stream.getAudioTracks()[0];
        if (!programTrack) throw new Error("No program audio available");
        programTrackRef.current = programTrack;
        await room.localParticipant.publishTrack(programTrack, {
          name: "program",
          source: Track.Source.Microphone,
          dtx: false,
          red: true,
          forceStereo: true,
          audioPreset: AudioPresets.musicHighQualityStereo,
          stopMicTrackOnMute: false,
        });

        setRoomName(res.room);
        setPresenterName(name);
        setState("live");
        refreshParticipants();
        return { ok: true };
      } catch (err) {
        console.error(err);
        endingRef.current = true;
        await roomRef.current?.disconnect(false).catch(() => {});
        cleanup();
        return {
          ok: false,
          message: "Couldn't connect to the bridge. Check your internet connection and try again.",
        };
      }
    },
    [cleanup, getProgramStream, join, refreshParticipants],
  );

  const endBroadcast = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    endingRef.current = true;
    const track = programTrackRef.current;
    if (track) await room.localParticipant.unpublishTrack(track, false).catch(() => {});
    await room.disconnect(false);
    cleanup();
  }, [cleanup]);

  useEffect(
    () => () => {
      endingRef.current = true;
      void roomRef.current?.disconnect(false);
    },
    [],
  );

  const value = useMemo<BroadcastValue>(
    () => ({
      bridge,
      state,
      room: roomName,
      presenterName,
      participants,
      returnVolume,
      mutedReturn,
      goLive,
      endBroadcast,
      setReturnVolume: setReturnVolumeState,
      toggleReturnMute: (identity) => setMutedReturn((m) => ({ ...m, [identity]: !m[identity] })),
    }),
    [bridge, state, roomName, presenterName, participants, returnVolume, mutedReturn, goLive, endBroadcast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBroadcast() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBroadcast must be used inside BroadcastProvider");
  return v;
}
