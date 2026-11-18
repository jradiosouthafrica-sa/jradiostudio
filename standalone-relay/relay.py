import asyncio
import base64
import logging
import os
import signal
from dataclasses import dataclass

import numpy as np
from livekit import api, rtc

LOG = logging.getLogger("jradio-relay")
RATE = 48_000
CHANNELS = 2
FRAME_MS = 20
SAMPLES_PER_CHANNEL = RATE * FRAME_MS // 1000


def required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def source_mount() -> str:
    mount = required("AZURACAST_MOUNT")
    if not mount.startswith("/"):
        mount = "/" + mount
    return mount


@dataclass
class Source:
    identity: str
    track_name: str
    queue: asyncio.Queue
    task: asyncio.Task | None = None
    stream: rtc.AudioStream | None = None
    frames_received: int = 0
    last_peak: int = 0


class Relay:
    def __init__(self) -> None:
        self.room_name = os.getenv("LIVEKIT_ROOM", "studio").strip() or "studio"
        self.track_name = os.getenv("PROGRAM_TRACK_NAME", "program").strip() or "program"
        self.identity = os.getenv("RELAY_IDENTITY", "jradio-azuracast-relay").strip()
        self.sources: dict[str, Source] = {}
        self.audio_ready = asyncio.Event()
        self.ffmpeg: asyncio.subprocess.Process | None = None
        self.encoder_error_task: asyncio.Task | None = None
        self.encoder_output_task: asyncio.Task | None = None
        self.azuracast_writer: asyncio.StreamWriter | None = None
        self.encoded_bytes_forwarded = 0
        self.running = True
        self.room = rtc.Room()

    async def start_encoder(self) -> None:
        if self.ffmpeg is not None:
            return

        host = required("AZURACAST_HOST")
        port = int(required("AZURACAST_PORT"))
        mount = source_mount()
        username = required("AZURACAST_SOURCE_USERNAME")
        password = required("AZURACAST_SOURCE_PASSWORD")
        auth = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")

        # FFmpeg's Icecast muxer rejects the provider's valid root mount "/".
        # Open the Icecast SOURCE connection ourselves so that "/" is preserved.
        LOG.info("Connecting to AzuraCast source %s:%d mount %s", host, port, mount)
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=12
        )
        request = (
            f"SOURCE {mount} HTTP/1.0\r\n"
            f"Authorization: Basic {auth}\r\n"
            "Content-Type: audio/mpeg\r\n"
            "User-Agent: JRadio-Relay/1.0\r\n"
            "ice-name: JRadio Live\r\n"
            "ice-public: 0\r\n"
            "\r\n"
        )
        writer.write(request.encode("ascii"))
        await writer.drain()
        try:
            response = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=12)
        except Exception:
            writer.close()
            await writer.wait_closed()
            raise RuntimeError("AzuraCast did not return a SOURCE handshake response")
        status = response.split(b"\r\n", 1)[0].decode("ascii", errors="replace")
        if not (status.startswith("HTTP/") and (" 200 " in status or " 201 " in status)):
            writer.close()
            await writer.wait_closed()
            raise RuntimeError(f"AzuraCast rejected the SOURCE connection: {status}")

        bitrate = os.getenv("OUTPUT_BITRATE", "128k").strip() or "128k"
        args = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-f", "s16le", "-ar", str(RATE), "-ac", str(CHANNELS),
            "-i", "pipe:0",
            "-af", "alimiter=limit=0.95:level=false",
            "-c:a", "libmp3lame", "-b:a", bitrate,
            "-f", "mp3", "pipe:1",
        ]
        LOG.info("AzuraCast accepted SOURCE connection; starting programme encoder")
        try:
            self.ffmpeg = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except Exception:
            writer.close()
            await writer.wait_closed()
            raise
        self.azuracast_writer = writer
        self.encoder_output_task = asyncio.create_task(self._forward_encoded_audio())
        self.encoder_error_task = asyncio.create_task(self._read_encoder_errors())

    async def _forward_encoded_audio(self) -> None:
        process = self.ffmpeg
        writer = self.azuracast_writer
        if not process or not process.stdout or not writer:
            raise RuntimeError("AzuraCast output stream is not ready")
        last_log = asyncio.get_running_loop().time()
        try:
            while chunk := await process.stdout.read(8192):
                writer.write(chunk)
                await writer.drain()
                self.encoded_bytes_forwarded += len(chunk)
                now = asyncio.get_running_loop().time()
                if now - last_log >= 5:
                    LOG.info(
                        "AzuraCast output forwarding: %d encoded bytes sent",
                        self.encoded_bytes_forwarded,
                    )
                    last_log = now
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise RuntimeError("AzuraCast source connection closed while streaming") from exc

    async def _read_encoder_errors(self) -> None:
        process = self.ffmpeg
        if not process or not process.stderr:
            return
        while line := await process.stderr.readline():
            LOG.warning("FFmpeg: %s", line.decode(errors="replace").rstrip())

    async def stop_encoder(self) -> None:
        process, self.ffmpeg = self.ffmpeg, None
        if process and process.returncode is None:
            if process.stdin:
                process.stdin.close()
            try:
                await asyncio.wait_for(process.wait(), timeout=8)
            except asyncio.TimeoutError:
                process.terminate()
                await process.wait()

        output_task, self.encoder_output_task = self.encoder_output_task, None
        if output_task:
            if not output_task.done():
                try:
                    await asyncio.wait_for(output_task, timeout=3)
                except asyncio.TimeoutError:
                    output_task.cancel()
            await asyncio.gather(output_task, return_exceptions=True)

        writer, self.azuracast_writer = self.azuracast_writer, None
        if writer:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

        task, self.encoder_error_task = self.encoder_error_task, None
        if task:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    def _remove_source(self, key_id: str) -> None:
        source = self.sources.pop(key_id, None)
        if source:
            if source.task and source.task is not asyncio.current_task():
                source.task.cancel()
            LOG.info("Programme source removed: %s", source.identity)
        if not self.sources:
            self.audio_ready.clear()

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
            LOG.info("Programme source subscribed: %s (%s)", participant.identity, publication.sid)

        @self.room.on("track_unsubscribed")
        def on_track_unsubscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            self._remove_source(f"{participant.identity}:{publication.sid}")

        await self.room.connect(url, token, rtc.RoomOptions(auto_subscribe=False))
        LOG.info("Connected to LiveKit room %s as read-only relay", self.room_name)

        # Only the studio app's combined programme tracks are subscribed.
        # Private/talkback tracks with other names are ignored.
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
                source.frames_received += 1
                source.last_peak = int(np.max(np.abs(samples))) if samples.size else 0
                if source.frames_received % 250 == 0:
                    LOG.info(
                        "LiveKit audio received from %s: %d frames, latest peak %d/32768",
                        source.identity,
                        source.frames_received,
                        source.last_peak,
                    )
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
                self.audio_ready.set()
        except asyncio.CancelledError:
            raise
        except Exception:
            LOG.exception("Audio reader failed for %s", key_id)
        finally:
            if source.stream:
                await source.stream.aclose()
            if self.sources.get(key_id) is source:
                self.sources.pop(key_id, None)
                LOG.info("Programme reader ended: %s", source.identity)
            if not self.sources:
                self.audio_ready.clear()

    async def wait_for_audio(self) -> bool:
        while self.running:
            if any(not source.queue.empty() for source in self.sources.values()):
                return True
            self.audio_ready.clear()
            try:
                await asyncio.wait_for(self.audio_ready.wait(), timeout=1)
            except asyncio.TimeoutError:
                pass
        return False

    async def mix_to_azuracast(self) -> None:
        LOG.info("Programme mixer active: %d Hz, stereo, %d ms frames", RATE, FRAME_MS)
        frame_seconds = FRAME_MS / 1000
        grace_seconds = max(0.0, float(os.getenv("SOURCE_LOSS_GRACE_SECONDS", "120")))
        no_source_since: float | None = None
        loop = asyncio.get_running_loop()
        mix_frames = 0
        last_mix_log = loop.time()

        # Keep the same AzuraCast SOURCE session alive through brief LiveKit
        # track handoffs. During the grace window, send silence rather than
        # disconnecting and triggering AutoDJ/live-source switching.
        while self.running:
            started = loop.time()
            active = list(self.sources.values())
            mixed = np.zeros((SAMPLES_PER_CHANNEL, CHANNELS), dtype=np.int32)

            if not active:
                if no_source_since is None:
                    no_source_since = started
                    LOG.warning(
                        "No programme sources remain; holding AzuraCast input for %.1f seconds before AutoDJ handoff",
                        grace_seconds,
                    )
                if started - no_source_since >= grace_seconds:
                    LOG.info(
                        "Programme source grace period expired; closing AzuraCast input so station AutoDJ can resume"
                    )
                    break
            else:
                if no_source_since is not None:
                    LOG.info(
                        "Programme source returned within grace period; continuing the existing AzuraCast input"
                    )
                    no_source_since = None
                for source in active:
                    try:
                        frame = source.queue.get_nowait()
                    except asyncio.QueueEmpty:
                        frame = None
                    if frame is not None:
                        mixed += frame.astype(np.int32)

            peak = int(np.max(np.abs(mixed))) if mixed.size else 0
            mix_frames += 1
            if loop.time() - last_mix_log >= 5:
                LOG.info(
                    "Programme mix level: sources=%d, peak=%d/32768, frames=%d",
                    len(active),
                    peak,
                    mix_frames,
                )
                last_mix_log = loop.time()

            output_task = self.encoder_output_task
            if output_task and output_task.done():
                error = output_task.exception()
                if error:
                    raise RuntimeError(f"AzuraCast output forwarding failed: {error}") from error
                raise RuntimeError("AzuraCast output forwarding stopped unexpectedly")

            ceiling = 29_200
            if peak > ceiling:
                mixed = (mixed.astype(np.float64) * (ceiling / peak)).astype(np.int32)
            output = np.clip(mixed, -32768, 32767).astype(np.int16)

            process = self.ffmpeg
            if process is None:
                raise RuntimeError("FFmpeg encoder was not started")
            if process.returncode is not None:
                raise RuntimeError(f"FFmpeg/AzuraCast output exited with code {process.returncode}")
            if process.stdin is None:
                raise RuntimeError("FFmpeg encoder input pipe is unavailable")
            process.stdin.write(output.tobytes())
            try:
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                raise RuntimeError("FFmpeg/AzuraCast output closed; relay stopped")
            elapsed = loop.time() - started
            await asyncio.sleep(max(0.0, frame_seconds - elapsed))

    async def run(self) -> None:
        # Connect to LiveKit first. Never claim the AzuraCast mount with silence.
        await self.connect()
        while self.running:
            if not await self.wait_for_audio():
                break
            if not self.sources:
                continue
            await self.start_encoder()
            await self.mix_to_azuracast()
            await self.stop_encoder()

    async def close(self) -> None:
        self.running = False
        self.audio_ready.set()
        for key_id in list(self.sources):
            self._remove_source(key_id)
        self.sources.clear()
        if self.room.isconnected():
            await self.room.disconnect()
        await self.stop_encoder()


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
