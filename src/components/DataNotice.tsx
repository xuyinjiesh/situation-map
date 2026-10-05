import { useState } from 'react';
import type { DatasetMeta } from '../types';
import type { DatasetIssue } from '../data/load';

interface DataNoticeProps {
  meta: DatasetMeta;
  issues: DatasetIssue[];
}

export function DataNotice({ meta, issues }: DataNoticeProps) {
  const [open, setOpen] = useState(true);
  const errors = issues.filter((i) => i.level === 'error');

  if (!open) {
    return (
      <button type="button" className="notice__collapsed" onClick={() => setOpen(true)}>
        数据说明
      </button>
    );
  }

  return (
    <div className="notice" role="status">
      <div className="notice__head">
        <span className="notice__tag">{meta.curated ? '策展数据' : '管线数据'}</span>
        <span className="notice__date">更新于 {meta.updated}</span>
        <button type="button" className="notice__close" onClick={() => setOpen(false)} aria-label="收起数据说明">
          ×
        </button>
      </div>
      <p className="notice__text">{meta.disclaimer}</p>
      {errors.length > 0 && (
        <p className="notice__errors">{errors.length} 条数据校验未通过，详见控制台。</p>
      )}
    </div>
  );
}
