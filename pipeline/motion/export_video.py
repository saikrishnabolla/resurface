#!/usr/bin/env python3
"""Render finished split-screen shorts (news panel on top, clip underneath) as MP4 files.

usage: export_video.py PAGE_DIR OUT_DIR PICK [PICK ...] [--fonts DIR] [--fps 30]

PAGE_DIR  folder holding the page built by build_motion.py with --clips and --cues (as index.html
          or motion-with-clips.html) and the clip files beside it
PICK      which frames to render, as <story rank>-<version>, version being simple, exaggerated,
          funny or 0, 1, 2. Example: 2-funny 5-simple

How it works: the page is opened in export mode, where time is driven by this script instead of the
clock, so every animation, counter and caption lands on an exact frame. Each frame of the news panel,
captions and end pop-up is saved with a transparent clip area, then ffmpeg lays those frames over the
original clip (cropped the same way the page crops it) and keeps the clip's own sound.
Needs: playwright with Chrome, ffmpeg and ffprobe.
"""
import argparse, asyncio, functools, http.server, json, os, re, shutil, subprocess, tempfile, threading

VERSIONS = {'simple': 0, 'exaggerated': 1, 'funny': 2, '0': 0, '1': 1, '2': 2}

# Replaces the page's clocks and timers with a virtual clock that only moves when __advance is called.
SHIM = r"""(() => {
  let vt = 0, id = 0, rafs = []; const timers = new Map(), born = new WeakMap(), base = Date.now();
  performance.now = () => vt; Date.now = () => base + vt;
  window.setTimeout = (f, d, ...a) => { timers.set(++id, {t: vt + (+d || 0), f, a}); return id; };
  window.setInterval = (f, d, ...a) => { timers.set(++id, {t: vt + (+d || 0), f, a, every: Math.max(1, +d || 0)}); return id; };
  window.clearTimeout = window.clearInterval = i => { timers.delete(i); };
  window.requestAnimationFrame = f => { rafs.push([++id, f]); return id; };
  window.cancelAnimationFrame = i => { rafs = rafs.filter(r => r[0] !== i); };
  window.__advance = to => {
    for (let guard = 0; guard < 20000; guard++) {
      let pick = null, pid = 0;
      for (const [i, x] of timers) if (x.t <= to && (!pick || x.t < pick.t)) { pick = x; pid = i; }
      if (!pick) break;
      vt = pick.t;
      if (pick.every) pick.t += pick.every; else timers.delete(pid);
      try { pick.f(...pick.a); } catch (e) { console.error(e); }
    }
    vt = to;
    const r = rafs; rafs = [];
    for (const [, f] of r) { try { f(vt); } catch (e) { console.error(e); } }
    // CSS animations and SVG motion are paused and placed by hand, counted from when each first appeared
    for (const a of document.getAnimations()) { if (!born.has(a)) born.set(a, vt); a.pause(); a.currentTime = vt - born.get(a); }
    for (const s of document.querySelectorAll("svg")) if (s.pauseAnimations) { if (!born.has(s)) born.set(s, vt); s.pauseAnimations(); s.setCurrentTime((vt - born.get(s)) / 1000); }
  };
})();"""

FONT_CSS = """
@font-face{font-family:"Bricolage Grotesque";src:url(/__fonts/bricolage-grotesque-latin-opsz-normal.woff2) format("woff2");font-weight:200 800}
@font-face{font-family:"IBM Plex Mono";src:url(/__fonts/ibm-plex-mono-latin-400-normal.woff2) format("woff2");font-weight:400}
@font-face{font-family:"IBM Plex Mono";src:url(/__fonts/ibm-plex-mono-latin-500-normal.woff2) format("woff2");font-weight:500}
@font-face{font-family:"IBM Plex Mono";src:url(/__fonts/ibm-plex-mono-latin-600-normal.woff2) format("woff2");font-weight:600}
"""


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    return d['streams'][0]['width'], d['streams'][0]['height'], float(d['format']['duration'])


def crop_filter(w, h, pos):
    """Same crop as the page's object-fit: cover into a 9:8 box, honouring object-position."""
    px, py = [float(x.strip('%')) / 100 for x in (pos or '50% 50%').split()]
    if w / h > 9 / 8:
        cw = round(h * 9 / 8 / 2) * 2
        return f'crop={cw}:{h}:{round((w - cw) * px)}:0'
    ch = round(w * 8 / 9 / 2) * 2
    return f'crop={w}:{ch}:0:{round((h - ch) * py)}'


async def render(page_url, clip_path, pos, pick, out_path, fps, has_fonts):
    from playwright.async_api import async_playwright
    w, h, dur = probe(clip_path)
    frames = int(dur * fps)
    tmp = tempfile.mkdtemp(prefix='resurface_')
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome')
        ctx = await b.new_context(viewport={'width': 540, 'height': 960}, device_scale_factor=2)
        await ctx.add_init_script(SHIM)
        page = await ctx.new_page()
        if has_fonts:  # use the local font files and skip the web font request
            await page.route('**/fonts.googleapis.com/**', lambda r: r.abort())
            await page.route('**/fonts.gstatic.com/**', lambda r: r.abort())
        await page.goto(f'{page_url}?export={pick}')
        if has_fonts:
            await page.add_style_tag(content=FONT_CSS)
            await page.evaluate("""Promise.all(['700 20px "Bricolage Grotesque"','500 20px "Bricolage Grotesque"','500 12px "IBM Plex Mono"','600 12px "IBM Plex Mono"','400 12px "IBM Plex Mono"'].map(f=>document.fonts.load(f)))""")
        # wait (in real time) until the frame is on screen and the clip's length is known
        for _ in range(100):
            ok = await page.evaluate("""(()=>{const a=document.querySelector('.story.x'),v=document.querySelector('figure.x video');return !!a&&a.dataset.vis==='1'&&!!v&&v.readyState>=1})()""")
            if ok: break
            await asyncio.sleep(0.1)
        else:
            raise SystemExit(f'{pick}: the page never showed that frame with a clip. Is the pick right, and was the page built with --clips?')
        box = await (await page.query_selector('figure.x .phone')).bounding_box()
        for k in range(frames):
            await page.evaluate("t=>{window.__clipT=t/1000;window.__advance(t)}", k * 1000 / fps)
            await page.screenshot(path=f'{tmp}/f_{k:05d}.png', omit_background=True, clip=box)
        await b.close()
    vf = (f'[0:v]fps={fps},{crop_filter(w, h, pos)},scale=1080:960:flags=lanczos,setsar=1,pad=1080:1920:0:960:black[bg];'
          f'[1:v]scale=1080:1920[ov];[bg][ov]overlay=0:0:shortest=1,format=yuv420p[v]')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', clip_path, '-framerate', str(fps), '-i', f'{tmp}/f_%05d.png', '-filter_complex', vf,
                    '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k',
                    '-movflags', '+faststart', '-shortest', out_path], check=True)
    shutil.rmtree(tmp, ignore_errors=True)
    return frames, dur


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('page_dir'); ap.add_argument('out_dir'); ap.add_argument('picks', nargs='+')
    ap.add_argument('--fonts', help='folder of .woff2 files (Bricolage Grotesque variable, IBM Plex Mono 400/500/600) to use instead of web fonts')
    ap.add_argument('--fps', type=int, default=30)
    a = ap.parse_args()
    page_dir = os.path.abspath(a.page_dir)
    name = next(n for n in ('motion-with-clips.html', 'index.html') if os.path.exists(os.path.join(page_dir, n)))
    html = open(os.path.join(page_dir, name), encoding='utf-8').read()
    stories = json.loads(re.search(r'<script id="d" type="application/json">(.*?)</script>', html, re.S).group(1))
    by_rank = {s['r']: s for s in stories}

    class H(http.server.SimpleHTTPRequestHandler):
        def translate_path(self, path):
            if path.startswith('/__fonts/') and a.fonts:
                return os.path.join(os.path.abspath(a.fonts), os.path.basename(path.split('?')[0]))
            return super().translate_path(path)
        def log_message(self, *x): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(H, directory=page_dir))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{srv.server_address[1]}/{name}'
    os.makedirs(a.out_dir, exist_ok=True)
    for pick in a.picks:
        rank, ver = pick.split('-', 1)
        s = by_rank[int(rank)]; j = VERSIONS[ver.lower()]
        if not s.get('clip'):
            print(f'{pick}: no clip for story {rank}, skipped'); continue
        from urllib.parse import unquote
        clip = os.path.join(page_dir, unquote(s['clip']))
        slug = re.sub(r'[^a-z0-9]+', '-', s['t'].lower()).strip('-')[:40].strip('-')
        out = os.path.join(a.out_dir, f"{int(rank):02d}-{slug}-{['simple', 'exaggerated', 'funny'][j]}.mp4")
        n, dur = asyncio.run(render(url, clip, s.get('pos'), f'{rank}-{j}', out, a.fps, bool(a.fonts)))
        print(f'{pick}: {n} frames, {dur:.1f}s -> {out}')
    srv.shutdown()


if __name__ == '__main__':
    main()
