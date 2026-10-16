import { useMemo } from 'react';
import { Core, money, monthLabel, voucherState, eventState, fmtDate, num } from '../lib/util.js';
import { t } from '../i18n/index.js';

/* Summary strips shown above the grid in the Expenses and Vouchers categories. */

export function expenseMonths(items) {
  const s = new Set();
  for (const it of items) if (it.type === 'expense' && it.fields?.expense) s.add(it.date.slice(0, 7));
  return [...s].sort().reverse();
}

export function ExpenseSummary({ items, month, onMonth }) {
  const months = useMemo(() => expenseMonths(items), [items]);
  const exp = items.filter(it => it.type === 'expense' && it.fields?.expense);
  const inMonth = month === 'all' ? exp : exp.filter(it => it.date.startsWith(month));
  const totals = { ILS: 0, USD: 0 };
  const groups = new Map();
  for (const it of inMonth) {
    const e = it.fields.expense; const cur = e.currency === 'USD' ? 'USD' : 'ILS';
    totals[cur] += Number(e.amount) || 0;
    const key = Core.expenseGroup(e.desc || '') || '—';
    const g = groups.get(key) || { label: e.desc || '—', ILS: 0, USD: 0, n: 0 };
    g[cur] += Number(e.amount) || 0; g.n++;
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => (b.ILS - a.ILS) || (b.USD - a.USD)).slice(0, 12);
  const maxILS = Math.max(1, ...rows.map(r => r.ILS)), maxUSD = Math.max(1, ...rows.map(r => r.USD));
  const share = r => (r.ILS ? r.ILS / maxILS : r.USD / maxUSD) * 100;
  // month-by-month totals for the "all months" view
  const byMonth = month === 'all' ? months.slice(0, 12).map(m => {
    const t = { m, ILS: 0, USD: 0 };
    for (const it of exp) if (it.date.startsWith(m)) t[it.fields.expense.currency === 'USD' ? 'USD' : 'ILS'] += Number(it.fields.expense.amount) || 0;
    return t;
  }) : [];
  const maxM = Math.max(1, ...byMonth.map(r => r.ILS));

  if (!exp.length) return null;
  return (
    <section className="summary" aria-label={t('סיכום הוצאות')}>
      <div className="sum-row">
        <div className="stat"><div className="k">{month === 'all' ? t('סה״כ בכל התקופה') : t('סה״כ ב{month}', { month: monthLabel(month) })}</div><div className="v"><bdi>{money(totals.ILS)}</bdi></div></div>
        {totals.USD > 0 && <div className="stat"><div className="k">{t('בדולרים')}</div><div className="v"><bdi>{money(totals.USD, 'USD')}</bdi></div></div>}
        <div className="stat"><div className="k">{t('רשומות')}</div><div className="v">{num(inMonth.length)}</div></div>
        <label className="monthsw">
          <span className="sr">{t('חודש')}</span>
          <select id="expense-month" value={month} onChange={e => onMonth(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            <option value="all">{t('כל החודשים')}</option>
          </select>
        </label>
      </div>
      {month === 'all' && byMonth.length > 1 && (
        <div className="bars" aria-label={t('סיכום לפי חודש')}>
          {byMonth.map(r => (
            <div className="bar" key={r.m}>
              <span className="name">{monthLabel(r.m)}</span>
              <span className="track"><span className="fill" style={{ width: `${(r.ILS / maxM) * 100}%`, display: 'block', background: 'var(--c-sky)' }} /></span>
              <span className="amt"><bdi>{money(r.ILS)}</bdi>{r.USD ? <> + <bdi>{money(r.USD, 'USD')}</bdi></> : null}</span>
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="bars" aria-label={t('פירוט לפי תיאור')}>
          {rows.map(r => (
            <div className="bar" key={r.label}>
              <span className="name" dir="auto" title={r.label}>{r.label}{r.n > 1 ? <span className="faint"> ×{r.n}</span> : null}</span>
              <span className="track"><span className="fill" style={{ width: `${share(r)}%`, display: 'block' }} /></span>
              <span className="amt">{r.ILS ? <bdi>{money(r.ILS)}</bdi> : null}{r.ILS && r.USD ? ' + ' : null}{r.USD ? <bdi>{money(r.USD, 'USD')}</bdi> : null}</span>
            </div>
          ))}
        </div>
      )}
      <p className="hint">{t('סכומים בדולרים מוצגים בנפרד, בלי המרה לשקלים.')}</p>
    </section>
  );
}

export function VoucherSummary({ items, today }) {
  const v = items.filter(it => it.type === 'voucher');
  if (!v.length) return null;
  const states = v.map(it => ({ it, s: voucherState(it, today) }));
  const active = states.filter(x => x.s.key === 'active' || x.s.key === 'expiring');
  const value = active.reduce((n, x) => n + (Number(x.it.fields?.voucher?.value) || 0), 0);
  const soon = states.filter(x => x.s.key === 'expiring').sort((a, b) => (a.it.fields.voucher.expiry < b.it.fields.voucher.expiry ? -1 : 1));
  return (
    <section className="summary" aria-label={t('סיכום שוברים')}>
      <div className="sum-row">
        <div className="stat"><div className="k">{t('שוברים בתוקף')}</div><div className="v">{num(active.length)}</div></div>
        <div className="stat"><div className="k">{t('שווי ידוע')}</div><div className="v"><bdi>{money(value)}</bdi></div></div>
        <div className="stat"><div className="k">{t('פגים בחודש הקרוב')}</div><div className="v" style={{ color: soon.length ? 'var(--warn)' : undefined }}>{num(soon.length)}</div></div>
        <div className="stat"><div className="k">{t('מומשו או פגו')}</div><div className="v">{num(v.length - active.length)}</div></div>
      </div>
      {soon[0] && <p className="hint">{t('הבא שפג: {name}, בתאריך {date}.', { name: soon[0].it.fields.voucher.issuer || t('שובר'), date: fmtDate(soon[0].it.fields.voucher.expiry) })}</p>}
    </section>
  );
}

export function EventSummary({ items, today }) {
  const next = items.filter(it => it.type === 'event' && eventState(it, today).key === 'upcoming')
    .sort((a, b) => (a.fields.event.date + (a.fields.event.time || '') < b.fields.event.date + (b.fields.event.time || '') ? -1 : 1))[0];
  if (!next) return null;
  const e = next.fields.event; const st = eventState(next, today);
  return (
    <section className="summary" aria-label={t('האירוע הבא')}>
      <div className="sum-row">
        <div className="stat"><div className="k">{t('האירוע הבא')}</div><div className="v" style={{ fontSize: 18 }} dir="auto">{next.title || (next.text ?? next.body).split('\n')[0].slice(0, 70)}</div></div>
        <div className="stat"><div className="k">{t('מתי')}</div><div className="v" style={{ fontSize: 18 }}><bdi>{fmtDate(e.date, e.time)}</bdi> · {st.label}</div></div>
      </div>
    </section>
  );
}
