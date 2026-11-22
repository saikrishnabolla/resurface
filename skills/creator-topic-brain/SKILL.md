---
name: creator-topic-brain
description: Build an interactive "second brain" web of the topics a creator talks about, one web per creator, from their YouTube, TikTok and Instagram titles and captions.
version: 1.0.0
triggers:
  - creator topic web
  - creator brain
  - map what a creator talks about
  - topic graph for a creator
category: creators
---

# Creator topic brain

Turns a creator's video titles and captions into an Obsidian-style topic web:
topics are nodes (sized by how many videos mention them), edges join topics that
appear in the same video, and coloured themes are network communities. One tab
per creator, or one standalone page per creator.

Code lives in `creator-brains/scripts/`. Example output is in `creator-brains/site/`.

## 1. Find the creator's accounts

- Search the web (You.com search works well) for "<name> <company> TikTok Instagram".
- Confirm each handle by checking the bio or nickname in the first page you pull.
  Name search alone often returns the wrong person.
- YouTube channel id: Treg `tikhub.x.youtube-web-v2-search-channels` (`keyword=<name>`).

## 2. Pull videos through Treg (about $0.001 to $0.002 per call)

| Platform | Endpoint | Params | Per page | Next page |
|---|---|---|---|---|
| YouTube long | `scrapecreators.x.v1-youtube-channel-videos` | `channelId` | 30 | `continuationToken` |
| YouTube Shorts | `scrapecreators.x.v1-youtube-channel-shorts` | `channelId` | ~50 | `continuationToken` |
| TikTok | `tikhub.x.tiktok-app-v3-fetch-user-post-videos` | `unique_id`, `count`, `max_cursor` | ~10 | `data.max_cursor` |
| Instagram Reels | `tikhub.x.instagram-v2-fetch-user-reels` | `username`, `pagination_token` | ~12 | `data.pagination_token` |

These responses are huge, so they get saved to `/tmp/claude-tool-results/`
instead of filling the conversation. Run `python3 creator-brains/scripts/treg_to_csv.py videos_social.csv`
after each round: it parses every saved response, dedupes, and prints the next
cursor per handle. Fire one call per creator per platform in parallel each round.
For 100 per platform, expect about 9 rounds.

## 3. Build the CSV

One row per video with columns `creator, platform, url, title, views` (extra columns are fine).
Use the full caption as `title` for TikTok and Instagram. See `creator-brains/data/videos.csv`.

## 4. Build the pages

```sh
cd creator-brains/scripts
pip install networkx
python3 build_brain.py --csv ../data/videos.csv --out ../site --split \
    --full "Kameron Buckner,Sharon Jacob,Keta Bag"
```

- `--full`: show every topic for these creators (hundreds). Others get their top `--top` (default 45) used in 2+ videos.
- `--split`: also write `site/<firstname>/` standalone pages.
- `--only`: restrict to some creators.
- Tune `STOP` (noise words), `NORM` (synonyms, translations) and `BI` (phrases) at the top of `build_brain.py`
  after looking at the printed themes. Non-English captions need entries in `NORM` to translate key words.

## 5. Publish

Each output folder is `index.html` plus `persona.json` (the page fetches it). Publish both files as one
artifact, or serve the folder statically. Opening `index.html` straight from disk won't work because
browsers block `fetch` on `file://`; run `python3 -m http.server` in the folder instead.

## Limits

- Titles and captions are short. For real depth (10x topics), pull transcripts and feed them in as `title`.
- Creators with few videos give thin webs. Single-use words add noise when using `--full`.
