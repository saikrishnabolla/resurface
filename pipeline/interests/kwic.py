import json,sys,re
d=json.load(open('hits.json')); recs={r['id']:r for r in json.load(open('recs.json'))}
want=sys.argv[1:]
for i,t in enumerate(d['terms']):
    if t['label'] in want:
        hs=d['hits'].get(str(i),[])
        print('##',t['label'],len(hs))
        for vid,si,a,b in hs[:int(6)]:
            s=recs[vid]['segments'][si][1]; print('   ',s[max(0,a-45):b+35].replace('\n',' '))
