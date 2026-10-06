import json,sys,collections,os
R=sys.argv[1:] or ['r1','r2']
def load(r,p,s):
    d=f'{r}/pass{p}/{s}'
    return json.load(open(d+'/context.json')),json.load(open(d+'/report.json')),open(d+'/artifact.txt').read()
srcs=['slotted','identity','rooms','shared','availability','calendar','booking']
for r in R:
  print('=====',r)
  for p in (1,2):
    for s in srcs:
      c,rep,art=load(r,p,s)
      own=[u for u in c['units'] if u['facet'].startswith(f'facet:{s}.sigil:')]
      cov=collections.Counter(u['coverage'] for u in own)
      claims={}
      for u in own:
        for a in u['asserted']: claims[a['claim']]=u['facet']
      kinds=collections.Counter(a['body']['kind'] for u in own for a in u['asserted'])
      rows=collections.Counter(l.split()[0].strip('(') for l in art.splitlines() if l.startswith('('))
      fc=collections.Counter((f['class'],f['law']) for f in rep['findings'])
      print(f'{p} {s:12} {rep["state"]:9} ownFacets={len(own):3} cov={dict(cov)} bodies={dict(kinds)} rows={dict(rows)}')
