# board

My whiteboard, moved onto the computer. Daily/weekly checklists, a habit registry, streaks and a points shop.

- `apps/web` – React + Vite frontend
- `apps/api` – Express API
- `packages/contracts` – shared schemas

All data is one SQLite file, `apps/api/data/board.db` (gitignored). The API backs it up on its own every 2 days into `apps/api/data/backups/` and keeps the last 5. Those sit on the same disk, so copy one somewhere else now and then.

Needs Node 24 and pnpm.

## Run locally

```
pnpm install
pnpm dev
```

Open http://localhost:5173. The API runs on port 4000 and Vite proxies `/api` to it.

## Deploy to the VPS

Written for Ubuntu/Debian with nginx. Swap `board.example.com` for your subdomain (point its DNS at the VPS first) and `me` for your VPS user.

### First time

Install Node and pnpm:

```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm
```

Clone and build (if the repo is private, clone over ssh with a deploy key):

```
sudo mkdir -p /var/www/board && sudo chown me /var/www/board
git clone https://github.com/Gameoholic/board.git /var/www/board
cd /var/www/board
pnpm install
pnpm build
```

Run the API as a service. Create `/etc/systemd/system/board.service`:

```
[Unit]
Description=board api
After=network.target

[Service]
User=me
WorkingDirectory=/var/www/board/apps/api
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable --now board
```

The API only listens on 127.0.0.1:4000, so nginx is the only way in.

The app gates itself with one shared password (there's no concept of separate users) — set it now:

```
pnpm set-password
```

It prompts twice (input hidden) and stores a hash in `apps/api/data/auth.json`. Re-run it any time to change the password; that also signs out every existing session. Log in once from the browser afterwards and it stays signed in for 10 years via a cookie, so this is a one-time step per device/browser, not per visit.

Create `/etc/nginx/sites-available/board`:

```
server {
    listen 80;
    server_name board.example.com;

    root /var/www/board/apps/web/dist;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
    }
}
```

Enable it and add HTTPS the same way as your other sites. Without HTTPS the password goes over the wire in plain text.

```
sudo ln -s /etc/nginx/sites-available/board /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d board.example.com
```

### Moving my current board over

Stop the service on the VPS (`sudo systemctl stop board`), then run this from the Mac in the repo folder:

```
scp apps/api/data/board.db me@board.example.com:/var/www/board/apps/api/data/board.db
```

Then start it again with `sudo systemctl start board`. This replaces whatever board is on the VPS.

### Restoring a backup

```
sudo systemctl stop board
cp /var/www/board/apps/api/data/backups/<the one you want>.db /var/www/board/apps/api/data/board.db
sudo systemctl start board
```

### Updating

```
cd /opt/board-vibe-coded
git pull
pnpm install
pnpm build
pm2 restart board-api
```

### Logs

```
journalctl -u board -f
```
