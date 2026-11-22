#!/usr/bin/env python3
"""Render one news panel per story as a 1080x960 video.

usage: PAGE=motion-options.html PICK='{1:1,2:0}' DURS=durs.json python3 render_top.py
PICK maps story rank to version index (0 simple, 1 exaggerated, 2 funny); DURS maps rank to clip seconds.
A virtual clock drives the page's timers and every CSS animation is paused and seeked per frame, so output is exact.
Then stack each top<rank>.mp4 over its clip with compose.sh.
"""
import asyncio,sys,json,subprocess,os
from playwright.async_api import async_playwright
import os
PICK={int(k):v for k,v in eval(os.environ.get('PICK','{1:1,2:0,3:0,4:1,5:1,6:2,7:0,8:0,9:2,10:0}')).items()}
DUR=json.load(open(os.environ.get('DURS','durs.json')))
FPS=30
INIT=r"""
(()=>{let VT=0;const T=[];let id=1;
performance.now=()=>VT;const D0=1.795e12;Date.now=()=>D0+VT;
window.requestAnimationFrame=cb=>{T.push({id:id,at:VT,cb,raf:1});return id++};window.cancelAnimationFrame=()=>{};
window.setTimeout=(cb,ms)=>{T.push({id:id,at:VT+(+ms||0),cb});return id++};
window.setInterval=(cb,ms)=>{const o={id:id,at:VT+(+ms||0),cb,every:+ms||16};T.push(o);return id++};
window.clearInterval=window.clearTimeout=k=>{const i=T.findIndex(o=>o.id===k);if(i>=0)T.splice(i,1)};
delete window.IntersectionObserver;
window.__step=ms=>{for(let guard=0;guard<5000;guard++){T.sort((a,b)=>a.at-b.at);const o=T[0];if(!o||o.at>ms)break;T.shift();VT=o.at;if(o.every){o.at+=o.every;T.push(o)}try{o.cb(o.raf?VT:undefined)}catch(e){}}VT=ms;
 document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms})};
window.__reset=()=>{VT=0;T.length=0};
})();"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for r,j in PICK.items():
            pg=await b.new_page(viewport={'width':1200,'height':1000},device_scale_factor=3.6)
            await pg.add_init_script(INIT)
            await pg.goto('file://'+os.path.abspath(os.environ.get('PAGE','motion-options.html'))); await pg.wait_for_timeout(800);await pg.add_style_tag(content='.phone{border-radius:0!important;box-shadow:none!important}')
            idx=await pg.evaluate("r=>S.findIndex(s=>s.r===r)",r)
            await pg.evaluate("i=>{const a=document.querySelector('.story[data-i=\"'+i+'\"]');a.scrollIntoView();__reset();build(a)}",idx)
            await pg.evaluate("__step(0)")
            top=pg.locator(f'.story[data-i="{idx}"] figure').nth(j).locator('.top')
            n=int(DUR[str(r)]*FPS)+1; out=f'f{r}'; os.makedirs(out,exist_ok=True)
            for k in range(n):
                await pg.evaluate(f"__step({k*1000/FPS})")
                await top.screenshot(path=f'{out}/{k:04d}.png',animations='allow')
            await pg.close()
            subprocess.run(['ffmpeg','-v','error','-y','-framerate',str(FPS),'-i',f'{out}/%04d.png','-vf','scale=1080:960:flags=lanczos,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','18',f'top{r}.mp4'],check=True)
            print(r,j,n,'frames',flush=True)
        await b.close()
asyncio.run(main())
