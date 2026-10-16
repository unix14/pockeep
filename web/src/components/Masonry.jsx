import { useEffect, useRef, useState } from 'react';
import { displayText } from '../lib/util.js';

/* Keep-style masonry: cards flow row by row into the shortest column.
   Heights are estimated from content so the layout is stable while rendering. */
const MIN_COL = 236, GAP = 14;

function estimate(it, colWidth) {
  const charsPerLine = Math.max(18, (colWidth - 28) / 7.4);
  const text = displayText(it);
  const lines = Math.min(11, text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / charsPerLine)), 0));
  let h = 58 + lines * 21;
  if (it.type === 'expense') h = 110;
  if (it.type === 'voucher') h += 120;
  if (it.type === 'event') h += 70;
  if (it.type === 'link' || it.fields?.link) h += 56;
  if (it.title) h += 26;
  if (it.labels?.length) h += 28;
  if (it.flags?.dup || it.flags?.possibleEdit) h += 54;
  return h;
}

export default function Masonry({ items, render }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.min(5, Math.floor((width + GAP) / (MIN_COL + GAP)) || 1));
  const colWidth = (width - GAP * (cols - 1)) / cols;
  const columns = Array.from({ length: cols }, () => ({ h: 0, items: [] }));
  for (const it of items) {
    let target = columns[0];
    for (const c of columns) if (c.h < target.h - 40) target = c; // prefer reading order unless clearly shorter
    target.items.push(it);
    target.h += estimate(it, colWidth) + GAP;
  }
  return (
    <div className="masonry" ref={ref}>
      {columns.map((c, i) => <div className="mcol" key={i}>{c.items.map(render)}</div>)}
    </div>
  );
}
