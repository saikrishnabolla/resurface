# Creator brains

Interactive topic webs for creators, built from 653 YouTube, TikTok and Instagram videos
(November 2026) for the Creator Economy Hack. See `skills/creator-topic-brain/SKILL.md` to make more.

```text
data/videos.csv         All pulled videos: creator, platform, handle, url, title/caption, views, date
scripts/build_brain.py  CSV -> persona.json + index.html (all creators, and one page each with --split)
scripts/template.html   D3 page: force-directed web, theme hulls, topic panel with top videos
scripts/treg_to_csv.py  Parses saved Treg TikTok / Instagram responses into a CSV, prints next cursors
site/                   Built output: index.html (tabs for all six) and kameron/, gabe/, keta/ etc.
```

View locally: `cd site && python3 -m http.server` then open http://localhost:8000.

Published artifacts: all creators https://claude.ai/artifact/9LVXcZhbCGyhd71ijH7oho ·
Kameron https://claude.ai/artifact/MiTzVHYScUtfUszH3mdrXt ·
Gabe https://claude.ai/artifact/WmT9Rm8QHodVdcjWNi42WK ·
Keta https://claude.ai/artifact/XNm7Ks3VVudavDiJdRmGJF
