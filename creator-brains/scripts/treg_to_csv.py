#!/usr/bin/env python3
"""Turn saved Treg (TikHub / ScrapeCreators) TikTok and Instagram responses into a videos CSV.

Large Treg MCP results are saved to /tmp/claude-tool-results/*/mcp-Treg-call-*.txt. Run:
  python3 treg_to_csv.py out.csv        # newest 100 per handle
Also prints the latest pagination cursor per handle so you can request the next page.
Supported endpoints: tikhub.x.tiktok-app-v3-fetch-user-post-videos (aweme_list),
tikhub.tiktok.user.videos (itemList), tikhub.x.instagram-v2-fetch-user-reels and -v1-.
"""
import json, glob, csv, sys
from datetime import datetime, timezone

rows = {}   # (platform, handle) -> {id: row}
cursors = {}  # (platform, handle, src) -> (cursor, more, ts)

def ts(x):
    try: return datetime.fromtimestamp(int(x), timezone.utc).strftime('%Y-%m-%d')
    except Exception: return ''

def add(plat, h, vid, url, title, views, pub, typ):
    rows.setdefault((plat, h), {})[vid] = dict(platform=plat, handle=h, type=typ, video_id=vid, url=url,
        title=(title or '').replace('\n', ' ').strip()[:300], views=views, published=pub)

files = sorted(glob.glob('/tmp/claude-tool-results/*/mcp-Treg-call-*.txt') + glob.glob('/tmp/claude-tool-results/*/toolu_*.json'))
for f in files:
    try:
        j = json.load(open(f))
        if isinstance(j, list): j = json.loads(j[0]['text'])
    except Exception: continue
    ep = j.get('endpoint_id', ''); b = j.get('body') or {}
    mt = int(f.split('mcp-Treg-call-')[1][:13]) if 'mcp-Treg-call-' in f else 0
    if 'tiktok' in ep:
        d = b.get('data', b)
        if 'aweme_list' in d:
            al = d['aweme_list'] or []
            for a in al:
                h = a['author']['unique_id']
                add('tiktok', h, a['aweme_id'], f"https://www.tiktok.com/@{h}/video/{a['aweme_id']}", a.get('desc'),
                    (a.get('statistics') or {}).get('play_count'), ts(a.get('create_time')), 'video')
            if al: cursors[('tiktok', al[0]['author']['unique_id'], 'app')] = (d.get('max_cursor'), d.get('has_more'), mt)
        elif 'itemList' in d:
            il = d['itemList'] or []
            for a in il:
                h = a['author']['uniqueId']
                add('tiktok', h, a['id'], f"https://www.tiktok.com/@{h}/video/{a['id']}", a.get('desc'),
                    (a.get('stats') or {}).get('playCount'), ts(a.get('createTime')), 'video')
            if il: cursors[('tiktok', il[0]['author']['uniqueId'], 'web')] = (d.get('cursor'), d.get('hasMore'), mt)
    elif 'instagram' in ep:
        d = b.get('data', b)
        if isinstance(d, dict) and 'data' in d and isinstance(d['data'], dict):  # v2
            items = d['data'].get('items') or []; cur = d.get('pagination_token'); src = 'v2'; more = bool(cur)
        else:
            items = d.get('items') or []; pi = d.get('paging_info') or {}; cur = pi.get('max_id'); more = pi.get('more_available'); src = 'v1'
        from collections import Counter
        us = [((it.get('media', it).get('user') or it.get('media', it).get('owner') or {}).get('username')) for it in items]
        h = Counter([u for u in us if u]).most_common(1)[0][0] if any(us) else None
        uid = None
        for it in items:
            m = it.get('media', it)
            u = m.get('user') or m.get('owner') or {}
            cap = (m.get('caption') or {}).get('text') if isinstance(m.get('caption'), dict) else m.get('caption')
            add('instagram', h, m.get('code'), f"https://www.instagram.com/reel/{m.get('code')}/", cap,
                m.get('play_count') or m.get('ig_play_count') or m.get('view_count'), ts(m.get('taken_at')), 'reel')
            if u.get('username') == h: uid = u.get('pk') or u.get('id')
        if items and h: cursors[('instagram', h, src)] = (cur, more, mt, uid)

if __name__ == '__main__':
    for k in sorted(rows): print(k, len(rows[k]))
    print('--- latest cursors')
    for k, v in sorted(cursors.items()): print(k, v)
    if len(sys.argv) > 1:
        out = [r for k in sorted(rows) for r in sorted(rows[k].values(), key=lambda r: r['published'], reverse=True)[:100]]
        with open(sys.argv[1], 'w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
        print('wrote', len(out))
