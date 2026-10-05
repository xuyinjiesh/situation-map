import type { DatasetMeta } from '../types';

interface HeaderProps {
  meta: DatasetMeta;
  eventCount: number;
  trendCount: number;
}

export function Header({ meta, eventCount, trendCount }: HeaderProps) {
  return (
    <header className="masthead">
      <div className="masthead__seal" aria-hidden="true">
        <span>時</span>
        <span>局</span>
      </div>
      <div className="masthead__text">
        <h1>
          時局圖 <span className="masthead__latin">Situation Map</span>
        </h1>
        <p className="masthead__sub">
          以三维地球同观两重时间尺度：<b>近事</b>是体温，<b>大勢</b>是底图。
        </p>
        <p className="masthead__stat">
          <span>{eventCount} 条近事</span>
          <span className="dot">·</span>
          <span>{trendCount} 条大势</span>
          <span className="dot">·</span>
          <span>数据集 {meta.version}</span>
        </p>
      </div>
    </header>
  );
}
