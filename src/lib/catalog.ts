import { i18nText, currentLocale } from './i18n';

export interface CatalogEntry { id: string; category: string; key?: string; label?: string; featured?: boolean }
export interface GroupCard {
  id: string; title: string; summary: string; hostName: string;
  cost: bigint; quote: bigint | null; count: number; minimum: number; capacity: number;
  funded: boolean; status: number; deadline: bigint; blockNumber: bigint;
  timestamp: bigint; fetchedAt: number; error?: string;
}
export const categories = ['all', 'ai', 'learning', 'space', 'community', 'history'] as const;
export function categoryName(key: string) {
  const names: Record<string, string> = { all: '全部活动', ai: 'AI 拼车', learning: '小班共创', space: '场地分摊', community: '社群活动', history: '退款与结算' };
  return i18nText(names[key] || '测试活动');
}
// A locally elapsed deadline must never keep advertising an old join quote.
export function cardTime(g: GroupCard, now = Date.now()) {
  return g.timestamp + BigInt(Math.max(0, Math.floor((now - g.fetchedAt) / 1000)));
}
export function cardClosed(g: GroupCard, now = Date.now()) { return g.status !== 0 || cardTime(g, now) >= g.deadline; }
export function cardStale(g: GroupCard, now = Date.now()) { return now - g.fetchedAt > 15000; }
export function canDiscoverJoin(g: GroupCard, now = Date.now()) {
  return !g.error && !cardClosed(g, now) && g.count < g.capacity && g.quote !== null;
}
export function cardStatus(g: GroupCard, now = Date.now()) {
  if (g.status === 1) return i18nText('已取消 · 可退款');
  if (g.status === 2 || (!g.funded && cardTime(g, now) >= g.deadline)) return i18nText('未成团 · 可退款');
  if (g.status === 3) return i18nText('已结算');
  if (cardTime(g, now) >= g.deadline) return i18nText('已截止 · 待结算');
  if (g.count >= g.capacity) return i18nText('已满员 · 等待截止');
  if (g.funded) return i18nText('已成团 · 继续报名');
  return i18nText('预报名 · 还差 {0} 人', Math.max(0, g.minimum - g.count));
}
export function newestFirst(a: CatalogEntry, b: CatalogEntry) { return BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0; }
export function selectHighlights(entries: CatalogEntry[], cards: Record<string, GroupCard>, now: number) {
  // IDs are monotonically assigned by createGroup. Main case first, then newest
  // joinable groups. Ended/full fixtures remain in the catalog, not in an ad.
  return entries.filter(e => cards[e.id] && canDiscoverJoin(cards[e.id], now))
    .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || newestFirst(a, b)).slice(0, 4);
}
export function activityTheme(e: CatalogEntry) {
  return e.key === 'gpt' ? 'gpt' : e.key === 'claude' ? 'claude'
    : ['learning', 'space', 'community'].includes(e.category) ? e.category : 'gpt';
}
export function activityWord(e: CatalogEntry) {
  return e.category === 'ai' ? '20×' : e.category === 'learning' ? 'MAKE' : e.category === 'space' ? 'SPACE' : 'READ';
}
export function activityLine(e: CatalogEntry) {
  return i18nText(e.category === 'ai' ? '高配灵感的预算，找同路人一起分摊。'
    : e.category === 'learning' ? '一起动手，让想法变成作品。'
    : e.category === 'space' ? '把好空间留给创作，把费用一起分摊。' : '找到同频的人，把每一份费用分清楚。');
}
export function deadlineLabel(g: GroupCard) {
  const date = new Date(Number(g.deadline) * 1000);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(currentLocale(), { month: 'short', day: 'numeric' }).format(date);
}
