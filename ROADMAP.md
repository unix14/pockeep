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

## Platform

- [ ] Prebuilt multi-arch images on GHCR (amd64, arm64).
- [ ] OIDC sign-in (Authelia, Authentik) as an alternative to local passwords.
- [ ] Two-factor authentication (TOTP).
- [ ] Encrypted backups and scheduled server-side backup rotation.
