import csv,glob,zipfile,io,math,collections,statistics as S,json
PX='px/'; DAT='/home/user/reddit/data/coinversa/'
H=3600000
def klines(sym):
    o={}
    for f in sorted(glob.glob(f'{PX}{sym}_*.zip')):
        z=zipfile.ZipFile(f); 
        for r in csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]))):
            if r and r[0].isdigit(): o[int(r[0])]=(float(r[1]),float(r[4]))
    return o
def bias(coin):
    d=collections.defaultdict(dict)
    for r in csv.DictReader(open(f'{DAT}cohort_bias_1h_{coin}.csv')): d[int(r['snapshot_ms'])][r['tier_slug']]=float(r['net_bias'])
    return d
def ncdf(x): return 0.5*math.erfc(-x/math.sqrt(2))
res=[]
for sym,coin in (('BTCUSDT','BTC'),('ETHUSDT','ETH'),('SOLUSDT','SOL')):
    k=klines(sym); b=bias(coin)
    ts=sorted(b); 
    def sig(t,h):
        v=b.get(t)
        if not v or any(x not in v for x in ('smart_money','exit_liquidity','money_printer','full_rekt','giga_rekt')): return None
        if h=='H1': return v['smart_money']-v['exit_liquidity']
        if h=='H3': return (v['full_rekt']+v['giga_rekt'])
        if h=='H2':
            p=b.get(t-4*H)
            if not p or 'money_printer' not in p: return None
            return v['money_printer']-p['money_printer']
    last=max(k)  # last candle open
    t0=ts[0]; cut=t0+60*24*H
    for hyp in ('H1','H2','H3'):
        for hz in (1,4,24):
            X=[];Y=[];T=[]
            for t in ts:
                s=sig(t,hyp)
                if s is None: continue
                if t+(hz-1)*H not in k or t not in k: continue
                r=math.log(k[t+(hz-1)*H][1]/k[t][0])
                X.append(s);Y.append(r);T.append(t)
            def fit(idx,mu,sd):
                x=[(X[i]-mu)/sd for i in idx]; y=[Y[i] for i in idx]
                sxx=sum(a*a for a in x); beta=sum(a*c for a,c in zip(x,y))/sxx
                cl=collections.defaultdict(float); span=(7 if hz==24 else 1)*24*H
                for i,a,c in zip(idx,x,y): cl[T[i]//span]+=a*(c-beta*a)
                se=math.sqrt(sum(v*v for v in cl.values()))/sxx
                return beta,se,len(idx),len(cl)
            tr=[i for i,t in enumerate(T) if t<cut]; te=[i for i,t in enumerate(T) if t>=cut+hz*H]  # purge: confirm starts hz after the cut
            if len(tr)<200 or len(te)<100: continue
            mu=S.mean(X[i] for i in tr); sd=S.pstdev([X[i] for i in tr]) or 1
            bt,st,nt,ct=fit(tr,mu,sd); bc,sc,nc,cc=fit(te,mu,sd)
            sign=-1 if hyp=='H3' else 1
            zt=sign*bt/st; zc=sign*bc/sc
            res.append(dict(coin=coin,hyp=hyp,hz=hz,n_find=nt,beta_find_bp=bt*1e4,z_find=zt,n_conf=nc,beta_conf_bp=bc*1e4,z_conf=zc,p_find=1-ncdf(zt),p_conf=1-ncdf(zc)))
# BH over confirm p-values (27 tests), and find
def bh(ps,q=0.10):
    idx=sorted(range(len(ps)),key=lambda i:ps[i]); m=len(ps); keep=set()
    for r,i in enumerate(idx,1):
        if ps[i]<=q*r/m: keep=set(idx[:r])
    return keep
kf=bh([r['p_find'] for r in res]); kc=bh([r['p_conf'] for r in res])
for i,r in enumerate(res): r['pass_find']=i in kf; r['pass_conf']=i in kc
print('tests',len(res),'pass in find',len(kf),'pass in confirm',len(kc))
for r in sorted(res,key=lambda r:r['p_conf'])[:10]:
    print(f"{r['coin']} {r['hyp']} {r['hz']:>2}h  find: beta {r['beta_find_bp']:+.1f}bp z {r['z_find']:+.2f} (n {r['n_find']})  confirm: beta {r['beta_conf_bp']:+.1f}bp z {r['z_conf']:+.2f} (n {r['n_conf']})  BH-find {r['pass_find']} BH-confirm {r['pass_conf']}")
json.dump(res,open('cb_study_result.json','w'),indent=1)
