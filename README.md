# Resurface

Give a creator's old videos a new reason to be watched: tie a clip from the backlog to something in this week's news, and put a small motion graphic above it that makes the link.

The finished short is a vertical split screen. The top half is a news panel (date, headline, one small animated idea). The bottom half is the creator's clip, untouched.

## What is here

| Folder | What it holds |
|---|---|
| `skill/news-hook-clip-matcher/` | The Claude skill that runs the whole job, end to end |
| `pipeline/` | The working scripts and the motion template the skill uses |
| `examples/kameron-monet/` | A full first run on @KameronMonet, 22 Nov 2026 |
| Repo root | The Resurface web app |
| `electron/` | The desktop transcript archive app |

## The six stages

1. **Download** the channel's videos and timestamped transcripts (Treg).
2. **Interests**: index every topic, brand, person and place the creator mentions, and publish a Topic Map.
3. **News**: search for real events from the last few days that touch those interests.
4. **Clips**: pair each story with every clip that could ride it, score the stories, publish the shortlist.
5. **Motion**: build three animated options per story (simple, exaggerated, funny), each in a different colour world.
6. **Learn**: record which ideas and colours were picked.

See `pipeline/README.md` for how to run each stage, and the skill for the rules behind them.

## Look at the example first

Open these in a browser:

- `examples/kameron-monet/topic-map/index.html` (serve the folder, it loads two JSON files)
- `examples/kameron-monet/runs/2026-11-22/news-hooks.html`
- `examples/kameron-monet/runs/2026-11-22/motion-options.html`

## What is not here

Full transcripts and API keys are left out on purpose (see `.gitignore`). The transcripts are the creator's words and live in the working folder, not in the repo. The example Topic Map keeps only short snippets around each mention.

## Status

The pipeline scripts are not yet a packaged tool. Scores on the example shortlist were set by the same pass that found the pairs.
