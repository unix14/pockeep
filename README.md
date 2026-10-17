# PocKeep · פוקיפ

**A privacy-first, self-hosted dashboard for curating and decluttering the messages you save to yourself on WhatsApp.**

Many people use a "message yourself" chat as a catch-all inbox: links to watch later, coupon codes, expenses, reminders, snippets, pasted notes. PocKeep turns a WhatsApp chat export into a Google Keep-style board of cards, sorts them into categories automatically, and lets you organize, search and clean them up. When you upload a newer export later, PocKeep adds only the new messages and keeps everything you already organized.

Everything runs on your own server, as one small container with an embedded SQLite database. Nothing is sent to third parties: no analytics, no link previews, no AI services.

## Features

- **Import** native WhatsApp exports (`.txt` from Android or iPhone) or converted `.md` files. A preview shows what's new before anything is saved.
- **Safe re-imports.** Each message is fingerprinted, so a newer export never duplicates or overwrites your work:
  - Same text on the same day is flagged as a duplicate.
  - Messages edited in WhatsApp are linked to the existing card.
  - Deleted cards stay deleted.
- **Automatic, offline sorting** into 11 categories:
  - Unsorted, To-do, Expenses, Vouchers & coupons, Watch later, Dev & tools
  - Notes & reading, Events & appointments, Orders & receipts, Promotions, Personal

  Your own keyword and domain rules run first.
- **Smart cards:**
  - Expenses with monthly totals.
  - Vouchers with one-tap code copy and expiry tracking.
  - Events with upcoming/past state.
  - Links with tracking parameters removed and a "watched" toggle.
  - To-dos with checkboxes.
- **Keep-style board:** masonry layout, pin, lock against deletion, colors, labels, drag-and-drop, multi-select, undo, search, filters, smart views and one-click cleanup.
- **Multi-user** with complete data isolation. An admin manages accounts; temporary passwords must be changed at first sign-in.
- **Backups:** per-user JSON export and restore.
- **Bilingual:** Hebrew (RTL, default) and English (LTR).

## Languages

| Language | Direction | Notes |
|---|---|---|
| עברית (Hebrew) | RTL | Default. The app is called **פוקיפ**. |
| English | LTR | The app is called **PocKeep**. |

- **Choosing a language:** pick it on the sign-in screen, or under **Settings → Account → Language**. The choice is saved to your account and follows you to every device.
- **Card content:** each card keeps its own text direction automatically, so Hebrew and English messages both display correctly in either interface language.
- **Server messages** are localized too.

Adding a language means adding one dictionary file (`web/src/i18n/<lang>.js`). See [ROADMAP.md](ROADMAP.md) for the planned TranslationsCenter.

## Quickstart (Docker Compose)

You need Docker with the Compose plugin (v2.24+).

```bash
git clone https://github.com/<your-user>/pockeep.git
cd pockeep
cp .env.example .env              # optional: set ADMIN_PASSWORD / SEED_USER_PASSWORD
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose logs pockeep       # shows generated one-time passwords, if any
```

Open `http://<server-ip>:3000` and sign in as `admin`.

### First start: accounts

On the first start, while the database is empty, PocKeep creates:

| Account | Role | Password |
|---|---|---|
| `ADMIN_USERNAME` (default `admin`) | Admin | `ADMIN_PASSWORD` from `.env`. If unset or left as a `replace_me…` placeholder, a random one-time password is printed once in the logs and must be changed at first sign-in. |
| `SEED_USER` (default `user`) | User | `SEED_USER_PASSWORD`, or a generated one-time password. Always temporary: it must be changed at first sign-in. Set `SEED_USER=` to skip this account. |

- **Adding people:** the admin creates them under **Settings → User management**.
- **Registration:** public sign-up is disabled by default (`ALLOW_REGISTRATION=false`).

## Running on Proxmox (LXC)

1. **Create an LXC.** Use a Debian 12 template, unprivileged, 1 vCPU, 1 GB RAM, 4 GB disk. Under **Options → Features**, enable `nesting` and `keyctl`. Both are required for Docker.
2. **Install Docker inside the LXC:**
   ```bash
   apt update && apt install -y ca-certificates curl git
   curl -fsSL https://get.docker.com | sh
   ```
3. **Deploy:**
   ```bash
   git clone https://github.com/<your-user>/pockeep.git /opt/pockeep && cd /opt/pockeep
   cp .env.example .env && nano .env
   mkdir -p data && chown 1000:1000 data
   docker compose up -d --build
   ```
4. **Update later:** run the update script, which pulls `main` and rebuilds only
   when there are new commits:
   ```bash
   /opt/pockeep/scripts/update.sh
   ```
   From a Proxmox host you can run it without opening a shell in the container:
   ```bash
   pct exec <CTID> -- /opt/pockeep/scripts/update.sh
   ```
   The equivalent by hand is `cd /opt/pockeep && git pull && docker compose up -d --build`.

### Private access with Tailscale

There are two ways to reach PocKeep only from your tailnet.

**A. Tailscale on the LXC.**

1. On the Proxmox host, add these lines to `/etc/pve/lxc/<CTID>.conf`, then restart the container:
   ```
   lxc.cgroup2.devices.allow: c 10:200 rwm
   lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
   ```
2. Inside the LXC:
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh && tailscale up
   ```
3. Choose how to expose PocKeep:
   - **Tailnet only, plain HTTP:** set `POCKEEP_BIND` in `.env` to the LXC's Tailscale IP (`tailscale ip -4`).
   - **HTTPS:** set `POCKEEP_BIND=127.0.0.1`, `TRUST_PROXY=true` and `COOKIE_SECURE=true`, then run `tailscale serve --bg 3000` and open `https://<lxc-name>.<tailnet>.ts.net`.

**B. Tailscale sidecar container.** No TUN device and no open ports are needed.

1. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.
2. Create an auth key and set `TS_AUTHKEY` in `.env`.
3. Start both containers:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tailscale.yml up -d --build
   ```
4. Open `https://pockeep.<tailnet>.ts.net`.

### Without Docker

You can run the app with Node.js 22 under systemd instead. A ready-made unit is in `deploy/pockeep.service`:

```bash
npm --prefix server ci --omit=dev && npm --prefix web ci && npm --prefix web run build
sudo cp deploy/pockeep.service /etc/systemd/system/ && sudo systemctl enable --now pockeep
```

## Configuration

All settings are environment variables, read from `.env`. See [`.env.example`](.env.example) for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin`, generated | First admin account (first start only) |
| `SEED_USER`, `SEED_USER_PASSWORD` | `user`, generated | Optional second account, temporary password |
| `ALLOW_REGISTRATION` | `false` | Allow self sign-up |
| `POCKEEP_BIND`, `POCKEEP_PORT` | `0.0.0.0`, `3000` | Published interface and port |
| `TRUST_PROXY`, `COOKIE_SECURE` | `false`, `auto` | Set both to `true` behind an HTTPS proxy |
| `SESSION_DAYS` | `30` | Session lifetime (renewed while in use) |
| `MAX_IMPORT_MB`, `MAX_BACKUP_MB` | `25`, `100` | Upload limits |
| `STORE_EXPORTS` | `true` | Keep uploaded exports in `data/exports/<userId>/` |

## Data, backups and privacy

- **Location:** all state lives in `./data`, mounted at `/data`. That folder holds `pockeep.db` (SQLite in WAL mode) and the stored exports. It is excluded from Git.
- **Per-user backups:** **Settings → Backup** downloads a JSON file; the same tab can restore it.
- **Whole-server backups:** snapshot the LXC, or stop the container and copy `data/`.
- **Isolation:** every record belongs to a `user_id`, and all queries are scoped to the signed-in user. Admins manage accounts but cannot read other users' cards. Automated tests cover cross-user access.
- **Sessions:** server-side, stored as hashed random tokens, so there is no JWT secret to manage. Cookies are `HttpOnly` and `SameSite`.
- **Request protection:** CSRF header check, login rate limiting and a strict Content-Security-Policy.

## User management from the shell

```bash
docker compose exec pockeep node server/src/cli.js user:list
docker compose exec pockeep node server/src/cli.js user:add <name> --temp       # temporary password
docker compose exec pockeep node server/src/cli.js user:passwd <name> --temp    # reset
docker compose exec pockeep node server/src/cli.js user:delete <name>
```

## Development

```bash
npm --prefix server install && npm --prefix web install
ADMIN_PASSWORD=dev-password npm run dev:server   # API on :3000, data in ./data
npm run dev:web                                  # UI on :5173 (proxies /api)
npm test                                         # API, isolation and auth tests
```

Stack: React 18 + Vite + Tailwind CSS, Fastify 5, better-sqlite3, bcrypt. The parser and sorter live in `shared/core.js` and are used by both the server and the browser.

```
pockeep/
├── shared/core.js        # WhatsApp parser, fingerprints, reconciliation, rule-based sorter
├── server/src/           # Fastify app, SQLite schema/migrations, auth, user-scoped repository, routes, CLI
├── server/test/          # node:test suites (fixture data is fictional)
├── web/src/              # React UI, i18n (he/en), API client, store
├── Dockerfile            # multi-stage build → single runtime image
├── docker-compose.yml    # service "pockeep", ./data volume
├── docker-compose.tailscale.yml
└── deploy/pockeep.service
```

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

[MIT](LICENSE) © 2026 Eyal Yaakobi
