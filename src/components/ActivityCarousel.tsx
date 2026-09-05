import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import type { Deployment } from '../types';
import { Amount, destination } from './shared';
import { i18nText } from '../lib/i18n';
import { activityLine, activityTheme, activityWord, cardStale, cardStatus, categoryName, type CatalogEntry, type GroupCard } from '../lib/catalog';

export function ActivityCarousel({ entries, cards, deployment, now }: {
  entries: CatalogEntry[]; cards: Record<string, GroupCard>; deployment: Deployment; now: number;
}) {
  const [selected, setSelected] = useState(entries[0]?.id || '');
  const [auto, setAuto] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hover, setHover] = useState(false);
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [inView, setInView] = useState(true);
  const region = useRef<HTMLElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const rotationPointer = useRef<boolean | null>(null);
  const identity = entries.map(e => e.id).join(',');
  const index = Math.max(0, entries.findIndex(e => e.id === selected));
  const entry = entries[index];
  const rotating = auto && !hover && visible && inView && entries.length > 1;
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => { if (motion.matches) setAuto(false); };
    const visibility = () => setVisible(document.visibilityState === 'visible');
    motion.addEventListener('change', changed);
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([item]) => setInView(item.isIntersecting), { threshold: 0.15 });
    if (region.current) observer.observe(region.current);
    return () => { observer.disconnect(); motion.removeEventListener('change', changed); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setSelected(entries[(index + 1) % entries.length].id), 6500);
    return () => window.clearTimeout(timer);
  }, [identity, index, rotating]);
  function move(step: number) {
    setAuto(false);
    setSelected(entries[(index + step + entries.length) % entries.length].id);
  }
  if (!entry) return null;
  const g = cards[entry.id], stale = cardStale(g, now);
  return <section ref={region} className="activity-carousel" data-theme={activityTheme(entry)}
    role="region" aria-roledescription={i18nText('轮播')} aria-label={i18nText('近期精选活动')}
    data-active-group={entry.id} data-rotating={rotating}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onFocusCapture={() => setAuto(false)}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); } }}
    onTouchStart={e => { if (e.touches.length === 1) { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; setAuto(false); } else touch.current = null; }}
    onTouchCancel={() => { touch.current = null; }}
    onTouchEnd={e => { if (!touch.current || !e.changedTouches.length) return; const x = e.changedTouches[0].clientX - touch.current.x, y = e.changedTouches[0].clientY - touch.current.y; touch.current = null; if (Math.abs(x) > 55 && Math.abs(x) > Math.abs(y) * 1.5) move(x < 0 ? 1 : -1); }}>
    {entries.length > 1 && <button type="button" className="rotation-control" data-rotation-control
      onPointerDown={() => { rotationPointer.current = auto; }}
      onPointerCancel={() => { rotationPointer.current = null; }}
      onClick={() => { const beforeFocus = rotationPointer.current; rotationPointer.current = null; setAuto(value => !(beforeFocus ?? value)); }} aria-label={auto ? i18nText('暂停轮播') : i18nText('播放轮播')}>
      {auto ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
      <span>{auto ? i18nText('暂停轮播') : i18nText('播放轮播')}</span>
    </button>}
    <div aria-live={auto ? 'off' : 'polite'} aria-atomic="false">
      <div className="banner-slide" key={entry.id} role="group" aria-roledescription={i18nText('活动')}
        aria-label={`${index + 1} / ${entries.length} · ${g.title}`}>
        <div className="banner-copy">
          <p className="banner-kicker"><span className="banner-dot" />{entry.featured ? i18nText('本期主推') : i18nText('近期精选')}<span className="banner-category">{categoryName(entry.category)}</span></p>
          <h2>{g.title}</h2>
          <p className="banner-description">{activityLine(entry)}</p>
          <span className="banner-status">{stale ? i18nText('快照待更新') : cardStatus(g, now)}</span>
          <a className="banner-cta" href={destination(`/g/${entry.id}`, deployment)}>{i18nText('查看活动')}<ArrowUpRight size={21} aria-hidden="true" /></a>
        </div>
        <div className="banner-art">
          <span className="banner-word" aria-hidden="true">{activityWord(entry)}</span>
          <div className="banner-ticket">
            <div className="ticket-header"><span>FAIRJOIN</span><span>#{entry.id.padStart(2, '0')}</span></div>
            <span className="ticket-label">{stale ? i18nText('固定总价') : g.funded ? i18nText('现在加入') : i18nText('预报名款')}</span>
            <Amount value={stale ? g.cost : g.quote ?? g.cost} deployment={deployment} />
            <div className="ticket-divider" />
            <div className="ticket-footer"><span>{i18nText('已加入')}<strong>{g.count} / {g.capacity}</strong></span><span>{i18nText('总价')}<strong>{Number(g.cost) / 10 ** deployment.decimals}</strong></span></div>
          </div>
        </div>
      </div>
    </div>
    <div className="banner-navigation">
      <span className="banner-counter">{String(index + 1).padStart(2, '0')}<span> / {String(entries.length).padStart(2, '0')}</span></span>
      <div className="banner-pickers" role="group" aria-label={i18nText('选择活动')}>
        {entries.map((e, i) => <button type="button" key={e.id} aria-label={cards[e.id].title} aria-disabled={i === index}
          className={i === index ? 'selected' : ''} onClick={() => { setAuto(false); setSelected(e.id); }}><span /> </button>)}
      </div>
      <div className="banner-arrows"><button type="button" onClick={() => move(-1)} aria-label={i18nText('上一个活动')} disabled={entries.length < 2}><ChevronLeft size={20} aria-hidden="true" /></button><button type="button" onClick={() => move(1)} aria-label={i18nText('下一个活动')} disabled={entries.length < 2}><ChevronRight size={20} aria-hidden="true" /></button></div>
    </div>
  </section>;
}
