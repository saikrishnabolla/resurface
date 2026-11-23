import json,re,sys,collections
from match import music_flags
recs=json.load(open('recs.json'))
Q={
'S1':[('claude|anthropic',4),(r'\bAI\b',1),(r'chat ?gpt|chad ?g',2),(r'\bIPO\b|go(ing|es)? public|valuation|stock market|\bstocks?\b',3),(r'AI[- ]powered|building (an|with) AI|use AI|using AI',2),(r'replace',1),(r'trillion|billion',2),(r'bubble|hype',3)],
'S2':[(r'licens',3),(r'usage rights',3),(r'exclusiv',2),(r'perpetuity',3),(r'trademark',2),(r'breach',3),(r'protect (your|my|the) (brand|name)',3),(r'likeness',3),(r'cheap|discount|devalu|reputation',1),(r'where (it|your content|they) (is|will be|can be|are) (used|shown|posted|sold)',3),(r'read (the|your) contract|fine print',2),(r'whitelist',2),(r'terminat',2)],
'S3':[(r'likeness|your (face|image)',3),(r'perpetuity|forever',3),(r'usage rights',3),(r'paid in|free product|for free|exposure|gifted',2),(r'\brelease\b',2),(r'in writing|signed?\b',1),(r'\bAI\b',1),(r'\bads?\b|paid ads|whitelist',2),(r'own (the|your) content|owns? (it|the)',3),(r'model',1),(r'photo ?shoot|photos',1)],
'S4':[(r'legal tech|legal infrastructure|modern legal',3),(r'replace (lawyers|attorneys|a lawyer)',4),(r'traditional law',3),(r'billable|hourly rate|flat fee|per hour',3),(r'access to legal|affordable|accessible',2),(r'\bAI\b',1),(r'law firms?',1),(r'expensive|afford (a|an) (lawyer|attorney)',2),(r'seed|raised?',1)],
'S5':[(r'law school',1),(r'appl(y|ied|ication)|accept|admission|got in|reject|wait ?list',2),(r'\bLSAT\b',3),(r'personal statement',3),(r'is law school|should (you|i) go',3),(r'black (law )?(students?|lawyers?|attorneys?|women)|only black|percent',3),(r'\bGPA\b|score',2)],
'S6':[(r'student loans?',4),(r'\bdebt\b',2),(r'scholarship',2),(r'forgiveness|forgiven',3),(r'pay(ing)? (for|off)',1),(r'interest',1),(r'borrow',2),(r'tuition',2),(r'loans?\b',1)],
'S7':[(r'(?<!\w)rent\b(?! the runway)',2),(r"broker'?s? fee",4),(r'apartment',1),(r'expensive|afford',1),(r'\$\s?\d,?\d{3}|thousand',1),(r'\blease\b',2),(r'stabiliz|rent control',4),(r'40 ?x|forty times|income requirement|guarantor',4),(r'cost of living',3),(r'landlord',2),(r'studio',1)],
'S8':[(r'thanksgiving',4),(r'airport',2),(r'flights?\b',1),(r'delay|cancel',2),(r'\bTSA\b|pre-?check|security line',3),(r'lounge',2),(r'holiday travel|travel(l)?ing (home|for)|going home',3),(r'ticket|expensive',1),(r'layover|missed',2)],
'S9':[(r'black friday|cyber monday',5),(r'\bon sale\b|\bsales?\b',1),(r'discount|deals?\b',1),(r'budget',2),(r'impulse|overspen|spend(ing)? (too|so) much',3),(r'buy now pay later|afterpay|klarna|affirm',4),(r'credit cards?',2),(r'holiday shopping|christmas (shopping|gifts?)|gift',2),(r"don'?t need",2),(r'wish ?list|cart',1)],
'S10':[(r'serena',5),(r'investors?',2),(r'fundrais',3),(r'venture|\bVCs?\b',3),(r'(women|female|black) founders?',4),(r'percent',1),(r'rais(e|ed|ing) (money|capital|a round|funding)',3),(r'pitch',1),(r'angel',2),(r'check',1)],
'S11':[(r'outage|went down|is down|crash(ed|ing)?',3),(r'back ?(ed)? ?up|backup',2),(r'wi-?fi|internet',1),(r'lost (all|everything|my|the)',2),(r'memory card|hard drive',1),(r'\bChase\b',2),(r'locked out|password|lastpass',2),(r'rely(ing)? on|depend',2),(r'hacked',3),(r'glitch|technical difficult',3),(r"(not|isn't|won't) (working|loading)",2),(r'deleted',2)],
'S12':[(r'disney|hulu|netflix',2),(r'tik ?tok',1),(r'adsense|monetiz|partner program',3),(r'algorithm',2),(r'short[- ]form|long[- ]form',2),(r"don't rely|diversif|own your|email list|newsletter",3),(r'platform',1),(r'youtube (pays?|money|check)',3),(r'creator fund',3)],
'S13':[(r'lay ?offs?|laid off',5),(r'fired|let go',2),(r'job security|secure',2),(r'\bquit',1),(r'9[- ]?to[- ]?5|corporate',1),(r'plan b|backup plan|safety net|emergency fund',3),(r'multiple streams|side hustle',2),(r'recession|economy',3),(r'replace',1)],
'S14':[(r'\b1099',5),(r'\btax(es)?\b',1),(r'write[- ]offs?|deduct',2),(r'\bW-?9\b',3),(r'accountant|\bCPA\b',2),(r'quarterly',3),(r'self[- ]employ',2),(r'invoice',1),(r'\$?600\b',3)],
}
want=sys.argv[1:] or list(Q)
N=int(7)
for sid in want:
    qs=[(re.compile(p,re.I),w) for p,w in Q[sid]]
    cands=[]
    for r in recs:
        segs=r['segments']; fl=music_flags(segs); n=len(segs); i=0
        while i<n:
            j=i; t0=segs[i][0]; txt=[]
            while j<n and segs[j][0]-t0<40:
                if not fl[j]: txt.append(segs[j][1])
                j+=1
            s=' '.join(txt)
            sc=sum(w for q,w in qs if q.search(s)); nq=sum(1 for q,w in qs if q.search(s))
            if nq>=2: cands.append((sc+nq*.5,r['id'],r['published'],r['title'],t0,s))
            i=max(i+1,i+(j-i)//2)
    cands.sort(reverse=True); out=[];per=collections.Counter()
    for c in cands:
        if per[c[1]]>=2: continue
        if any(o[1]==c[1] and abs(o[4]-c[4])<60 for o in out): continue
        out.append(c); per[c[1]]+=1
        if len(out)>=N: break
    print('#####',sid)
    for sc,vid,d,t,t0,s in out:
        w=s.split(); print(f"[{sc:.0f}] {vid} {d} {t0//60}:{t0%60:02d} | {t[:38]} | {' '.join(w[:62])}")
