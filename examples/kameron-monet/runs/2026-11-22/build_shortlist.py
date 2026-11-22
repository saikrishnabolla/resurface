import json,re,html
recs={r['id']:r for r in json.load(open('recs.json'))}
S=[
dict(t="Anthropic lists in the biggest IPO on record",d="Thu 19 Nov",tag="breaking",post="by Tue 24 Nov",ty="safe",sc=[5,4,4,5,4,4],
 w="The Claude maker began trading on Nasdaq at roughly a $1.8tn value, then led an AI sell-off that pushed US indexes into correction.",
 src=[["CNBC","https://www.cnbc.com/2026/11/19/anthropic-ipo-ant-live-updates.html"],["AP","https://apnews.com/article/anthropic-history-openai-dario-amodei-ipo-53fb21bd250b936d93c5c8885af8d393"],["CNN","https://www.cnn.com/2026/11/18/investing/anthropic-ipo-wall-street-ai"]],
 flag="Her 19 Aug 2026 video carries a paid Claude Cowork segment, so use the unsponsored clips or disclose. The first clip is about ChatGPT, not Claude: keep the hook about AI in general.",
 c=[("2VQPQUigoUU",836,"Juxtaposition","Wall Street loves AI. Would you let it read your contract?","without using like a ChatGPT"),
    ("cUCiTNo-pTY",2485,"Principle","Worth trillions. Still can't tell you what to ask.","you don't really know what you don't know"),
    ("qazLmqYXljM",938,"Direct","She uses Claude. Here's where she stops trusting it.","searching now with like ChatGPT and Claude"),
    ("qazLmqYXljM",300,"Line","Everyone has the same AI. So what's left?","when you think of ChatGPT"),
    ("YgqvwssPhXo",165,"Principle","AI is not your replacement. It's your first draft.","it's not a replacement"),
    ("3rUTpwkprtw",1579,"Receipt","January 2025: already paying for AI as a business cost.","I pay for"),
    ("ulVWANmJiG0",2,"Line","A founder's view from inside the AI boom.","If you're building an AI")]),
dict(t="Manhattan's median rent hits a record $5,375",d="report out mid Nov, housing plan Wed 18 Nov",tag="rising",post="any day this week",ty="safe",sc=[5,4,4,4,5,4],
 w="Realtor.com's third-quarter data put Manhattan asking rents up 8.3% and the citywide median at a record $3,785, days before the mayor and governor announced a $22bn housing package.",
 src=[["Commercial Observer","https://commercialobserver.com/2026/11/new-york-city-apartment-rents-record-highs/"],["Hoodline","https://hoodline.com/2026/11/mamdani-and-hochul-unveil-nyc-housing-push-as-rents-overcrowding-keep-climbing/"]],
 flag="The first clip is her own budget range before she moved, not a market figure. Show both numbers with their dates.",
 c=[("srSZRZQXOgE",1632,"Number","In 2023 she called $3,000 crazy. Manhattan is now $5,375.","rent being $2,000"),
    ("AMiya40QJ2c",454,"Emotion","The prayer every New York renter knows.","Mind you, I pay over"),
    ("srSZRZQXOgE",115,"Explainer","Before the rent, there's the broker's fee.","pay this large broker"),
    ("41GhF2IIKVM",2118,"Line","One month in: where the money actually goes.","rent is eating up"),
    ("LgnXenZ4fJk",262,"Explainer","The lease came back higher than the listing.","the rent price is higher"),
    ("NpGbTsrBwpg",1335,"Emotion","What a New York studio looks like at these prices.","there were some that I saw")]),
dict(t="Law school acceptance falls to a 20-year low",d="Thu 19 Nov",tag="rising",post="by Fri 27 Nov",ty="safe",sc=[5,4,4,3,5,5],
 w="AccessLex's annual data shows 65% of applicants got an offer, and 41% of Black applicants against about three quarters of white applicants.",
 src=[["Inside Higher Ed","https://www.insidehighered.com/news/admissions/graduate/2026/11/20/latest-law-school-data-shows-20-year-low-acceptance-rate"],["AccessLex release","https://www.prnewswire.com/news-releases/legal-education-data-deck-highlights-trends-in-law-school-admissions-and-bar-passage-302944233.html"]],
 flag="Her 5% figure is said from memory at a live event. Check it against a current source before putting it on screen.",
 c=[("cUCiTNo-pTY",1898,"Number","41% get in. Here's the number at the other end.","only 5% of lawyers"),
    ("LsuG6z8QNe4",925,"Answer","Can you still get in with a low LSAT? She did.","it was lower than a 160"),
    ("GVraVDw4M2Y",635,"Story","Gap year, second LSAT, then law school.","took the LSAT did much better"),
    ("5cQmG8IMKgU",1825,"Emotion","For the applicant who can't afford the test.","scared to go to law school"),
    ("LsuG6z8QNe4",647,"Advice","When to sit the LSAT so the score lasts.","can hold for five years"),
    ("eg9c5wtJHfI",253,"Answer","2018: the admissions questions she got most.","the law school admissions test")]),
dict(t="David Beckham sues Coty for $41m over discount-bin fragrances",d="reported Tue 17 Nov",tag="rising",post="by Wed 25 Nov",ty="swing",sc=[4,4,4,4,5,5],
 w="His company says its licensing deal was breached when Beckham-branded products turned up in a petrol station bargain bin and at Poundland. Coty wants the case dismissed.",
 src=[["CNA / AP","https://cnalifestyle.channelnewsasia.com/style-beauty/david-beckham-sues-fragrance-discount-store-bargain-bin-591911"],["Nine","https://www.nine.com.au/entertainment/celebrity/david-beckham-company-sues-61-million-luxury-fragrances-allegedly-sold-in-bargain-bin-20261121-p61fu5.html"]],
 flag="A live lawsuit: describe it as alleged, and keep her clip as general advice, not comment on the case.",
 c=[("NpteP3EQP2I",395,"Principle","Beckham's $41m problem, explained in one rule.","make sure that what's in the contract"),
    ("a4gIfBSujK0",804,"Principle","Once your name is out there, can you track it?","how do I protect my clients"),
    ("VTN_EVUdf30",532,"Explainer","Watch a lawyer hit the word 'perpetuity' live.","they put in perpetuity"),
    ("wZzsdPM_x28",2407,"Line","Five words every licensing dispute starts with.","Did you read it?"),
    ("ulVWANmJiG0",1104,"Explainer","Signing is the start. Tracking the terms is the job.","tracking your usage rights"),
    ("5cQmG8IMKgU",1099,"Advice","Her own costly mistake: trademarks came too late.","not prioritizing trademarks")]),
dict(t="Model sues a clothing brand for turning 2021 photos into AI ads",d="filed Wed 18 Nov",tag="breaking",post="by Wed 25 Nov",ty="safe",sc=[5,4,5,2,4,5],
 w="A Los Angeles model says he was paid in clothes, signed no release, and later found AI-made images and video of himself in the brand's social ads.",
 src=[["PPC Land","https://ppc.land/model-sues-romperjack-after-2021-photos-became-ai-generated-instagram-ads/"]],
 flag="Only one outlet found so far, though it cites the federal case number. Confirm against the court filing before posting.",
 c=[("cUCiTNo-pTY",2603,"Story","His face is in the ads. Her client's was on a billboard.","she saw her face on a billboard"),
    ("qazLmqYXljM",2054,"Explainer","'Perpetuity' means forever. Including for AI.","understand what perpetuity meant"),
    ("apJ1nUZVWbg",337,"Explainer","What you sign away when you sign a release.","they automatically kind of get rights"),
    ("apJ1nUZVWbg",1840,"Line","Her warning to creators, in six words.","they will play in your face"),
    ("cSuH88mDAFs",447,"Story","Locked in for three years by a deal they didn't read.","signed with a terrible talent manager")]),
dict(t="Serena Williams launches a $200m venture fund",d="Tue 17 Nov",tag="breaking",post="by Wed 25 Nov",ty="swing",sc=[4,4,4,3,4,5],
 w="Starfire Ventures will back seed and Series A companies. Coverage repeats the figure that women-only founding teams get about 1% of US venture money.",
 src=[["AfroTech","https://afrotech.com/serena-williams-and-beth-ferreira-launch-starfire-ventures"],["ThePrint","https://theprint.in/feature/serena-williams-vc-empire-raise-200-million-startups/3100740/"]],
 flag="Don't imply she is pitching or has approached the fund.",
 c=[("PUDZg7ci43I",0,"Emotion","Serena is raising $200m. This is who it's for.","No investors yet"),
    ("vOKBxcD0-Uk",1690,"Answer","Why a founder might not take the money yet.","I am technically not actively fundraising"),
    ("PUDZg7ci43I",747,"Principle","Audience first, investors second.","Not against angel investors"),
    ("ln2JPXuCceE",870,"Story","A lawyer learns venture capital from scratch.","venture capital angel investors"),
    ("G7i-OYngjcE",1009,"Story","Fresh from the pitch, hoping to close the round.","hopefully we can secure some funding"),
    ("VcHORetOqVo",819,"Emotion","What women founders say they need besides money.","female founder community"),
    ("AMiya40QJ2c",852,"Advice","The book an investor told her to read.","had an investor suggest")]),
dict(t="An AI law firm raises $20m to replace the traditional firm",d="Mon 16 Nov",tag="steady",post="by Wed 25 Nov",ty="safe",sc=[4,3,4,2,3,5],
 w="London start-up Alecto runs its own regulated firm with lawyers plus AI on fixed fees, backed by Insight Partners and a law firm investor.",
 src=[["Axios","https://www.axios.com/pro/all-deals/2026/11/16/ai-native-law-firm-alecto-20m"],["Law.com","https://www.law.com/legaltechnews/2026/11/17/ai-powered-conveyancing-provider-alecto-raises-20m-in-seed-round-/"]],
 flag="She runs a legal tech company herself, so this reads as her market. Avoid sounding like a competitor comment.",
 c=[("G7i-OYngjcE",3736,"Principle","Investors just bet $20m on this exact question.","I don't have $500 per hour"),
    ("cSuH88mDAFs",447,"Juxtaposition","Lawyers cost too much. And AI alone isn't the fix.","lawyers are expensive"),
    ("2VQPQUigoUU",221,"Principle","Legal tech was built for firms, not for you.","traditional legal tech companies"),
    ("FuNrs1pv1Hg",2041,"Story","The moment a lawyer asked the obvious question.","Why am I not using tech"),
    ("G7i-OYngjcE",1026,"Line","Her one-line case for cheaper law.","law should be accessible")]),
dict(t="Student loan borrowers hit billing errors as oversight ramps up",d="Tue 17 Nov",tag="steady",post="within two weeks",ty="safe",sc=[4,3,4,3,3,4],
 w="Borrowers report wrong bills and stalled relief after July's repayment overhaul, and newly elected Democrats plan to investigate. Pete Buttigieg said his party overreached on forgiveness.",
 src=[["Business Insider","https://www.businessinsider.com/new-era-student-loan-borrowers-oversight-repayment-protections-democrats-midterms-2026-11"],["Newsweek","https://www.newsweek.com/democrats-student-loan-forgiveness-pete-buttigieg-12722353"]],
 flag="Politically charged. Keep the hook on the borrower's experience, not on a party.",
 c=[("u0_qXi6ocAw",1477,"Emotion","What nobody explained before she signed.","the extent of what student loans"),
    ("GVraVDw4M2Y",909,"Story","In the financial aid office, asking for more.","ask for additional student loans"),
    ("ln2JPXuCceE",2328,"Juxtaposition","And yet she says the debt was worth it.","well worth the investment"),
    ("bTrggn9UY94",2709,"Emotion","The dream year, in one sentence.","I pay off all my student loans"),
    ("3rUTpwkprtw",147,"Story","A lawyer's balance sheet, said out loud.","my main debt is student loans"),
    ("u0_qXi6ocAw",1666,"Advice","Her plan for cleaning it up.","I need to pay off my credit cards")]),
dict(t="Thanksgiving travel: 81.5 million on the move, airfares up 17%",d="forecast Mon 16 Nov, travel from Tue 24 Nov",tag="calendar",post="Tue 24 to Sun 29 Nov",ty="swing",sc=[4,3,3,4,4,3],
 w="AAA expects near-record crowds with the average domestic return flight at $800, and TSA expects its busiest day on Sunday 29 November.",
 src=[["USA Today","https://www.usatoday.com/story/travel/2026/11/16/thanksgiving-travel-best-worst-times/92760384007/"],["NewsNation","https://www.newsnationnow.com/travel/thanksgiving-travel-road-airport/"]],
 flag="None of these clips are from a Thanksgiving trip except the second and last. Label the recording dates clearly.",
 c=[("RlYNzXvhkkc",134,"Emotion","81.5 million travelling. One of them will be her.","I missed the first flight"),
    ("D1w9ch633o4",333,"Echo","Her own Thanksgiving week, city by city.","Detroit and Atlanta for Thanksgiving"),
    ("N1nPVxuNF-Q",32,"Advice","The one thing that got her through security fast.","i have tsa pre-check"),
    ("SrfKyvpu-20",1461,"Advice","Her airport rule for a calm travel day.","getting to the airport really early"),
    ("kIPiTUDEQIM",406,"Emotion","What a delay does to a person.","the delay"),
    ("RlYNzXvhkkc",2715,"Emotion","The sentence every stranded traveller says.","I just want to go home"),
    ("MW2EDha-Eow",1523,"Echo","Thanksgiving 2023, on her own.","Happy Thanksgiving")]),
dict(t="Black Friday forecast: a record $12.9bn online",d="Fri 27 Nov",tag="calendar",post="Thu 26 or Fri 27 Nov",ty="safe",sc=[4,3,3,4,3,3],
 w="Adobe expects online spending up 9.2% on the day, with buy now, pay later use rising and most shoppers saying the economy will shape what they spend.",
 src=[["Bloomberg Intelligence","https://www.bloomberg.com/professional/insights/markets/five-charts-for-black-friday-most-wanted-gifts-retail-winners-and-more/"],["Globe and Mail / Reuters","https://www.theglobeandmail.com/business/article-wall-streets-week-ahead-black-friday-brings-consumer-spending-into/"]],
 flag="Thin match: she talks about budgets and credit cards, not about Black Friday itself, apart from one unboxing.",
 c=[("ln2JPXuCceE",2075,"Juxtaposition","A record spending day. Her 2026 money rule.","no more personal loans or maxed out credit cards"),
    ("4k_1aFvufXg",941,"Echo","Her Black Friday orders arrive, December 2023.","ordered from Black Friday"),
    ("Kteo9J3_qOw",762,"Receipt","She marked her own budgeting: about 60%.","create a budget and stick to it"),
    ("5cQmG8IMKgU",2615,"Advice","Her order of operations for spending.","make the money first")]),
]
norm=lambda s:re.sub(r'\s+',' ',s)
bad=0
for s in S:
    out=[]
    for vid,t,lens,bridge,anchor in s['c']:
        r=recs[vid]; segs=r['segments']
        idx=[i for i,x in enumerate(segs) if t-100<=x[0]<=t+110]
        text='';pos=[]
        for i in idx: pos.append((len(text),i)); text+=segs[i][1]+' '
        m=re.search(re.escape(anchor).replace(r'\ ',r'\s+'),text,re.I)
        if not m: bad+=1; print('MISS',vid,t,anchor); q='';st=t
        else:
            si=[i for p,i in pos if p<=m.start()][-1]; st=max(0,segs[si][0]-2)
            q=' '.join(norm(text[m.start():]).split()[:12]).rstrip(',')
        out.append(dict(v=vid,s=st,l=lens,b=bridge,q=q,t=r['title'],d=r['published']))
    s['c']=out; s['tot']=s['sc'][0]*2+s['sc'][1]*2+sum(s['sc'][2:])
S.sort(key=lambda s:(-s['tot'],-s['sc'][3]))
for i,s in enumerate(S): s['r']=i+1
json.dump(S,open('run/shortlist.json','w'),ensure_ascii=False,indent=1)
print('misses',bad,[ (s['r'],s['tot'],len(s['c'])) for s in S], sum(len(s['c']) for s in S))
