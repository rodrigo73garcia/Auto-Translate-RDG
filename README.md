Auto Translate RDG
==================

This package contains a Stremio Addon called **Auto Translate RDG**.

Features:
- Retrieves subtitles directly from Stremio addons (`subtitles` feature), prioritizing English when available.
- Translates the subtitles to the configured language (default pt-BR) using a free library.
- Generates a translated `.srt` file and serves it to Stremio.
- Includes a configuration page (`/configure`) to set the language and subtitle sources (upstreams).

How to use:
1. Run `npm install` and then `npm start`.
2. Open: `https://<your-url>/configure`
   - Choose the target language.
   - Enter the base URLs of the Stremio subtitle addons to query, separated by commas (e.g., `https://addon1.example, https://addon2.example`).
   - Generate and use the manifest installation link.
3. In Stremio: “My Addons” → “Add manually” → paste the manifest URL.

Environment variables (optional):
- `PUBLIC_BASE_URL`: Public URL of the service (auto-detects on some providers).
- `STREMIO_SUBS_BASES`: List of subtitle addon URLs (separated by commas); can also be defined via the manifest config.

Notes:
- This addon does not use OpenSubtitles; it only queries Stremio addons that expose `subtitles` for the requested `type/id`.
- The `subs/` directory stores cached translated `.srt` files for 7 days; contents can be cleared at any time.
