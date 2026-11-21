# AirDesk VPS Icecast SOURCE relay

This implementation keeps the existing AirDesk Web Audio mixer. The browser sends its existing `programStream` as WebM/Opus chunks to the VPS over WebSocket. The VPS decodes that input with FFmpeg, encodes MP3, and pushes it to AzuraCast using an Icecast `SOURCE` connection. The Icecast source password is never sent to the browser.

## Required provider details

Before going live, obtain these exact values from AsuraHosting/AzuraCast support:

- Icecast SOURCE hostname
- Icecast SOURCE port (do not assume the WebDJ port is the SOURCE port)
- Whether that SOURCE port uses TLS
- Source mount path
- Source username (usually `source`, but confirm; if AsuraHosting gives you `cn007`, set `ICECAST_SOURCE_USER=cn007`)
- Source password (the Icecast source password, not automatically the WebDJ DJ password)

The existing AzuraCast WebDJ port 8275 is not proof that port 8275 accepts Icecast SOURCE. Do not guess the port or mount.

## VPS environment

Add these to the server environment file used by BOTH the AirDesk app process and the relay process (for example `/etc/jradiostudio.env`):

```dotenv
STUDIO_PASSWORD=REPLACE_WITH_A_LONG_STUDIO_PASSWORD
BROADCAST_TOKEN_SECRET=REPLACE_WITH_OUTPUT_OF_OPENSSL_RAND_HEX_32

ICECAST_HOST=a6.asurahosting.com
ICECAST_PORT=REPLACE_WITH_CONFIRMED_SOURCE_PORT
ICECAST_MOUNT=/REPLACE_WITH_CONFIRMED_MOUNT
ICECAST_SOURCE_USER=source
ICECAST_SOURCE_PASSWORD=REPLACE_WITH_CONFIRMED_SOURCE_PASSWORD
ICECAST_TLS=true
ICECAST_BITRATE=128k

BROADCAST_RELAY_PORT=3001
BROADCAST_ALLOWED_ORIGIN=https://studio.jradiosouthafrica.co.za
FFMPEG_PATH=/usr/bin/ffmpeg
```

Set `ICECAST_TLS=false` only if the provider confirms the source port is plain TCP. Use the exact mount path supplied by the provider. Keep this file private (mode 600); never commit it.

Generate a token secret on the VPS with:

```sh
openssl rand -hex 32
```

Use the same value for `BROADCAST_TOKEN_SECRET` in both processes. The studio password is checked by the AirDesk server; the signed two-minute token authorizes the WebSocket connection.

## Install and build

From the existing project directory:

```sh
cd /var/www/jradiostudio
bun install
```

Ensure FFmpeg is installed and supports libmp3lame:

```sh
sudo apt-get update
sudo apt-get install -y ffmpeg
ffmpeg -hide_banner -encoders | grep libmp3lame
```

Build the existing TanStack Start app for Node:

```sh
NITRO_PRESET=node-server npm run build
```

If this deployment uses Bun for scripts, the equivalent is:

```sh
NITRO_PRESET=node-server bun run build
```

## Run the relay under PM2

Load the protected environment file into the current shell, then start the relay as a second PM2 process. This does not replace the existing AirDesk process:

```sh
set -a
. /etc/jradiostudio.env
set +a
cd /var/www/jradiostudio
pm2 start server/icecast-relay.mjs --name airdesk-icecast-relay
pm2 save
pm2 status
pm2 logs airdesk-icecast-relay --lines 50
```

When environment values change:

```sh
set -a
. /etc/jradiostudio.env
set +a
pm2 restart airdesk-icecast-relay --update-env
pm2 restart jradiostudio --update-env
pm2 save
```

Use the actual PM2 name for the existing AirDesk app if it is not `jradiostudio`.

## Nginx WebSocket proxy

Inside the existing HTTPS server block for `studio.jradiosouthafrica.co.za`, add this location before the general `location /` block. Do not replace the existing application proxy:

```nginx
location = /broadcast-ws {
    proxy_pass http://127.0.0.1:3001/broadcast-ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    access_log off; # the WebSocket URL carries a short-lived token
}
```

Then validate and reload:

```sh
sudo nginx -t
sudo systemctl reload nginx
```

## Go-live flow

1. The user enters the AirDesk studio password.
2. The TanStack server function checks it and returns a signed token valid for two minutes. It does not return Icecast credentials.
3. The browser opens `wss://studio.jradiosouthafrica.co.za/broadcast-ws`.
4. The relay validates the token and permits one active source session.
5. FFmpeg accepts WebM/Opus from the browser and outputs 128 kbps MP3.
6. The relay authenticates to Icecast using the configured source username/password and sends the MP3 stream.
7. End Broadcast closes the WebSocket, FFmpeg process and Icecast socket. AzuraCast should return to AutoDJ according to its source-disconnect configuration; verify this with AsuraHosting.

## Verification

Check the relay is listening locally:

```sh
sudo ss -ltnp | grep ':3001'
pm2 logs airdesk-icecast-relay --lines 100
```

A successful session logs `Icecast SOURCE connected; studio is live`. If authentication or the port/mount is wrong, the relay logs the Icecast handshake rejection. Do not expose the source password in logs or screenshots.

This branch changes the Go Live client and adds the relay process, but it has not been deployed to the live VPS. Confirm the exact SOURCE connection details before enabling it on air.
