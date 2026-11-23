import json, sys, os
# usage: page_shortlist.py SHORTLIST.json OUT_DIR   (writes news-hooks.html, shortlist.md, ledger.csv)
OUT=sys.argv[2] if len(sys.argv)>2 else 'out'; os.makedirs(OUT,exist_ok=True)
S=json.load(open(sys.argv[1] if len(sys.argv)>1 else 'run/shortlist.json'))
data=json.dumps(S,ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
n=sum(len(s['c']) for s in S)
html='''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kameron Monet News Hooks 22 Nov</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{/* layout: one ranked bar chart on top, then a card per story with its clips */
--bg:#f3f5f8;--surface:#fcfcfb;--ink:#141a24;--ink-2:#4a5565;--ink-3:#7b8696;--line:#dfe4ea;--wash:#e9edf2;--bar:#2a78d6;--warn-bg:#fff4d6;--warn-ink:#5c4300;
--display:"Bricolage Grotesque","Arial Narrow",system-ui,sans-serif;--body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--bg:#12151a;--surface:#1a1d23;--ink:#eef0f3;--ink-2:#b9c0cb;--ink-3:#8a93a1;--line:#2c323b;--wash:#232830;--bar:#3987e5;--warn-bg:#3a2f10;--warn-ink:#f3dfa6}}
:root[data-theme="dark"]{color-scheme:dark;--bg:#12151a;--surface:#1a1d23;--ink:#eef0f3;--ink-2:#b9c0cb;--ink-3:#8a93a1;--line:#2c323b;--wash:#232830;--bar:#3987e5;--warn-bg:#3a2f10;--warn-ink:#f3dfa6}
*{box-sizing:border-box}html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased}
a{color:inherit}:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.wrap{max-width:1060px;margin:0 auto;padding:28px 20px 60px}
h1{font-family:var(--display);font-weight:700;font-size:clamp(28px,4vw,42px);line-height:1.05;letter-spacing:-.02em;margin:0 0 8px;text-wrap:balance}
.lede{margin:0;color:var(--ink-2);max-width:68ch}
.stats{display:flex;flex-wrap:wrap;gap:6px 22px;margin:14px 0 0;padding:0;list-style:none;font-family:var(--mono);font-size:12.5px;color:var(--ink-2)}.stats b{color:var(--ink);font-weight:500}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:20px}
.panel h2{font-family:var(--display);font-size:18px;margin:0 0 4px}.panel .sub{color:var(--ink-3);font-size:12.5px;margin:0 0 12px}
.row{display:grid;grid-template-columns:22px minmax(0,1.15fr) minmax(0,1fr) 78px;gap:12px;align-items:center;padding:6px 4px;border-radius:8px;text-decoration:none}
.row:hover{background:var(--wash)}
.row .rk{font-family:var(--mono);font-size:12px;color:var(--ink-3);text-align:right}
.row .nm{font-weight:500;font-size:14px;line-height:1.25}
.track{height:14px;background:var(--wash);border-radius:4px;position:relative}
.track i{display:block;height:100%;background:var(--bar);border-radius:4px}
.row .val{font-family:var(--mono);font-size:12.5px;font-variant-numeric:tabular-nums;white-space:nowrap}.row .val span{color:var(--ink-3)}
.axis{display:grid;grid-template-columns:22px minmax(0,1.15fr) minmax(0,1fr) 78px;gap:12px;font-family:var(--mono);font-size:11px;color:var(--ink-3);padding:4px 4px 0}
.axis div:nth-child(3){display:flex;justify-content:space-between}
.story{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px;margin-top:16px;scroll-margin-top:12px}
.head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:start}
.num{font-family:var(--display);font-weight:700;font-size:34px;line-height:1;color:var(--ink-3)}
.story h3{font-family:var(--display);font-weight:700;font-size:23px;line-height:1.12;letter-spacing:-.01em;margin:0 0 6px;text-wrap:balance}
.total{text-align:right;font-family:var(--mono)}.total b{font-size:24px;font-weight:500}.total span{color:var(--ink-3);font-size:12px}
.meta{display:flex;flex-wrap:wrap;gap:6px;font-size:12px;margin:0 0 8px}
.pill{border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-family:var(--mono);font-size:11.5px;color:var(--ink-2);background:var(--bg)}
.what{margin:0 0 8px;color:var(--ink-2);max-width:72ch}
.src{font-size:12.5px;color:var(--ink-3);margin:0 0 12px}.src a{color:var(--ink-2)}
.dims{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin:0 0 12px}
.dim{background:var(--bg);border-radius:8px;padding:6px 8px}.dim small{display:block;font-size:11px;color:var(--ink-3)}.dim b{font-family:var(--mono);font-weight:500;font-size:13px}
.dim .pips{display:flex;gap:2px;margin-top:4px}.dim .pips i{flex:1;height:4px;border-radius:2px;background:var(--wash)}.dim .pips i.on{background:var(--bar)}
.flag{background:var(--warn-bg);color:var(--warn-ink);border-radius:8px;padding:8px 10px;font-size:13px;margin:0 0 12px}
.clips{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.clips li{display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:12px;align-items:start;padding:11px 0;border-bottom:1px solid var(--line)}
.clips li:last-child{border-bottom:0;padding-bottom:0}
.lens{font-family:var(--mono);font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);padding-top:2px}
.bridge{font-weight:600;font-size:15px;line-height:1.3;margin:0 0 3px}
.clips q{display:block;color:var(--ink-2);font-size:13.5px;margin:0 0 3px;quotes:"\\201C" "\\201D"}
.vid{font-size:12px;color:var(--ink-3)}
.go{font-family:var(--mono);font-size:12px;text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:4px 8px;background:var(--bg);white-space:nowrap}.go:hover{border-color:var(--ink)}
footer{margin-top:26px;color:var(--ink-3);font-size:12.5px;max-width:80ch}footer p{margin:0 0 8px}
@media (max-width:680px){.row,.axis{grid-template-columns:18px minmax(0,1fr) 92px}.row .track,.axis div:nth-child(3){grid-column:2/4;grid-row:2}.row .val{grid-column:3;grid-row:1;text-align:right}.dims{grid-template-columns:repeat(3,minmax(0,1fr))}.clips li{grid-template-columns:minmax(0,1fr) auto}.lens{grid-column:1/-1}.head{grid-template-columns:auto minmax(0,1fr)}.total{grid-column:1/-1;text-align:left}}
</style></head><body><div class="wrap">
<header><h1>This week's news hooks for Kameron Monet</h1>
<p class="lede">Ten stories from 16 to 22 November 2026, ranked by how well her backlog answers them. Each one lists every clip that could ride it, with the line that carries a viewer from the headline into the clip.</p>
<ul class="stats"><li><b>10</b> stories</li><li><b>__N__</b> clips</li><li><b>100</b> videos searched</li><li>run <b>Sun 22 Nov 2026</b></li></ul></header>
<section class="panel"><h2>Hook score by story</h2><p class="sub">Out of 40: legibility and spark count double, then clip strength, heat, graphic potential and creator fit. Select a row to jump to its clips.</p>
<div id="chart"></div><div class="axis"><div></div><div></div><div><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span></div><div></div></div></section>
<main id="stories"></main>
<footer><p>How this was made: news came from searches limited to the week, and a story stayed in only if a named actor did a specific thing inside the window and it had independent coverage or a primary source. Clips came from keyword searches across the 100 transcripts, and each moment listed here was read in context before it was kept. The quotes are the first words of the moment in the auto-captions, so expect small transcription errors.</p>
<p>Scores are one editor's judgement and were set by the same pass that found the pairs. Every finished short should show the clip's recording date, since none of these clips were made about this week's news.</p></footer>
</div>
<script id="d" type="application/json">__DATA__</script>
<script>
const S=JSON.parse(document.getElementById("d").textContent),D=["Legibility","Spark","Clip","Heat","Graphic","Fit"];
const e=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ft=s=>{const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,"0");return h?h+":"+String(m).padStart(2,"0")+":"+x:m+":"+x};
document.getElementById("chart").innerHTML=S.map(s=>'<a class="row" href="#s'+s.r+'" title="'+e(s.t)+": "+s.tot+' of 40, '+s.c.length+' clips"><span class="rk">'+s.r+'</span><span class="nm">'+e(s.t)+'</span><span class="track"><i style="width:'+(s.tot/40*100)+'%"></i></span><span class="val">'+s.tot+' <span>· '+s.c.length+' clips</span></span></a>').join("");
document.getElementById("stories").innerHTML=S.map(s=>'<article class="story" id="s'+s.r+'"><div class="head"><div class="num">'+s.r+'</div><div><h3>'+e(s.t)+'</h3><div class="meta"><span class="pill">'+e(s.tag)+'</span><span class="pill">'+e(s.d)+'</span><span class="pill">post '+e(s.post)+'</span><span class="pill">'+e(s.ty)+'</span></div></div><div class="total"><b>'+s.tot+'</b><span> / 40</span></div></div><p class="what">'+e(s.w)+'</p><p class="src">Sources: '+s.src.map(x=>'<a href="'+e(x[1])+'" target="_blank" rel="noopener">'+e(x[0])+"</a>").join(", ")+'</p><div class="dims">'+s.sc.map((v,i)=>'<div class="dim"><small>'+D[i]+(i<2?" ×2":"")+'</small><b>'+v+'</b><div class="pips">'+[1,2,3,4,5].map(k=>'<i class="'+(k<=v?"on":"")+'"></i>').join("")+"</div></div>").join("")+'</div><p class="flag"><b>Check first:</b> '+e(s.flag)+'</p><ul class="clips">'+s.c.map(c=>'<li><div class="lens">'+e(c.l)+'</div><div><p class="bridge">'+e(c.b)+'</p>'+(c.q?"<q>"+e(c.q)+"…</q>":"")+'<div class="vid">'+e(c.t)+" · recorded "+c.d+'</div></div><a class="go" href="https://www.youtube.com/watch?v='+c.v+"&t="+c.s+'s" target="_blank" rel="noopener">Watch at '+ft(c.s)+"</a></li>").join("")+"</ul></article>").join("");
</script></body></html>'''
open(OUT+'/news-hooks.html','w').write(html.replace('__DATA__',data).replace('__N__',str(n)))
# markdown + ledger
md=['# News hooks shortlist, run 2026-11-22','','Creator: Kameron Monet. News window: 16 to 22 Nov 2026. Assumptions: clip matching used keyword search over transcripts with each moment read in context (clip cards not built yet); scores set in the same pass.','']
led=['date,story,video_id,start_s,lens,status']
for s in S:
    md+=[f"## {s['r']}. {s['t']} ({s['tot']}/40, {s['ty']}, {s['tag']})",s['w'],'Sources: '+', '.join(f"[{a}]({b})" for a,b in s['src']),f"Post: {s['post']}. Check first: {s['flag']}",'','| Lens | Bridge line | Clip | Recorded |','|---|---|---|---|']
    for c in s['c']:
        md.append(f"| {c['l']} | {c['b']} | [{c['t'][:50]}](https://www.youtube.com/watch?v={c['v']}&t={c['s']}s) at {c['s']//60}:{c['s']%60:02d} | {c['d']} |")
        led.append(f"2026-11-22,\"{s['t']}\",{c['v']},{c['s']},{c['l']},shortlisted")
    md.append('')
import os

open(OUT+'/shortlist.md','w').write('\n'.join(md))
open(OUT+'/ledger.csv','w').write('\n'.join(led)+'\n')
print(len(html), n, (chr(0x2014) in html+data))
