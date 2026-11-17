# JRadio LiveKit → AzuraCast Relay (standalone)

This is a separate relay service. It does not modify the JRadio Studio app, the LiveKit server, or AzuraCast AutoDJ configuration. It is deliberately kept in its own directory and Docker container so it can be started, stopped, or removed independently.

## Audio path

1. Each JRadio Studio participant publishes one local track named `program`. The app's `program` track is its local programme mix (that presenter's decks plus microphone).
2. The relay joins the configured LiveKit room as a hidden, read-only participant.
3. It disables automatic subscriptions and subscribes only to audio publications named `program`. It ignores all other audio/video tracks.
4. It decodes each subscribed programme track, mixes all active programme sources into one stereo programme, applies a peak limiter, and encodes one MP3 output.
5. FFmpeg sends that single output to the configured AzuraCast live/DJ input mount. AzuraCast then distributes one station stream to listeners.

The relay is not an audio source itself. It does not publish back into LiveKit, so it cannot create a feedback loop. Private talkback or other tracks with different names are not subscribed.

## Requirements

- Docker Engine and Docker Compose plugin on the VPS.
- Network access from the VPS to the LiveKit WebSocket URL and the AzuraCast DJ/live input host and port.
- LiveKit API key/secret for a subscriber-only token.
- AzuraCast DJ/live input connection details: hostname, port, mount, username and password. Obtain/confirm these from the AzuraCast hosting provider; do not assume the public listener URL is the input endpoint.

## Configure

On the VPS, copy this directory to a separate location, for example `/opt/jradio-relay`. Then:

```sh
cp .env.example .env
nano .env
```

Fill in the actual LiveKit and AzuraCast input values directly on the VPS. Keep `.env` private; do not upload it to GitHub or paste its contents into chat.

`AZURACAST_MOUNT` must be the DJ/live input mount provided for the station. It is not necessarily the public listener mount. `AZURACAST_SOURCE_PASSWORD` is the DJ/live input password, not the AzuraCast API key.

## Start and stop independently

```sh
docker compose up -d --build
```

View only this relay's logs:

```sh
docker compose logs -f --tail=100 jradio-relay
```

Stop only this relay:

```sh
docker compose down
```

These commands do not stop or recreate any other container. Do not add this service to the existing LiveKit Compose project.

## Important first-deployment checks

- Confirm the relay logs show it connected to the intended LiveKit room.
- When the main studio and remote presenter are live, logs should show a `program` source for each participant.
- Confirm FFmpeg successfully connected to the AzuraCast input mount and the station dashboard shows the live DJ/source.
- Test listener playback before treating the relay as production-ready.
- If the AzuraCast provider supplies a different input protocol or mount format, adjust the output adapter before starting it. Do not substitute the public player URL.

## Current limitations / safe operating notes

- All active tracks named exactly `program` in the configured room are mixed. This matches the current JRadio Studio publisher naming. Tracks with other names are intentionally ignored.
- The relay mixes the `program` tracks that the app publishes. If the app keeps remote return audio monitor-only rather than publishing it into a participant's `program` track, the relay cannot recover audio that was never published. The current design relies on each presenter's own programme track being published to LiveKit.
- The relay connects to LiveKit first and does not open the AzuraCast input until it has received an actual audio frame from at least one `program` track. It closes the AzuraCast input when the last programme source disappears, allowing the station AutoDJ to resume. It does not send silence to claim the input while the studio is idle.
- The mixer uses 48 kHz stereo, 20 ms frames and one MP3 output. The limiter prevents digital clipping when sources overlap; it is not a full broadcast loudness processor.
- This first implementation is a standalone relay scaffold and must be validated against the actual AzuraCast input credentials and LiveKit room before it is used on-air. It has not been deployed to the VPS by this repository change.
