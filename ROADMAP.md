# PocKeep roadmap

Ideas and planned work, roughly in priority order. Contributions welcome.

## Internationalization

- [ ] **TranslationsCenter / i18n management system.** Move translations out of source files into a dedicated service:
  - [ ] Key/value store per language with history of changes.
  - [ ] A web UI for translators: missing keys, suggestions, review.
  - [ ] An HTTP API the frontend fetches at startup, with cached bundles (ETag) and an offline fallback to the bundled dictionaries.
  - [ ] An extraction script that collects every `t('…')` string from `web/src` and server messages, and reports new or removed keys.
  - [ ] Evaluate self-hosted options (for example Tolgee or Weblate) before building from scratch.
- [ ] Move server-side messages to stable message codes, so clients translate them and new languages need no server changes.
- [ ] Plural rules per language (Intl.PluralRules) instead of fixed phrases.
- [ ] Localized classification keywords, so automatic sorting understands English-only chats as well as Hebrew ones.
- [ ] More languages (Arabic, Russian).

## Import and sorting

- [ ] Upload exports directly from the phone (Web Share Target / PWA).
- [ ] Optional scheduled import from a watched folder (for example a Syncthing share).
- [ ] Re-run sorting rules on existing cards, with a preview.
- [ ] Optional local AI classification through an Ollama endpoint (off by default, never a cloud service).

## Cards and board

- [ ] Reminders for vouchers about to expire and for upcoming events (email or ntfy).
- [ ] Manual card creation and quick notes.
- [ ] Saved searches as custom smart views.
- [ ] Expense export (CSV) and simple charts per category.

## Deployment and updates

- [ ] **Auto-deploy on push.** Currently updating a self-hosted instance requires a manual `git pull && docker compose up -d --build`. Ideas for automatic deployment:
  - [ ] **GitHub webhook → automation** — the repo sends a push webhook to a workflow engine (e.g. n8n, Rundeck), which SSHes into the server and runs the update.
  - [ ] **GitHub Actions + Tailscale** — add `tailscale/github-action` to the CI pipeline so it can SSH to a private server and deploy automatically.
  - [ ] **Cron-based polling** — a cron job on the server that runs `git fetch` periodically and rebuilds only when there are new commits. Simplest, no external dependencies.
- [ ] Prebuilt multi-arch images on GHCR (amd64, arm64) — would simplify updates to a `docker compose pull` instead of building from source.

## Platform

- [ ] OIDC sign-in (Authelia, Authentik) as an alternative to local passwords.
- [ ] Two-factor authentication (TOTP).
- [ ] Encrypted backups and scheduled server-side backup rotation.
