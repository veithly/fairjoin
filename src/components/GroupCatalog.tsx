import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Camera, Layers, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { Deployment } from '../types';
import { pinhaotuanAbi } from '../generated/abi';
import { reader } from '../lib/chain';
import { Amount, destination } from './shared';
import { ActivityCarousel } from './ActivityCarousel';
import { i18nText } from '../lib/i18n';
import { activityTheme, activityWord, canDiscoverJoin, cardClosed, cardStale, cardStatus, categories, categoryName, deadlineLabel, newestFirst, selectHighlights, type CatalogEntry, type GroupCard } from '../lib/catalog';
export { cardStatus } from '../lib/catalog';
export type { CatalogEntry } from '../lib/catalog';

export function useGroupCards(d: Deployment, ids: string[]) {
  const identity = ids.join(',');
  const [cards, setCards] = useState<Record<string, GroupCard>>({});
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const alive = useRef(0), pending = useRef<string | null>(null);
  const reload = useCallback(async () => {
    if (!ids.length) return;
    const generation = alive.current, job = `${generation}:${identity}`;
    if (pending.current === job) return;
    pending.current = job; setLoading(true); setError('');
    try {
      const c = reader(d), block = await c.getBlock(), newCards: Record<string, GroupCard> = {};
      for (let offset = 0; offset < ids.length; offset += 3) {
        await Promise.all(ids.slice(offset, offset + 3).map(async id => {
          try {
            const g = await c.readContract({ address: d.contract, abi: pinhaotuanAbi, functionName: 'getGroup', args: [BigInt(id)], blockNumber: block.number });
            let meta: Record<string, unknown> = {};
            try { const parsed = JSON.parse(g.metadataJson); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed; } catch { /* Untrusted metadata is not financial state. */ }
            const text = (key: string, fallback: string) => typeof meta[key] === 'string' ? meta[key] as string : fallback;
            const open = g.status === 0 && block.timestamp < g.deadline && g.activeMembers.length < g.capacity;
            let quote: bigint | null = null;
            if (open) { const q = await c.readContract({ address: d.contract, abi: pinhaotuanAbi, functionName: 'quoteJoin', args: [BigInt(id)], blockNumber: block.number }); quote = q[0]; }
            newCards[id] = { id, title: text('title', i18nText('活动 #{0}', id)), summary: text('summary', ''), hostName: text('hostName', ''), cost: g.cost, quote, count: g.activeMembers.length, minimum: g.minimum, capacity: g.capacity, funded: g.funded, status: g.status, deadline: g.deadline, blockNumber: block.number, timestamp: block.timestamp, fetchedAt: Date.now() };
          } catch (e) {
            newCards[id] = { id, title: i18nText('活动 #{0}', id), summary: '', hostName: '', cost: 0n, quote: null, count: 0, minimum: 0, capacity: 0, funded: false, status: 0, deadline: 0n, blockNumber: block.number, timestamp: block.timestamp, fetchedAt: Date.now(), error: e instanceof Error ? e.message.slice(0, 120) : i18nText('RPC读取失败') };
          }
        }));
      }
      if (generation === alive.current) setCards(previous => Object.fromEntries(Object.entries(newCards).map(([id, card]) => [id, previous[id] && previous[id].blockNumber > card.blockNumber ? previous[id] : card])));
    } catch (e) { if (generation === alive.current) setError(e instanceof Error ? e.message.slice(0, 180) : i18nText('无法读取活动列表')); }
    finally { if (pending.current === job) pending.current = null; if (generation === alive.current) setLoading(false); }
  }, [d.chainId, d.contract, d.token, d.rpcUrl, d.rpcUrls?.join(','), identity]);
  useEffect(() => {
    alive.current++; setCards({}); setLoading(false); void reload();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 12000);
    return () => { alive.current++; clearInterval(timer); };
  }, [reload]);
  return { cards, loading, error, reload };
}

export function GroupCatalog({ deployment: d }: { deployment: Deployment }) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]), [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true), [category, setCategory] = useState('all'), [query, setQuery] = useState(''), [nonce, setNonce] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setCatalogError(''); setCatalogLoading(true);
    fetch('/catalog.json', { cache: 'no-store', signal: abort.signal }).then(async response => {
      if (!response.ok) throw Error(i18nText('活动目录暂未配置'));
      const v = await response.json();
      if (v?.chainId !== d.chainId || String(v.contract).toLowerCase() !== d.contract.toLowerCase() || String(v.token).toLowerCase() !== d.token.toLowerCase() || !Array.isArray(v.groups)) throw Error(i18nText('活动目录与当前部署不匹配，已停止展示'));
      const seen = new Set<string>(), valid: CatalogEntry[] = [];
      for (const item of v.groups.slice(0, 120)) {
        if (!item || typeof item !== 'object' || !/^\d{1,78}$/.test(String(item.id)) || typeof item.category !== 'string') continue;
        const id = BigInt(item.id).toString();
        if (seen.has(id) || BigInt(id) >= 2n ** 256n) continue;
        seen.add(id); valid.push({ id, category: item.category, key: typeof item.key === 'string' ? item.key : undefined, featured: item.featured === true });
      }
      if (!abort.signal.aborted) setEntries(valid);
    }).catch(e => { if (!abort.signal.aborted) { setCatalogError(e instanceof Error ? e.message : i18nText('无法读取活动列表')); setEntries([]); } })
      .finally(() => { if (!abort.signal.aborted) setCatalogLoading(false); });
    return () => abort.abort();
  }, [d.chainId, d.contract, d.token, nonce]);
  const ids = useMemo(() => entries.map(e => e.id), [entries]);
  const { cards, loading, error, reload } = useGroupCards(d, ids);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const rank = (e: CatalogEntry) => e.featured ? 0 : cards[e.id] && canDiscoverJoin(cards[e.id], now) ? 1 : 2;
  const normalizedQuery = query.trim().toLowerCase();
  const shown = entries.filter(e => {
    const g = cards[e.id], history = g && !g.error && cardClosed(g, now);
    return (category === 'all' || category === 'history' && history || category === e.category)
      && (!normalizedQuery || `${g?.title || ''} ${e.id} ${g?.summary || ''}`.toLowerCase().includes(normalizedQuery));
  }).sort((a, b) => rank(a) - rank(b) || newestFirst(a, b));
  const highlights = selectHighlights(entries, cards, now);
  const firstLoad = catalogLoading || (entries.length > 0 && !Object.keys(cards).length && !error);
  return <>
    {highlights.length > 0 ? <ActivityCarousel entries={highlights} cards={cards} deployment={d} now={now} />
      : firstLoad ? <div className="banner-skeleton skeleton" role="status">{i18nText('正在读取近期活动…')}</div>
      : !catalogError && !error ? <div className="banner-empty"><strong>{i18nText('每个好活动，都从一个人发起。')}</strong><p>{i18nText('暂时没有开放报名的精选活动，下方仍可查看历史记录。')}</p><a className="secondary" href={`${destination('/host', d)}&new=1`}>{i18nText('发起一个团')}</a></div> : null}
    <p className="discovery-note">{i18nText('测试网活动示例 · FJUSD 无价值 · 不提供会员、场地或其他服务')}</p>
    <section className="catalog discovery-catalog" aria-labelledby="catalog-title">
      <div className="section-head catalog-heading"><div><h2 id="catalog-title">{i18nText('找到你的下一团')}<span>{entries.length ? String(entries.length).padStart(2, '0') : '—'}</span></h2></div>
        <button className="catalog-refresh" type="button" onClick={() => { setNonce(n => n + 1); void reload(); }} disabled={loading || catalogLoading}><RefreshCw size={16} className={loading ? 'refreshing' : ''} aria-hidden="true" />{i18nText('刷新活动')}</button>
      </div>
      <div className="catalog-controls">
        <div className="catalog-filters" role="group" aria-label={i18nText('按场景筛选')}>{categories.map(value => <button key={value} type="button" aria-pressed={category === value} onClick={() => setCategory(value)}>{categoryName(value)}</button>)}</div>
        <label className="catalog-search"><Search size={17} aria-hidden="true" /><span className="discovery-sr">{i18nText('查找活动')}</span><input type="search" aria-label={i18nText('查找活动')} placeholder={i18nText('活动名称或编号')} value={query} onChange={e => setQuery(e.target.value)} /></label>
      </div>
      {(catalogError || error) && <p role="alert" className="error-text">{catalogError || error}{i18nText('。可以刷新重试，也可通过活动链接直接进入。')}</p>}
      <div className="catalog-grid">{firstLoad && !entries.length ? [0, 1, 2].map(n => <div className="catalog-loading skeleton" key={n} aria-hidden="true" />) : shown.map(entry => {
        const g = cards[entry.id], stale = g && cardStale(g, now), open = g && canDiscoverJoin(g, now);
        const Icon = entry.category === 'ai' ? Sparkles : entry.category === 'space' ? Camera : entry.category === 'learning' ? Layers : BookOpen;
        return <article className={`catalog-card ${entry.featured ? 'featured' : ''}`} key={entry.id} data-group-id={entry.id} data-category={entry.category}>
          <div className="catalog-cover" data-theme={activityTheme(entry)} aria-hidden="true"><span className="cover-category">{categoryName(entry.category)}</span><span className="cover-word">{activityWord(entry)}</span><Icon className="cover-icon" strokeWidth={1.2} /><span className="cover-number">#{entry.id.padStart(2, '0')}</span>{entry.featured && <span className="cover-featured">{i18nText('主推')}</span>}</div>
          <div className="catalog-card-body">
            <div className="catalog-eyebrow"><span className={open ? 'card-status open' : 'card-status'}>{g && !g.error ? stale ? i18nText('快照待更新') : cardStatus(g, now) : i18nText('正在核对')}</span></div>
            <h3>{g?.title || i18nText('正在读取活动 #{0}', entry.id)}</h3>
            {!g ? <div className="skeleton" /> : g.error ? <p className="fine">{i18nText('该活动读取失败，未展示假价格。')}</p> : <>
              <div className="catalog-meta"><span>{categoryName(entry.category)}</span><span>{deadlineLabel(g)} {i18nText('报名截止')}</span></div>
              <div className="catalog-finance"><div><span>{open && !stale ? g.funded ? i18nText('现在加入') : i18nText('预报名款') : i18nText('固定总价')}</span><Amount value={open && !stale ? g.quote! : g.cost} deployment={d} /></div><div className="catalog-seats"><span>{i18nText('已加入')}</span><strong>{g.count}<small> / {g.capacity}</small></strong></div></div>
              <div className="roster-track" aria-hidden="true"><span style={{ width: `${g.capacity ? g.count / g.capacity * 100 : 0}%` }} /></div>
            </>}
            <a className="catalog-open" href={destination(`/g/${entry.id}`, d)} aria-label={i18nText('查看活动：{0}', g?.title || `#${entry.id}`)}><span>{open && !stale ? i18nText('查看活动与最新报价') : i18nText('查看状态与公开收据')}</span><ArrowUpRight size={18} aria-hidden="true" /></a>
          </div>
        </article>;
      })}</div>
      {!shown.length && !firstLoad && !catalogError && !error && <div className="catalog-empty" role="status"><h3>{i18nText('还没有找到这一团。')}</h3><p>{i18nText('没有匹配的活动。清空搜索或选择其他分类。')}</p><button className="secondary" onClick={() => { setQuery(''); setCategory('all'); }}>{i18nText('查看全部活动')}</button></div>}
    </section>
  </>;
}

export function HostGroupList({deployment:d,ids,onManage}:{deployment:Deployment;ids:bigint[];onManage:(id:bigint)=>void}){
 const [limit,setLimit]=useState(8);const selected=useMemo(()=>[...ids].reverse().slice(0,limit).map(String),[ids,limit]);const {cards,loading,error,reload}=useGroupCards(d,selected);
 return <><button className="text-button" onClick={()=>void reload()}>{i18nText("刷新活动摘要")}</button>{error&&<p role="alert">{error}</p>}<div className="host-group-cards">{selected.map(id=>{const g=cards[id];return <article key={id}><div><span className="fine">{i18nText("活动 #")}{id}</span><h3>{g?.title||i18nText('正在读取活动名称')}</h3><p>{g&&!g.error?i18nText("{0} · {1}/{2} 人", cardStatus(g), g.count, g.capacity):g?.error?i18nText('读取失败，点击管理重试'):i18nText('正在读取链上状态')}</p>{g&&!g.error&&<Amount value={g.cost} deployment={d}/>}</div><div className="host-actions"><button className="secondary" onClick={()=>onManage(BigInt(id))}>{i18nText("读取并管理")}</button><a className="text-button" href={destination(`/g/${id}`,d)}>{i18nText("公开活动 ↗")}</a></div></article>})}</div>{ids.length>limit&&<button className="secondary" disabled={loading} onClick={()=>setLimit(n=>n+8)}>{i18nText("再显示 8 个活动")}</button>}</>;
}
