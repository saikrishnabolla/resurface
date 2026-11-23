# Resurface Transcriptions

Local, free YouTube channel transcript archive. Paste a channel URL → latest 100 videos (Shorts + long-form) → captions collected in the background → instant full-text search (SQLite FTS5) across every transcript. No AI, no API keys.

## Run
- Installed app: `~/Applications/Resurface Transcriptions.app`
- Dev: `npm run dev` (uses `python/.venv`; create it with `npm run setup:python`)
- Package: `npm run pack` → bundles Python extractor with PyInstaller, builds, copies the .app to `~/Applications`

## How it works
- **Catalog (100 videos, long-form first):** the 100 slots go to the channel's latest long-form videos; Shorts only fill what's left. Shorts-heavy channels get a deeper uploads scan (up to 1,500) to find them. Long-form transcripts are fetched first. `python/extractor.py` (bundled Python worker, JSON lines over stdio) lists the uploads playlist (exact newest-first order) and the /shorts tab with yt-dlp. A channel you've imported before is shown from SQLite instantly and refreshed behind it.
- **Transcripts:** `src/main/importer.ts` runs a priority queue over a provider chain (`src/main/providers/`):
  1. **treg → ScrapeCreators** (`treg.ts`), 16 concurrent, ~$0.0019 per transcript. Uses the treg CLI's sign-in (`~/.treg/config.json` or `TREG_TOKEN`); main process only. Idempotency keys mean a retried timeout is never billed twice.
  2. **youtube-transcript-api** (2 concurrent), then **yt-dlp captions** (1): free, used only when treg can't serve a video (error, rate limit, out of balance, wrong-language answer).
  - A video you open jumps the queue (2 reserved slots). Rate limits cool a provider down (honoring `retry_after_s`/Retry-After) without failing the video. "No captions" is final; other errors fall through the chain, then retry with backoff, then show as Failed.
  - Language check: for manual-only videos ScrapeCreators returns the alphabetically first track (often a translation). If the transcript's writing system doesn't match the title's, the free path (or treg with `language=`) fetches the right one.
- **Storage/search:** SQLite at `userData/archive.db` (channels, videos, segments, FTS5 `chunks_fts`). Transcripts are fetched once, ever. `fetch_log` records provider, outcome, latency and cost of every request.

- **treg usage pill** (top bar): requests this app sent to treg (billed vs. free idempotent replays), total spent (from `X-Treg-Cost-Micro`, logged in `fetch_log`) and the team balance (via `treg --json balance`). Turns amber when the balance is nearly gone; click to refresh.

## TikTok & Instagram (via treg → ScrapeCreators)
Paste `tiktok.com/@name` or `instagram.com/name`. `src/main/providers/social.ts`:
- Catalog: profile + paginated feed (TikTok 10/page, Instagram 12/page), latest 100 by post time, shown page by page as it loads. Photo slideshows skipped. Exact post dates. Short/long = under/over 3 min.
- Transcripts: TikTok = the video's own captions (WEBVTT + timestamps; videos without captions are free and show "Unavailable"). Instagram = ScrapeCreators **AI speech-to-text** (Instagram has no caption tracks), labelled "AI transcript"; reels over 2 minutes are skipped (long transcription costs 10 credits/min).
- Thumbnails/avatars are cached locally (`userData/thumbs`, served as `resurface-thumb://t/<id>`) because platform image URLs expire.
- Timestamp links open the post; TikTok/Instagram can't deep-link to a time.

## Benchmark
`RESURFACE_USER_DATA=/tmp/x npx electron . --bench https://www.youtube.com/@channel` prints catalog time, time to first/all transcripts, cache hit rate and per-provider latency/cost. `RESURFACE_PROVIDERS=yta,ytdlp` restricts the chain; `RESURFACE_LIMIT=20` caps the catalog.

## Search syntax
`money` · `"my parents"` (exact phrase) · `new york taxes` (all words in one passage) · `quantum OR gravity` · `simul*` (prefix). Case-insensitive.
