# AirDesk VPS encoder (Icecast)

Replaces BUTT. The studio streams its mix to this small program on the VPS, which encodes MP3
with ffmpeg and logs in to AzuraCast's live port as an Icecast SOURCE (exactly like BUTT).

```
Browser studio --wss--> /encoder (this program, port 8090) --ffmpeg MP3--> AzuraCast 65.108.143.81:8275
```

The DJ username/password come from the studio after the studio password check; AzuraCast checks them.

## .env (same file as the studio app)

```
ICECAST_HOST=65.108.143.81
ICECAST_PORT=8275
ICECAST_MOUNT=/
ENCODER_PORT=8090
ENCODER_BITRATE=128
ENCODER_URL=wss://studio.jradiosouthafrica.co.za/encoder
# optional: only these sites may use the encoder
ENCODER_ALLOWED_ORIGINS=https://studio.jradiosouthafrica.co.za,https://jradiostudio.lovable.app
```

## Run

```
apt install -y ffmpeg
cd /var/www/jradiostudio && npm install
pm2 start /var/www/jradiostudio/relay/icecast-relay.mjs --name jradio-encoder \
  --cwd /var/www/jradiostudio --node-args="--env-file=/var/www/jradiostudio/.env"
pm2 restart jradiostudio --update-env
pm2 save
```

## Caddy

```
studio.jradiosouthafrica.co.za {
    handle /encoder* {
        reverse_proxy localhost:8090
    }
    handle {
        reverse_proxy localhost:3000
    }
}
```

Check: `curl http://127.0.0.1:8090/health` and `pm2 logs jradio-encoder`.
