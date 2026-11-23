import json,re,collections,sys
recs=json.load(open('recs.json'))
def parse():
    terms=[];kind=grp=None
    for ln in open('lex.txt'):
        ln=ln.rstrip('\n')
        if not ln.strip(): continue
        if ln.startswith('@'):
            kind,grp=[x.strip() for x in ln[1:].split('|')]; continue
        cs=ln.startswith('!'); ln=ln.lstrip('!')
        if ' = ' in ln: label,rx=ln.split(' = ',1)
        else:
            label=ln; rx=r'(?<![\w])'+re.escape(label).replace(r'\ ',r'\s+')+r"(?![\w])"
        try: c=re.compile(rx,0 if cs else re.I)
        except re.error as e: print('BAD',label,rx,e); continue
        terms.append(dict(label=label.strip(),kind=kind,group=grp,rx=c,cs=cs))
    return terms
JINGLE=re.compile(r"city\s*of\s*(mine|my|i\b|m\b|how|you)|how i love|gets? me\s*down|born in the city|raised on\s*its edges|golden gate|fog 24|live here forever|met all my best|thank every|born to sing|foresight to believe|charging forward|move backwards|open my mouth|its edges|pop\w* is life|popor|when it'?s? comp|bad days thank",re.I)
def music_flags(segs):
    n=len(segs); fl=[False]*n
    toks=[re.findall(r"[a-z']+",s[1].lower()) for s in segs]
    for i in range(n):
        if JINGLE.search(segs[i][1]):
            for j in range(max(0,i-1),min(n,i+2)): fl[j]=True
    W=8
    for i in range(0,n):
        w=[t for k in range(i,min(n,i+W)) for t in toks[k]]
        if len(w)<40: continue
        tg=collections.Counter(zip(w,w[1:],w[2:]))
        tot=sum(tg.values()); rep=sum(v for v in tg.values() if v>1)
        if rep/tot>0.40:
            for k in range(i,min(n,i+W)): fl[k]=True
    return fl
if __name__=='__main__':
    terms=parse(); print(len(terms),'terms')
    hits=collections.defaultdict(list); flagged=tot=0; samp=[]
    for r in recs:
        segs=r['segments']; fl=music_flags(segs); flagged+=sum(fl); tot+=len(segs)
        if len(samp)<6:
            run=[s[1] for s,f in zip(segs,fl) if f and not JINGLE.search(s[1])]
            if run: samp.append(r['id']+': '+' / '.join(run[:6])[:300])
        pos=[];buf=[];p=0
        for i,s in enumerate(segs):
            pos.append(p); buf.append(s[1]); p+=len(s[1])+1
        text=' '.join(buf)
        import bisect
        for ti,t in enumerate(terms):
            seen=set()
            for m in t['rx'].finditer(text):
                si=bisect.bisect_right(pos,m.start())-1
                if fl[si] or si in seen: continue
                seen.add(si); hits[ti].append((r['id'],si,m.start()-pos[si],m.end()-pos[si]))
    print('music-flagged segments',flagged,'of',tot)
    print('\n'.join(samp))
    out=[]
    for ti,t in enumerate(terms):
        h=hits.get(ti,[]); out.append((t['kind'],t['group'],t['label'],len(h),len({x[0] for x in h})))
    json.dump({'terms':[{k:v for k,v in t.items() if k!='rx'} for t in terms],'hits':{str(k):v for k,v in hits.items()}},open('hits.json','w'))
    zero=[o[2] for o in out if o[3]==0]
    print('zero-hit terms',len(zero)); 
    cur=None
    for o in out:
        if o[3]==0: continue
        if (o[0],o[1])!=cur: cur=(o[0],o[1]); print('\n##',o[0],o[1],end=': ')
        print(f"{o[2]} {o[4]}/{o[3]}",end='; ')
