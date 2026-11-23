import json,glob,os,re,csv
import sys
D=(sys.argv[1] if len(sys.argv)>1 else 'tool-results').rstrip('/')+'/'  # folder of saved Treg results
OUT=sys.argv[2] if len(sys.argv)>2 else '.'
meta={}
for f in ['videos.json','page4.json']:
    for v in json.load(open(f)): meta[v['id']]=v
for f in sorted(glob.glob(D+'mcp-Treg-call-*.txt')):
    try:
        b=json.load(open(f)).get('body',{})
        for v in b.get('videos',[]): meta.setdefault(v['id'],v)
    except Exception: pass
got={}
for f in glob.glob(D+'*'):
    try: d=json.loads(open(f).read())
    except Exception: continue
    if isinstance(d,list): d=json.loads(d[0]['text'])
    b=d.get('body',{})
    if b.get('transcript'):
        got[b.get('videoId') or re.search(r'v=([\w-]{11})',b['url']).group(1)]=b
print(len(got), [i for i in got if i not in meta])
nows=lambda s:re.sub(r'\s+','',s)
def fix(b):
    segs=b['transcript']; full=b.get('transcript_only_text') or ''
    comp=[];idx=[]
    for i,c in enumerate(full):
        if not c.isspace(): comp.append(c); idx.append(i)
    comp=''.join(comp); p=0; out=[]; ok=True
    for s in segs:
        t=nows(s['text']); n=len(t)
        if comp[p:p+n]==t and n:
            a=idx[p]; e=idx[p+n-1]+1
            txt=re.sub(r'\s+',' ',full[a:e]).strip(); p+=n
        else:
            ok=False; txt=re.sub(r'\s+',' ',s['text']).strip()
        out.append([int(s['startMs'])//1000,txt])
    return out,ok
os.makedirs('/mnt/user-data/outputs/km',exist_ok=True)
rows=[];bad=0
with open(OUT+'/transcripts.jsonl','w') as fo:
    for vid,b in got.items():
        m=meta[vid]; segs,ok=fix(b); bad+=not ok
        rec=dict(id=vid,title=m['title'],published=(m.get('publishDate') or m.get('publishedTime') or '')[:10],url=m['url'],duration_s=m['lengthSeconds'],views=m['viewCountInt'],likes=m.get('likeCountInt'),comments=m.get('commentCountInt'),language=b.get('language'),segments=segs)
        fo.write(json.dumps(rec,ensure_ascii=False)+'\n')
        rows.append([vid,rec['published'],rec['title'],rec['url'],rec['duration_s'],rec['views'],rec['likes'],rec['comments'],sum(len(s[1].split()) for s in segs)])
rows.sort(key=lambda r:r[1],reverse=True)
with open(OUT+'/videos.csv','w',newline='') as f:
    w=csv.writer(f); w.writerow(['id','published','title','url','duration_s','views','likes','comments','transcript_words']); w.writerows(rows)
print('videos',len(rows),'alignment fallbacks',bad)
print('date range',rows[-1][1],rows[0][1],'words',sum(r[8] for r in rows),'hours',round(sum(r[4] for r in rows)/3600,1))
print(os.path.getsize(OUT+'/transcripts.jsonl'))
print(open(OUT+'/transcripts.jsonl').readline()[:600])
