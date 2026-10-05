const full = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
const short = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });

export const DAY = 86400000;

export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : full.format(t);
}

export function formatShort(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : short.format(t);
}

export function formatStamp(ms: number): string {
  return full.format(new Date(ms));
}

/** 相对当下的表述。锚点显式传入，方便回放时以"游标日"为基准而不是真实今天。 */
export function relativeTo(ms: number, anchor: number): string {
  const diff = Math.round((anchor - ms) / DAY);
  if (diff <= 0) return '当日';
  if (diff === 1) return '前一日';
  if (diff < 30) return `${diff} 日前`;
  if (diff < 365) return `${Math.round(diff / 30)} 个月前`;
  return `${(diff / 365).toFixed(1)} 年前`;
}
