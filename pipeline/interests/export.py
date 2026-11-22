import json,re,collections
d=json.load(open('hits.json')); recs=json.load(open('recs.json'))
recs.sort(key=lambda r:r['published'],reverse=True)
vidx={r['id']:i for i,r in enumerate(recs)}
byid={r['id']:r for r in recs}
def snippet(vid,si,a,b,maxw=12):
    segs=byid[vid]['segments']
    pre=(segs[si-1][1]+' ' if si>0 else ''); cur=segs[si][1]; post=(' '+segs[si+1][1] if si+1<len(segs) else '')
    full=pre+cur+post; a+=len(pre); b+=len(pre)
    while a>0 and not full[a-1].isspace(): a-=1
    while b<len(full) and not full[b].isspace(): b+=1
    mid=full[a:b]; left=full[:a].split(); right=full[b:].split()
    mw=len(mid.split()); room=max(2,(maxw-mw)//2)
    l=left[-room:]; r=right[:max(0,maxw-mw-len(l))]
    s=' '.join(l+[mid]+r)
    s=re.sub(r'\[\s*_+\s*\]','',s); s=s.replace('>>',''); s=re.sub(r'\s+',' ',s).strip(); s=re.sub(r'\s+([,.!?;:])',r'\1',s)
    return s
terms=[]
for i,t in enumerate(d['terms']):
    hs=d['hits'].get(str(i),[])
    if not hs: continue
    per=collections.OrderedDict()
    for vid,si,a,b in hs: per.setdefault(vid,[]).append((si,a,b))
    vs=sorted(per.items(),key=lambda kv:vidx[kv[0]])
    vlist=[];n=0
    for vid,ms in vs:
        segs=byid[vid]['segments']
        ts=[segs[m[0]][0] for m in ms]
        ent=[vidx[vid],len(ms),ts[:6]]
        if n<8:
            m=ms[0]; ent.append(snippet(vid,*m)); n+=1
        vlist.append(ent)
    terms.append(dict(l=t['label'],k=t['kind'],g=t['group'],v=len(per),m=len(hs),c=vlist))
videos=[dict(id=r['id'],t=r['title'],d=r['published'],s=r['duration_s'],w=r['views']) for r in recs]
data=dict(videos=videos,terms=terms,hours=round(sum(r['duration_s'] for r in recs)/3600),words=sum(len(s[1].split()) for r in recs for s in r['segments']))
import os
os.makedirs('site',exist_ok=True)
def dump(arr,p):
    open(p,'w').write('[\n'+',\n'.join(json.dumps(x,ensure_ascii=False,separators=(',',':')) for x in arr)+'\n]\n')
dump(videos,'site/videos.json'); dump(terms,'site/terms.json')
json.dump(data,open('data.json','w'),ensure_ascii=False,separators=(',',':'))
import os
print(len(terms),'terms with hits; size',os.path.getsize('data.json'))
k=collections.Counter(t['k'] for t in terms); print(k)
print(sum(t['m'] for t in terms),'mentions',sum(t['v'] for t in terms),'term-video pairs', sum(1 for t in terms for c in t['c'] if len(c)>3),'snippets')
print(max(len(c[3].split()) for t in terms for c in t['c'] if len(c)>3))
import random
random.seed(3)
for t in random.sample(terms,8): print(t['l'],'|',t['v'],t['m'],'|',t['c'][0][3] if len(t['c'][0])>3 else '')
