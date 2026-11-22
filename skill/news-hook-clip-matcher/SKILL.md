---
name: "news-hook-clip-matcher"
description: "Resurface a creator's old videos: pull their backlog and transcripts, map their interests, find this week's news that ties in, pick the clips, and build three split-screen motion graphic options per story."
---

# News hook clip matcher

A creator's backlog is full of strong moments that nobody sees any more. Today's news gives each one a new reason to be watched. This skill runs the whole job: it pulls the backlog, works out what the creator talks about, finds the news that ties in, picks the clips, and builds the motion graphics that make the link land.

A good result: a viewer sees a headline about something happening now, and within three seconds is inside an old clip that feels as if it was made for this moment. The link is surprising, but instantly legible.

## The pipeline at a glance

| Stage | What happens | Main output |
|---|---|---|
| 1. Download | Pull the channel's video list and a timestamped transcript for each video | `transcripts.jsonl`, `videos.csv` |
| 2. Interests | Index every topic, brand, person and place the creator mentions | `topic-index.json`, `watchlist.md`, Topic Map page |
| 3. News | Search for events that touch those interests, in the last few days | `runs/<date>/news.jsonl` |
| 4. Clips | Pair each story with every clip that could ride it, then score | `runs/<date>/shortlist.json`, News Hooks page |
| 5. Motion | Build three animated options per story for the top of the split screen | `runs/<date>/motion-options.html` |
| 6. Learn | Record what the user picked and why | `taste.md`, `ledger.csv` |

Stages 1 and 2 run once per creator and are topped up later. Stages 3 to 6 run every time.

The working scripts, the motion template and a full example run live in https://github.com/charlieosmond/resurface under `pipeline/` and `examples/`. Use them when the repo is reachable. When it is not, follow the method below; nothing here depends on the scripts.

## Inputs

- **Creator**: a channel URL or a folder of transcripts. This is the only thing worth asking for if missing.
- **Run date and news window**: default today, looking back 5 days. Region and language: default to the creator's main audience.
- **Creator's beat and no-go topics**: infer from the backlog if not given.
- **Volume**: default 100 videos in the library, 40 or more stories harvested, the top 10 stories shortlisted with every clip that fits, and three motion options for each of the 10.

## Workspace

Keep everything under `news-hooks/<creator-slug>/` in the working folder so each run builds on the last:

```
transcripts.jsonl       one record per video: id, title, published, url, duration, views, segments [[start_s, text]]
transcripts/            the same transcripts as readable markdown, one file per video
videos.csv              the video list
lexicon.txt             the terms searched for in the transcripts (Step 2)
topic-index.json        every term, how often, in which videos, at which timestamps
watchlist.md            named people, companies and products the creator talks about
clip-cards.jsonl        the clip library (Step 4, built up over time)
taste.md                what the user has liked and rejected, and why (ideas and colours)
ledger.csv              every pair shortlisted, used or rejected, with dates
sources.md              trusted and blocked news domains for this creator's beat
runs/YYYY-MM-DD/        news.jsonl, shortlist.json, shortlist.md, variants.js, motion-options.html
```

Read `taste.md`, `ledger.csv` and `sources.md` at the start of every run.

## Step 1: Download the videos and transcripts (once, then top up)

Use Treg if it is connected, because it needs no API key:

- `scrapecreators.x.v1-youtube-channel-videos` with `handle` and `sort`, 30 videos per page. Pass the returned `continuationToken` to get the next page.
- `scrapecreators.x.v1-youtube-video-transcript` with `url` and `language`, one call per video.

Otherwise use the Apify YouTube transcript scraper (keys live in `.keys.env` at the top of the TT_Video folder).

Things the first run taught:

- Save every result to disk as it arrives. Small results come back inline and are lost if they are not written down.
- Some videos have no captions, and Shorts have very little to say. Skip them and take the next longest video, so the library still reaches its target count.
- Auto-captions glue words together across line breaks ("mymom"). Rebuild each segment's text from the full transcript text the same call returns.
- Mark music and jingle segments so they are never matched: a known intro jingle, or any stretch where more than 40% of three-word phrases repeat.

On later runs only fetch videos newer than the latest one in the library.

## Step 2: Find their interests

Build an index of everything the creator mentions. One sentence is enough to count: a single aside about a brand is exactly the kind of thing a news story can grab.

1. Read a sample of transcripts and write `lexicon.txt`: several hundred terms grouped by kind (brand, person, organisation, the creator's own projects, culture, place, life moment, topic). Give each term a plain label and, where needed, a pattern that catches how it is actually said.
2. Search every transcript for every term, skipping music segments, and record the video and timestamp of each hit.
3. Check the hits in context before trusting them. Common words that are also names produce false matches (Gap, Target, Apple, Chase, Pride, "of course" for courses). Tighten the pattern or drop the term.
4. Write `topic-index.json`, and write `watchlist.md` from the named things with their counts. The watchlist is the search list for Step 3.
5. Publish the Topic Map: an interactive page of every term, sized by how often it comes up, where selecting a term lists its moments with links to the timestamp. It is how the user sees what the creator's world looks like, and it is worth showing before the first news run.

Top the lexicon up whenever a news run finds a story the index had no term for.

## Step 3: Harvest the news

Cast wide. Collect at least 40 stories across these lenses, because the best hooks often come from outside the creator's niche:

- the creator's own beat
- top general headlines
- business and tech, sport, entertainment and celebrity, science, internet culture, odd and local stories
- what is trending right now (Google Trends, YouTube trending, Reddit, X)
- the calendar: anniversaries, seasonal moments, and scheduled events in the next 7 days (these can be prepared ahead)

For each story record: headline, source, URL, the date it happened, a two-line summary in your own words, the handles news can be grabbed by (entities, underlying theme, principle at stake, emotion, archetype, the question the public is asking, key number), plus shelf life (hours, days or weeks) and a sensitivity flag.

Every story must come from a real source you opened, inside the news window or clearly marked as a slower trend. Never invent or half-remember news.

### Search for events, not topics

A topic query ("founder burnout", "NYC rent prices") returns listing pages, evergreen guides and sponsored content, because nothing in it says "today". A query built on a named thing and an action returns the event. On the first test run, every strong story came from a named entity and every dud came from an abstraction.

- Query the watchlist first: each entity, with freshness set to the news window.
- For the wider lenses, pair a beat with an event verb: sues, files, bans, resigns, raises, cuts, recalls, record, collapses. Leave out the word "news".
- Work in two passes. Pass one is broad, restricted or boosted to the trusted domains in `sources.md`, to find events. Pass two re-queries each event by its actors to confirm it and collect other sources.
- You.com search (connector or API) takes `freshness` (day, week, month or a date range), `include_domains`, `exclude_domains` and `boost_domains`, plus country and language. Its dates show when a page last changed, not when a story broke, so a fresh date alone proves nothing. Its results are long, so ask for few at a time.

### What counts as news

Keep a story only if it passes all three:

1. **Event test.** A named actor did a specific thing on a known date inside the window. Titles built on "best", "guide", "how to", "what to know" or a year are explainers, not events.
2. **Independent coverage.** Two or more newsrooms report it in their own words, or it is a primary source (court filing, regulator, company or government release). The same text on several local-station sites is one syndicated piece, not several sources. If a story has one source only, say so on the shortlist.
3. **Not paid for.** Drop bylines shaped "By [name] for [brand]", URLs or labels containing stacker, sponsored, partner, brandvoice or a press-release wire, and vendor blogs writing about their own market. If a sponsored piece mentions a real change, find the primary source and use that instead.

Record why each dropped result failed. Add repeat offenders to the blocked list in `sources.md` and newsrooms that produced good stories to the trusted list. Those lists are what make the next run cleaner.

### Rising topics

Fresh is not the same as growing. Measure growth two ways:

- **Search interest.** Run the watchlist and the day's candidate entities through Google Trends (through Treg if available) and keep the ones climbing over the last 7 days against the last 90. Check the "rising" related queries for new entities to add to the watchlist.
- **Coverage velocity.** Run the same query over two date ranges, the last 48 hours and the 7 days before, and count distinct independent domains. More sites in two days than in the previous week means it is rising.

Tag each story `breaking`, `rising`, `steady` or `calendar`. Rising stories are the best targets: they will still matter when the short is posted.

## Step 4: Pull in the clips

### Generate connections (go wide before judging)

For each story, find every clip that could ride it, not just the best one. Do not filter while generating. Volume is what produces the strange, good ones.

1. **News to clips.** For each story, write 10 or more bridge queries at rising levels of abstraction (the person, the industry, the principle, the feeling, the shape of the story). Weight them, search the transcripts in 40-second windows, and read each candidate moment in context before keeping it.
2. **Clips to news.** Take the strongest evergreen moments and ask of each: what in this week's news could open this?
3. **Wildcard.** Pair random moments with random stories and force a link. Keep only the ones that make you smile.

Set each clip's start time on a clean sentence, and keep a quote of its first few words so the user can confirm it at the timestamp.

Use every lens, not just the first:

| Lens | The link | Hook shape |
|---|---|---|
| Direct | Creator talked about this exact thing or person | "Everyone's talking about X. Here's what [creator] said." |
| Receipt | A prediction that aged well, or badly | "She called this." |
| Principle | The news is a live example of a rule the creator explained | "This is why X just happened." |
| Answer | The news raises a question, the clip answers it | "So should you...?" |
| Explainer | The news uses a concept the creator once unpacked | "What [term] actually means." |
| Analogy | Same shape, different world | "[News] is really a story about..." |
| Juxtaposition | The clip says the opposite, or the pairing is absurd | Headline, then hard cut |
| Advice | What the person in the news should have done | "Someone send this to X." |
| Emotion | The clip voices what people feel about the news | "If today's news has you feeling..." |
| Line | One sentence in the clip works as a caption for the news | The line itself under the headline |
| Number | A figure in the news echoes a figure in the clip | Two numbers side by side |
| Echo | An anniversary or repeat of something the creator covered | "Here we go again." |

Record each pair with: story, video id, start time, lens, the **bridge line** (the single sentence, under 12 words, that carries the viewer from the news into the clip) and the quote.

### Clip cards

Each time a moment is used or shortlisted, save it as a card in `clip-cards.jsonl`: id, video, in and out times, verbatim text, one-line summary, and its handles (topics, claim, principle, prediction, story, emotion, best line, questions it answers, numbers, archetype). News almost never matches a clip by topic alone. It matches by principle, emotion, shape or a single line, and cards make those matches findable on later runs without re-reading the transcripts.

### Score

Score in a separate pass from generating. If the user has asked for subagents, hand scoring to one that did not write the pairs. Otherwise say on the shortlist that the scores were set in the same pass.

**Gates first. Fail any and the pair is dropped:**

- **Honest framing.** Nothing on screen or in the caption may say or suggest the creator is responding to this news: no "reacts to", no "her take on today's". The news panel states the news; the clip is simply the clip. The date the clip was recorded is not shown on screen, because the piece should feel immediate. The caption credits and links the original video.
- **True to the clip.** In its original context the clip means what the hook suggests it means.
- **Sensitive news.** Deaths, disasters, violence and private people's misfortune are dropped by default. Keep only a Direct link that is plainly respectful.
- **Not repeated.** Same clip not used in the last 60 days, same pair never.

**Then score the story 1 to 5 on each:**

| Dimension | The question |
|---|---|
| Legibility | Does a cold viewer get the link in three seconds with only the bridge line? |
| Spark | Is it surprising, witty or sharply juxtaposed? Would someone send it to a friend? |
| Clip strength | Strong first sentence, self-contained, real payoff? |
| Heat | How much do people care today, and how long will they? |
| Graphic potential | Is there a visual idea that makes the link land? |
| Creator fit | Would the creator be glad to post it? |

Total = Legibility x2 + Spark x2 + the other four (max 40).

Legibility and Spark pull against each other: an obvious direct match is legible but flat, a wild analogy has spark but may confuse. The winners score 4 or more on both. Label each story **safe** (high legibility) or **swing** (high spark) and include both kinds. Adjust scores using `taste.md`.

Flag on the shortlist anything the user should check first: a single-source story, a clip from a sponsored video, a thin match, a clip that is about something adjacent to the story.

### Shortlist page

Publish one page: a ranked bar chart of the top 10 stories by score, then for each story its date, tag, post-by date, sources, the six scores, the flag, and every related clip with its lens, bridge line, quote and a link to the timestamp.

## Step 5: Build the motion graphics (three versions per story)

The finished short is a vertical split screen. The top half is the news panel. The bottom half is the creator's clip, playing untouched.

### Rules for every news panel

- **Nothing goes over the creator's face.** All graphics stay in the top half. The only things laid on the clip are captions along its bottom edge and the small end pop-up in its top right corner.
- **Captions on every clip.** If the clip has none burned in, add them at the bottom of the clip: short lines of about five words, white on a dark strip, timed from the transcript's millisecond start times (keep those when saving transcripts). Check a few frames first so captions are not doubled.
- **End on a call to action.** For the last two seconds of the clip, a small pop-up appears in the top right corner of the clip: a play triangle and the words "Watch the full video". Keep it to about 10% of the clip's height so it never covers the presenter's face. Offer it in a few looks (solid pill in the palette's accent, dark glass, white card, a tab sliding in from the edge) and rotate them across the versions so the user can pick. Draw a plain play button, not YouTube's logo. On the review page it links to the full video; in the posted short the link goes in the caption.
- **It opens on the news date and the headline.** The date is called out strongly, as a solid block ahead of the headline. There is no "in the news" label: a headline and a date already say that.
- **Keep it small.** One headline of two lines at most (about 38 characters) and one graphic idea. If it needs explaining, it is too busy.
- **Move once, freeze, then idle.** The graphic makes its one move in the first two seconds and stops. Half a second later a tiny loop begins and never ends: 2 to 4 pixels of travel or 1 to 2% of scale, on a slow two-second ease. The idle loop is what keeps the eye there while the clip plays.
- **No recorded date on screen.** Everything should feel immediate.
- **Typeset and drawn only.** Headlines are set as text with the source name. Graphics are plain shapes. No screenshots, news footage, logos or photos of the people in the story.
- **Only sourced numbers.** Any figure on screen comes from the story's sources. A joke may use something obviously symbolic (question marks, an endless receipt) but never an invented figure that could be read as fact.
- **Jokes land on objects, not people.** The bottle, the bill, the turkey. Never the person in the story.

### Three versions, three ideas

Build all three for every story. They differ in idea, not just in volume:

- **Simple**: one quiet move. A counter rolls up, a line draws, a sticker lands.
- **Exaggerated**: the same point turned up until it breaks the frame. A tower leaves the panel, the figure slams in, the screen shakes once.
- **Funny**: a visual joke about the story. The apartment shrinks as the rent climbs. The chart is a rollercoaster.

Each idle loop should belong to its idea: the cursor keeps blinking, the sign keeps swinging, the bottle keeps peeking out of the bin.

### Colour is part of the test

The three versions of a story must sit in three very different colour worlds: one dark, one light, one saturated. Rotate which version gets which family from story to story, so the user is never judging "funny" and "yellow" as one thing. Show the palette name beside each version. Each palette needs strong contrast for the headline, and an accent that reads clearly against the background.

Start from `pipeline/motion/palettes.json` (nine palettes, three per family). Add or retire palettes as `taste.md` learns what the user likes, and match the creator's own brand colours once they are known.

### How to build them

Use `pipeline/motion/template.html`, which provides the split-screen frame, the date and headline block, the move-once and idle animation classes, the counters and typewriter, and the palette rotation. Write the run's story-specific graphics in `runs/<date>/variants.js`, three per story, drawing with the palette's colours so any version can be recoloured. Then:

```
python3 pipeline/motion/build_motion.py runs/<date>/shortlist.json runs/<date>/variants.js runs/<date>/motion-options.html --handle <creator>
```

Render the page and look at it before sharing: check every end state, and check that the headline is still readable where an exaggerated graphic crosses it. Publish it as a page with a replay control per story.

When the user supplies the cut clips, rebuild with `--clips clips.json` (story rank to clip file) and `--cues cues.json` (story rank to caption cues, timed from the start of the clip). The page then plays each real clip under its three graphics, muted until a frame is clicked, with captions and the end call to action. This page reads local video files, so save it beside the clips instead of publishing it.

### After the user picks

For each chosen version, write a short build note for the editor: the story and sources, the clip with its timestamp, in and out points, the bridge line, the on-screen text, the one move and the idle loop, the palette, and the caption with the credit to the original video. If the Motion artifact type is available, offer to render the chosen versions as films that export to MP4.

## Step 6: Deliver and learn

Share the shortlist page and the motion options page, with the flags stated plainly. Ask which stories, which versions and which colours the user likes.

Write what you learn to `taste.md` as short rules with the example that taught it, for ideas ("prefers the visual joke over the big number") and for colour ("likes light palettes, dislikes red"). Update `ledger.csv` with every pair's status. The skill should get noticeably better at this user's taste with each run.

## Running daily, unattended

Top up the library only if there are new videos. Do not stop to ask questions: state the assumptions made at the top of the shortlist. If the news day is thin, say so and return fewer, better stories instead of padding.
