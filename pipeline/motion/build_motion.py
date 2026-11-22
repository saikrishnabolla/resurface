#!/usr/bin/env python3
"""Assemble the motion options page for one run.

usage: build_motion.py SHORTLIST.json VARIANTS.js OUT.html [--handle KameronMonet] [--title "Motion options"] [--clips clips.json] [--cues cues.json]

SHORTLIST.json  the run's ranked stories (fields are listed in pipeline/README.md)
VARIANTS.js     the run's story-specific graphics, three per story (simple, exaggerated, funny)
The template supplies the split-screen frame, the animation classes and the palettes.
"""
import json, re, os, argparse
ap = argparse.ArgumentParser()
ap.add_argument('shortlist'); ap.add_argument('variants'); ap.add_argument('out')
ap.add_argument('--handle', default='creator'); ap.add_argument('--title', default='Motion options')
ap.add_argument('--cues', help='JSON file mapping story rank to caption cues [[start_s, end_s, text], ...], timed from the start of the clip')
ap.add_argument('--clips', help='JSON file mapping story rank to a clip: {"1": {"file": "01.mp4", "pos": "40% 50%", "zoom": 1.2}}; paths are relative to OUT.html')
a = ap.parse_args()
here = os.path.dirname(os.path.abspath(__file__))
stories = []
clips = json.load(open(a.clips)) if a.clips else {}
cues = json.load(open(a.cues)) if a.cues else {}
for s in json.load(open(a.shortlist)):
    c = s['c'][0]  # the top-ranked clip for the story
    m = re.search(r'(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?\d{1,2} [A-Z][a-z]{2}', s['d'])
    stories.append(dict(r=s['r'], t=s['t'], d=m.group(0) if m else s['d'], src=s['src'][0][0],
                        b=c['b'], q=c['q'], v=c['v'], s=c['s']))
    k = clips.get(str(s['r']))
    if k: stories[-1].update(clip=k['file'] if isinstance(k, dict) else k, pos=(k.get('pos') if isinstance(k, dict) else None) or '50% 50%', cues=cues.get(str(s['r']), []), zoom=(k.get('zoom') if isinstance(k, dict) else None))
js = lambda o: json.dumps(o, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
page = open(os.path.join(here, 'template.html')).read()
page = (page.replace('__DATA__', js(stories))
            .replace('__PALS__', js(json.load(open(os.path.join(here, 'palettes.json')))))
            .replace('__VARIANTS__', open(a.variants).read())
            .replace('__HANDLE__', a.handle.lstrip('@')).replace('__TITLE__', a.title))
assert chr(0x2014) not in page, 'house rule: no em dashes in output'
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
open(a.out, 'w').write(page)
print(len(stories), 'stories,', len(page), 'bytes ->', a.out)
