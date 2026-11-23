# Pipeline

Scripts are grouped by stage. Run them from the creator's workspace folder (`news-hooks/<creator-slug>/`) unless a path is given. Python 3, standard library only.

## 1. Library: `library/`

Fetching is done by the agent through Treg (`scrapecreators.x.v1-youtube-channel-videos`, then `scrapecreators.x.v1-youtube-video-transcript` per video), saving each result to a folder.

```
python3 pipeline/library/build_library.py <folder-of-saved-results> <out-folder>
```

Writes `transcripts.jsonl` and `videos.csv`. It expects `videos.json` (the channel's video list) in the current folder, and repairs words that auto-captions join across line breaks.

## 2. Interests: `interests/`

- `lexicon.example.txt`: the 800-term lexicon from the first run. Lines starting `@kind | group` open a section, then one term per line: `Label`, `Label = regex`, or `!Label` for case-sensitive.
- `match.py`: searches every transcript for every term, skipping music and jingle segments. Reads `recs.json` (the transcript records) and `lex.txt`, writes `hits.json`.
- `kwic.py <term>`: shows a term's hits in context, to catch false matches.
- `export.py`: turns the hits into `terms.json` and `videos.json` for the Topic Map.
- `topic_map.html`: the Topic Map page. It loads those two JSON files from the same folder.

## 3. News

No script. The agent searches (You.com or web search) following the rules in the skill: named entity plus event verb, two passes, three tests for what counts as news. Trusted and blocked domains go in the creator's `sources.md`.

## 4. Clips: `pairs/`

- `bridge_queries.example.py S1 S2 ...`: the weighted bridge queries from the first run, one set per story, searched over 40-second windows. Copy it and rewrite the queries for the day's stories.
- The run's `build_shortlist.py` (see the example run) holds the chosen stories, scores, sources, flags and clips as data, checks each clip's anchor phrase against the transcript, and writes `shortlist.json`.
- `page_shortlist.py <shortlist.json> <out-folder>`: writes `news-hooks.html`, `shortlist.md` and `ledger.csv`.

`shortlist.json` is a list of stories, each with: `r` rank, `t` headline, `d` date, `tag`, `post`, `ty` safe or swing, `sc` six scores, `tot` total, `w` summary, `src` [[name, url]], `flag`, and `c`, a list of clips with `v` video id, `s` start seconds, `l` lens, `b` bridge line, `q` quote, `t` video title, `d` recorded date.

## 5. Motion: `motion/`

- `template.html`: the split-screen frame, the date and headline block, the animation classes (move once, then idle), counters, typewriter and palette rotation.
- `palettes.json`: nine palettes in three families (dark, light, saturated). Each story's three versions get one from each family.
- `build_motion.py <shortlist.json> <variants.js> <out.html> --handle <creator>`: assembles the page. Add `--clips clips.json` (story rank to clip file, paths relative to the page) to play the real clips under each graphic. Add `--cues cues.json` (story rank to `[[start_s, end_s, text], ...]`, timed from the start of the clip) for captions along the bottom of each clip. With clips, a small "Watch the full video" pop-up appears in the top right of the clip for its last two seconds, in four looks rotated across the frames. Clip files stay out of the repo.

- `export_video.py <page-folder> <out-folder> <rank>-<version> ...`: renders finished shorts as 1080 x 1920 MP4 files, for example `2-funny 5-simple`. It drives the page frame by frame, lays the frames over the original clip and keeps the clip's sound. Needs Playwright with Chrome and ffmpeg. Pass `--fonts <folder>` with the font files when the machine cannot reach Google Fonts.

The story-specific graphics live in the run's `variants.js`, three per story (simple, exaggerated, funny). See the example run for thirty of them and the notes at the top of that file.
