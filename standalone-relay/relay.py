import asyncio
import logging
import os
import signal
import urllib.parse
from dataclasses import dataclass

import numpy as np
from livekit import api, rtc

LOG = logging.getLogger("jradio-relay")
RATE = 48_000
CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_CHANNEL = RATE * FRAME_MS // 1000
FRAME_BYTES = SAMPLES_PER_CHANNEL * CHANNELS * 2


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def output_url() -> str:
    host = required("AZURACAST_HOST")
    port = required("AZURACAST_PORT")
    mount = required("AZURACAST_MOUNT")
    username = os.getenv("AZURACAST_SOURCE_USERNAME", "source").strip() or "source"
    password = required("AZURACAST_SOURCE_PASSWORD")
    if not mount.startswith("/"):
        mount = "/" + mount
    user = urllib.parse.quote(username, safe="")
    secret = urllib.parse.quote(password, safe="")
    return f"icecast://{user}:{secret}@{host}:{port}{mount}"


@dataclass
class Source:
    identity: str
    track_name: str
    queue: asyncio.Queue
    task: asyncio.Task | None = None
    stream: rtc.AudioStream | None = None


class Relay:
    def __init__(self) -> None:
        self.room_name = os.getenv("LIVEKIT_ROOM", "studio").strip() or "studio"
        self.track_name = os.getenv("PROGRAM_TRACK_NAME", "program").strip() or "program"
        self.identity = os.getenv("RELAY_IDENTITY", "jradio-azuracast-relay").strip()
        self.sources: dict[str, Source] = {}
        self.ffmpeg: asyncio.subprocess.Process | None = None
        self.running = True
        self.room = rtc.Room()

    async def start_encoder(self) -> None:
        bitrate = os.getenv("OUTPUT_BITRATE", "128k").strip() or "128k"
        url = output_url()
        args = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-f", "s16le", "-ar", str(RATE), "-ac", str(CHANNELS),
            "-i", "pipe:0",
            "-af", "alimiter=limit=0.95:level=false",
            "-c:a", "libmp3lame", "-b:a", bitrate,
            "-content_type", "audio/mpeg",
            "-ice_name", "JRadio Live",
            "-f", "mp3", url,
        ]
        LOG.info("Starting one MP3 output to AzuraCast mount %s", os.getenv("AZURACAST_MOUNT"))
        self.ffmpeg = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        asyncio.create_task(self._read_encoder_errors())

    async def _read_encoder_errors(self) -> None:
        if not self.ffmpeg or not self.ffmpeg.stderr:
            return
        while line := await self.ffmpeg.stderr.readline():
            LOG.warning("FFmpeg: %s", line.decode(errors="replace").rstrip())

    async def connect(self) -> None:
        url = required("LIVEKIT_URL")
        key = required("LIVEKIT_API_KEY")
        secret = required("LIVEKIT_API_SECRET")
        token = (
            api.AccessToken(key, secret)
            .with_identity(self.identity)
            .with_name("JRadio AzuraCast Relay")
            .with_grants(api.VideoGrants(
                room_join=True,
                room=self.room_name,
                can_publish=False,
                can_subscribe=True,
                can_publish_data=False,
                hidden=True,
            ))
            .to_jwt()
        )

        @self.room.on("track_published")
        def on_track_published(publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if publication.kind != rtc.TrackKind.KIND_AUDIO:
                return
            if publication.name != self.track_name:
                LOG.info("Ignoring non-program track %s from %s", publication.name, participant.identity)
                return
            LOG.info("Subscribing to programme track from %s", participant.identity)
            publication.set_subscribed(True)

        @self.room.on("track_subscribed")
        def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if track.kind != rtc.TrackKind.KIND_AUDIO or publication.name != self.track_name:
                return
            key_id = f"{participant.identity}:{publication.sid}"
            if key_id in self.sources:
                return
            source = Source(
                identity=participant.identity,
                track_name=publication.name,
                queue=asyncio.Queue(maxsize=3),
            )
            self.sources[key_id] = source
            source.stream = rtc.AudioStream.from_track(
                track=track,
                sample_rate=RATE,
                num_channels=CHANNELS,
                frame_size_ms=FRAME_MS,
                capacity=3,
            )
            source.task = asyncio.create_task(self._read_source(key_id, source))
            LOG.info("Programme source active: %s (%s)", participant.identity, publication.sid)

        @self.room.on("track_unsubscribed")
        def on_track_unsubscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            key_id = f"{participant.identity}:{publication.sid}"
            source = self.sources.pop(key_id, None)
            if source:
                if source.task:
                    source.task.cancel()
                LOG.info("Programme source removed: %s", participant.identity)

        await self.room.connect(url, token, rtc.RoomOptions(auto_subscribe=False))
        LOG.info("Connected to LiveKit room %s as read-only relay", self.room_name)

        # Subscribe only to the app's combined local programme tracks.
        # Other audio tracks (including future private/talkback tracks) are ignored.
        for participant in self.room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.name == self.track_name:
                    publication.set_subscribed(True)

    async def _read_source(self, key_id: str, source: Source) -> None:
        assert source.stream is not None
        try:
            async for event in source.stream:
                samples = np.frombuffer(event.frame.data, dtype=np.int16).copy()
                if samples.size % CHANNELS:
                    samples = samples[: samples.size - (samples.size % CHANNELS)]
                samples = samples.reshape((-1, CHANNELS))
                if samples.shape[0] < SAMPLES_PER_CHANNEL:
                    padded = np.zeros((SAMPLES_PER_CHANNEL, CHANNELS), dtype=np.int16)
                    padded[: samples.shape[0]] = samples
                    samples = padded
                elif samples.shape[0] > SAMPLES_PER_CHANNEL:
                    samples = samples[:SAMPLES_PER_CHANNEL]
                try:
                    source.queue.put_nowait(samples)
                except asyncio.QueueFull:
                    try:
                        source.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    source.queue.put_nowait(samples)
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.exception("Audio reader failed for %s", key_id)
        finally:
            if source.stream:
                await source.stream.aclose()

    async def mix_to_azuracast(self) -> None:
        LOG.info("Mixer running: %d Hz, stereo, %d ms frames", RATE, FRAME_MS)
        silence = np.zeros((SAMPLES_PER_CHANNEL, CHANNELS), dtype=np.int16)
        frame_seconds = FRAME_MS / 1000
        while self.running:
            started = asyncio.get_running_loop().time()
            active = list(self.sources.values())
            mixed = np.zeros((SAMPLES_PER_CHANNEL, CHANNELS), dtype=np.int32)
            for source in active:
                # Consume at most one 20 ms frame per source per output tick.
                # Draining the whole queue here would discard valid audio frames
                # and cause systematic gaps/dropouts.
                try:
                    frame = source.queue.get_nowait()
                except asyncio.QueueEmpty:
                    frame = None
                if frame is not None:
                    mixed += frame.astype(np.int32)

            peak = int(np.max(np.abs(mixed))) if mixed.size else 0
            # A simple peak limiter prevents clipping when multiple presenters overlap.
            ceiling = 29_200
            if peak > ceiling:
                mixed = (mixed.astype(np.float64) * (ceiling / peak)).astype(np.int32)
            output = np.clip(mixed, -32768, 32767).astype(np.int16) if active else silence
            if self.ffmpeg is None:
                raise RuntimeError("FFmpeg encoder was not started")
            if self.ffmpeg.returncode is not None:
                raise RuntimeError(
                    f"FFmpeg/AzuraCast output exited with code {self.ffmpeg.returncode}"
                )
            if self.ffmpeg.stdin is None:
                raise RuntimeError("FFmpeg encoder input pipe is unavailable")
            self.ffmpeg.stdin.write(output.tobytes())
            try:
                await self.ffmpeg.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                raise RuntimeError("FFmpeg/AzuraCast output closed; relay stopped to avoid silent failure")
            elapsed = asyncio.get_running_loop().time() - started
            await asyncio.sleep(max(0.0, frame_seconds - elapsed))

    async def run(self) -> None:
        await self.start_encoder()
        await self.connect()
        await self.mix_to_azuracast()

    async def close(self) -> None:
        self.running = False
        for source in list(self.sources.values()):
            if source.task:
                source.task.cancel()
            if source.stream:
                await source.stream.aclose()
        self.sources.clear()
        if self.room.isconnected():
            await self.room.disconnect()
        if self.ffmpeg and self.ffmpeg.returncode is None:
            if self.ffmpeg.stdin:
                self.ffmpeg.stdin.close()
            try:
                await asyncio.wait_for(self.ffmpeg.wait(), timeout=8)
            except asyncio.TimeoutError:
                self.ffmpeg.terminate()
                await self.ffmpeg.wait()


async def main() -> None:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    relay = Relay()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: setattr(relay, "running", False))
        except NotImplementedError:
            pass
    try:
        await relay.run()
    finally:
        await relay.close()


if __name__ == "__main__":
    asyncio.run(main())
