#!/usr/bin/env python3
"""Build per-creator topic webs ("creator brains") from a CSV of video titles/captions.

Input CSV columns: creator, platform, url, title, views  (extra columns ignored).
Output: <out>/index.html + persona.json (all creators, one tab each) and, with --split,
<out>/<slug>/index.html + persona.json per creator.

  python3 build_brain.py --csv ../data/videos.csv --out ../site --split \
      --full "Kameron Buckner,Sharon Jacob,Keta Bag"

Topics = words/bigrams from each creator's own titles. Edges = topics that appear in the
same video. Themes = network communities (greedy modularity). --full shows every topic for
the named creators (top 3 neighbours per topic kept so the graph stays readable); everyone
else gets their top --top topics used in 2+ videos.
"""
import csv,re,collections,json,itertools,argparse,os,pathlib
import networkx as nx
from networkx.algorithms.community import greedy_modularity_communities

STOP=set("""the a an and to of in for is on my you your i it this with what that be are me at how we do so from it's not just but have can all our if or by as was get they like out up about who more one when new will there day here i'm don't its im
these those could would should which where being been has had their them then than into over after before very really much many some any every each other also too only even still now just ever never always back down off again why because while make made makes making know think want need let see look going go got gets give take took come came said say says thing things way ways something everything nothing anything someone people lot lots little big best better good great right first last next year years week weeks time times today yeah yes okay ok guys girl girls her his him she he us did does doing done been being comment link bio full video watch channel follow subscribe part here's that's what's you're we're they're i've i'll can't didn't isn't doesn't wasn't won't let's who's there's
fyp foryou foryoupage foryourpage fypviral viral reels reel shorts short tiktok capcut trending explore instagram youtube 2023 2024 2025 2026 via amp one two three four five deserves hour buying started starting real yourself bet live moment old world city don feel instead head room most didnt replying officially obsessed fan different thank care life fypシ einhorn gabe show love lol omg wait trying happy start keep place suck american express beginner გ როგორ მეტი სულ აგვისტო ტაშ ever full actually spot told exactly talk between become everyone kameron fave tang send use tell try top rules fast current connection""".split())
NORM={'apartments':'apartment','creators':'creator','contracts':'contract','clauses':'clause','founders':'founder','cards':'credit card','banks':'bank','investing':'invest','investment':'invest','models':'model','startups':'startup','lawyers':'lawyer','deals':'deal','brands':'brand','nyc':'NYC','newyork':'NYC','york':'NYC','yorkers':'NYC','socialdocket':'Social Docket','docket':'Social Docket','mynessoo':'Nessoo','nessoo':'Nessoo','roth':'Roth IRA','ira':'Roth IRA','hysa':'HYSA','ai':'AI','claudeai':'Claude','apple':'Apple','spy':'SPY','jewish':'Jewish','israel':'Israel','god':'God','shabbat':'Shabbat','olaplex':'Olaplex','ნიუ':'NYC','იორკული':'NYC','იორკში':'NYC','პროსტა':'vlog','ვლოგი':'vlog','დღიურები':'diaries','ფანდურში':'Panduri','ემიგრანტები':'emigrants','უფასოა':'free events','დასწრება':'free events','easterneuropean':'Eastern European','eastern':'Eastern European','realestate':'real estate','nycapartment':'apartment','apartmenttour':'apartment tour','thedigitalbuff':'The Digital Buff','modeling':'model','ghanatiktok':'Ghana','naijatiktok':'Nigeria','blackhair':'hair','buff':'The Digital Buff','clan':'Wu-Tang','personalfinance':'personal finance','contentcreator':'content creator'}
BI={'new yorkers':'NYC','new york':'NYC','credit card':'credit card','day in my life':'day in my life','real estate':'real estate','brand deals':'brand deal','brand deal':'brand deal','content creator':'content creator','creator economy':'creator economy','tech founder':'tech founder','female founder':'female founder','usage rights':'usage rights','net worth':'net worth','high yield':'HYSA','social docket':'Social Docket','shabbat shalom':'Shabbat','eastern european':'Eastern European','law school':'law school','personal brand':'personal brand','product manager':'product manager','legal education':'legal education','mental health':'mental health'}
def terms(t):
    s=re.sub(r'http\S+|@\w+','',t.lower())
    s=s.replace('#',' ')
    out=set()
    for k,v in BI.items():
        if k in s: out.add(v); s=s.replace(k,' ')
    for w in re.findall(r"[^\W\d_][\w']+",s):
        w=w.strip("'")
        if len(w)<3 or w in STOP: continue
        w=NORM.get(w,w)
        if w.endswith("'s"): w=w[:-2]
        out.add(w)
    return out

def build(rows, full, top_n):
    out={}
    for c in sorted(set(r['c'] for r in rows)):
        R=[r for r in rows if r['c']==c]
        for r in R: r['terms']=terms(r['t'])
        df=collections.Counter(w for r in R for w in r['terms'])
        FULL=c in full
        top=[w for w,n in df.most_common()][:900] if FULL else [w for w,n in df.most_common(top_n+15) if n>=2][:top_n]
        S=set(top); co=collections.Counter()
        for r in R:
            for a,b in itertools.combinations(sorted(r['terms']&S),2): co[(a,b)]+=1
        G=nx.Graph(); G.add_nodes_from(top)
        if FULL:
            nb=collections.defaultdict(list)
            for (a,b),n in co.items(): nb[a].append((n+df[b]/1000,b,n)); nb[b].append((n+df[a]/1000,a,n))
            for a,l in nb.items():
                for _,b,n in sorted(l,reverse=True)[:3]: G.add_edge(a,b,weight=n)
        else:
            for (a,b),n in co.items():
                if n>=2 or len(R)<60: G.add_edge(a,b,weight=n)
        comms=list(greedy_modularity_communities(G,weight='weight',resolution=1.0 if FULL else 1.6)) if G.number_of_edges() else [set(top)]
        big=[cm for cm in comms if len(cm)>1]; small=set().union(*[cm for cm in comms if len(cm)==1]) if any(len(cm)==1 for cm in comms) else set()
        comms=sorted(big,key=lambda cm:-sum(df[w] for w in cm))+([small] if small else [])
        gid={w:i for i,cm in enumerate(comms) for w in cm}
        groups=[sorted(cm,key=lambda w:-df[w])[:3] for cm in comms]; other=len(comms)-1 if small else None
        ex={w:[dict(t=r['t'][:120],v=r['v'],u=r['u'],p=r['p']) for r in sorted([r for r in R if w in r['terms']],key=lambda r:-r['v'])[:(4 if df[w]>1 else 1)]] for w in top}
        out[c]=dict(videos=len(R),nodes=[dict(id=w,n=df[w],g=gid[w]) for w in top],edges=[dict(a=a,b=b,n=G[a][b]['weight']) for a,b in G.edges()],groups=groups,other=other,ex=ex)
        print(c,len(R),'videos,',len(top),'topics |',' / '.join(', '.join(g) for g in groups))
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--csv',required=True,nargs='+')
    ap.add_argument('--out',required=True)
    ap.add_argument('--full',default='',help='comma-separated creators to show every topic for')
    ap.add_argument('--top',type=int,default=45)
    ap.add_argument('--split',action='store_true',help='also write one standalone page per creator')
    ap.add_argument('--only',default='',help='comma-separated creators to include')
    a=ap.parse_args()
    rows=[]
    for p in a.csv:
        for r in csv.DictReader(open(p,encoding='utf-8')):
            rows.append(dict(c=r['creator'],t=r.get('title') or '',v=int(float(r.get('views') or 0)),u=r.get('url',''),p=r.get('platform','')))
    if a.only: keep=set(x.strip() for x in a.only.split(',')); rows=[r for r in rows if r['c'] in keep]
    full=set(x.strip() for x in a.full.split(',') if x.strip())
    data=build(rows,full,a.top)
    tpl=(pathlib.Path(__file__).parent/'template.html').read_text()
    def write(d,folder,title):
        os.makedirs(folder,exist_ok=True)
        json.dump(d,open(os.path.join(folder,'persona.json'),'w'),ensure_ascii=False)
        open(os.path.join(folder,'index.html'),'w').write(tpl.replace('__DATA__','null').replace('<title>Creator Brains</title>',f'<title>{title}</title>'))
    write(data,a.out,'Creator Brains')
    if a.split:
        for c,d in data.items(): write({c:d},os.path.join(a.out,c.split()[0].lower()),f'{c} · Topic Brain')
    print('wrote',a.out)

if __name__=='__main__': main()
