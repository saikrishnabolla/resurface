# pull-clips

Downloads and cuts the clips picked for a run, from YouTube or Instagram, in one go.

## Setup (macOS)

```bash
brew install yt-dlp ffmpeg
chmod +x tools/pull-clips/pull-clips.sh
```

## Use

1. Write the chosen clips to a text file, one per line: `name|source|start|end`
   (see `example-clips.txt`).
2. Run:

```bash
tools/pull-clips/pull-clips.sh my-clips.txt                 # -> ~/Downloads/clips/my-clips/
tools/pull-clips/pull-clips.sh my-clips.txt ~/Downloads/x   # custom folder
```

You get one `.mp4` per clip plus a zip of them all, and the folder opens when done.

## Notes

- Source: a YouTube or Instagram URL, or a bare ID with a prefix: `yt:rYGg2nYZvLI`, `ig:DUoooY2Ee9z` (YouTube IDs and Instagram codes look alike, so the prefix matters).
- Times accept `16.5`, `01:05` or `1:02:03.25`. Leave `end` blank to keep the whole video (handy for backup reels).
- Cuts are re-encoded so they start and end exactly on the given times.
- YouTube: only a padded section is downloaded. Instagram: the reel is downloaded once and reused for every clip from it.
- Instagram blocking you? Run with `COOKIES_FROM_BROWSER=chrome`.
- Other options: `PAD=3`, `KEEP_SOURCES=1`, `NO_ZIP=1`, `NO_OPEN=1`.
