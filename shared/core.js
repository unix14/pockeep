/* pockeep core: parsing, fingerprinting, reconciliation, classification.
   Pure functions with no DOM or Node APIs. Imported by both the server (imports)
   and the web client (search normalisation, URL and date helpers). */
const Core = (() => {
  'use strict';

  // ---------- text helpers ----------
  const INVIS = /[​-‏‪-‮⁦-⁩﻿]/g;
  const clean = s => (s || '').normalize('NFC').replace(INVIS, '');
  const normKey = s => clean(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
  const searchNorm = s => clean(s).toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, c => FINALS[c])
    .replace(/[״"]/g, '"').replace(/[׳']/g, "'");
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  // cyrb53-style 53-bit hash -> base36
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // ---------- message body: markers, media, documents ----------
  const MEDIA_MD = {
    'image': 'image', 'audio': 'audio', 'video': 'video', 'sticker': 'sticker', 'gif': 'image',
    'album message': 'album', 'unknown message': 'unknown', 'document': 'document',
    'voice message': 'audio', 'contact': 'contact', 'location': 'location', 'poll': 'poll'
  };
  const DOC_RE = /^(.+?\.[A-Za-z0-9]{1,5})(?:\s+([\s\S]*))?$/;

  // returns {body, media, docName, forwarded}
  function stripMarkers(text) {
    let t = clean(text).replace(/^\s+/, '');
    let forwarded = false, media = null, docName = null;
    for (let guard = 0; guard < 6; guard++) {
      const m = t.match(/^\[([^\]\n]{2,40})\]\s*/);
      if (!m) break;
      const tag = m[1].toLowerCase().trim();
      if (tag.startsWith('forwarded')) { forwarded = true; t = t.slice(m[0].length); continue; }
      if (MEDIA_MD[tag]) {
        media = MEDIA_MD[tag]; t = t.slice(m[0].length);
        if (media === 'document') {
          const firstLine = t.split('\n')[0];
          const dm = firstLine.match(DOC_RE);
          if (dm) { docName = dm[1].trim(); t = (dm[2] || '') + t.slice(firstLine.length); }
          else if (firstLine.trim()) { docName = firstLine.trim(); t = t.slice(firstLine.length); }
        }
        continue;
      }
      break;
    }
    // native WhatsApp attachment markers
    const nat = nativeMedia(t);
    if (nat) { media = media || nat.media; docName = docName || nat.docName; t = nat.rest; }
    t = t.replace(/\s*<This message was edited>\s*$/i, '').replace(/\s*‎?<.{0,20}נערכה.{0,10}>\s*$/, '');
    return { body: t.replace(/\s+$/, '').replace(/^\s*\n/, ''), media, docName, forwarded };
  }

  const IMG_EXT = /\.(jpe?g|png|gif|webp|heic|mp4|mov|3gp|opus|ogg|m4a|mp3|aac|webm|vcf|wav)$/i;
  function nativeMedia(t) {
    const lines = t.split('\n');
    const first = lines[0].trim();
    let m;
    if (/^<(media omitted|מדיה הושמטה)>$/i.test(first) || /^(image|video|audio|sticker|gif|document|contact card) omitted$/i.test(first)
      || /^(התמונה|הסרטון|האודיו|המדבקה) הושמט/.test(first)) {
      return { media: 'image', docName: null, rest: lines.slice(1).join('\n') };
    }
    if ((m = first.match(/^<attached:\s*(?:\d+-)?(.+?)>$/i)) || (m = first.match(/^(.+?)\s+\((?:file attached|קובץ מצורף)\)$/i))) {
      const name = m[1].trim();
      const isDoc = !IMG_EXT.test(name) && !/^(IMG|VID|PTT|AUD|STK)-/i.test(name) && !/-(PHOTO|VIDEO|AUDIO|STICKER|GIF)-/i.test(name);
      return { media: isDoc ? 'document' : 'image', docName: isDoc ? name : null, rest: lines.slice(1).join('\n') };
    }
    if ((m = first.match(/^(.+?\.[A-Za-z0-9]{1,5})\s+•.*document omitted$/i)) || (m = first.match(/^(.+?\.[A-Za-z0-9]{1,5}) document omitted$/i))) {
      return { media: 'document', docName: m[1].trim(), rest: lines.slice(1).join('\n') };
    }
    if (/^(this message was deleted|you deleted this message|null|הודעה זו נמחקה|מחקת הודעה זו)$/i.test(first) && lines.length === 1) {
      return { media: 'unknown', docName: null, rest: '' };
    }
    return null;
  }

  // ---------- parsers ----------
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  function to24(h, min, ap) {
    h = +h;
    if (ap) { ap = ap.toLowerCase().replace(/\./g, ''); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; }
    return `${pad(h)}:${pad(+min)}`;
  }

  function detectFormat(text) {
    const head = text.slice(0, 4000);
    if (/^## (January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/m.test(head) || /^\[\d{1,2}:\d{2}(?::\d{2})? ?[AP]M\] \*\*/m.test(head)) return 'md';
    if (/^‎?\[\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},? \d{1,2}:\d{2}/m.test(head)) return 'ios';
    if (/^‎?\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4},? \d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)? - /m.test(head)) return 'android';
    return null;
  }

  function parseMd(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const msgs = []; let date = null, cur = null, exportDate = null, title = null;
    const DAY = /^## (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})\s*$/;
    const MSG = /^\[(\d{1,2}):(\d{2})(?::\d{2})? ?([AP]M)\] (?:\*\*(.+?):\*\*|(__\[System notification\]__))\s?(.*)$/;
    const close = () => { if (cur) { msgs.push(cur); cur = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!date) {
        const tm = line.match(/^# (?:WhatsApp Chat Export:\s*)?(.+)$/); if (tm && !title) title = tm[1].trim();
        const em = line.match(/^Export date:\s*(.+)$/i); if (em) exportDate = em[1].trim();
      }
      let m = line.match(DAY);
      if (m) { close(); date = `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`; continue; }
      if (line.trim() === '---') {
        let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || DAY.test(lines[j])) { close(); continue; }
      }
      m = date && line.match(MSG);
      if (m) {
        close();
        cur = { date, time: to24(m[1], m[2], m[3]), sender: m[5] ? null : m[4], system: !!m[5], raw: m[6] };
        continue;
      }
      if (cur) cur.raw += '\n' + line;
    }
    close();
    return { msgs, exportDate, title };
  }

  function parseNative(text, kind) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const RE = kind === 'ios'
      ? /^‎?\[(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?\]\s(.*)$/
      : /^‎?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?\s+-\s(.*)$/;
    const raw = []; let cur = null; let dmy = null, maxA = 0, maxB = 0;
    for (const line of lines) {
      const m = line.match(RE);
      if (m) {
        if (cur) raw.push(cur);
        maxA = Math.max(maxA, +m[1]); maxB = Math.max(maxB, +m[2]);
        cur = { a: +m[1], b: +m[2], y: +m[3], time: to24(m[4], m[5], m[6]), rest: m[7] };
      } else if (cur) cur.rest += '\n' + line;
    }
    if (cur) raw.push(cur);
    dmy = maxA > 12 ? true : maxB > 12 ? false : true;
    const msgs = raw.map(r => {
      const day = dmy ? r.a : r.b, mon = dmy ? r.b : r.a, yr = r.y < 100 ? 2000 + r.y : r.y;
      const cm = clean(r.rest).match(/^([^:\n]{1,60}):\s([\s\S]*)$/);
      return cm
        ? { date: `${yr}-${pad(mon)}-${pad(day)}`, time: r.time, sender: cm[1].trim(), system: false, raw: cm[2] }
        : { date: `${yr}-${pad(mon)}-${pad(day)}`, time: r.time, sender: null, system: true, raw: r.rest };
    });
    return { msgs, exportDate: null, title: null };
  }

  // Parse any supported export -> {format, items:[normalized msg], stats}
  function parseExport(text) {
    const format = detectFormat(text);
    if (!format) return { format: null, items: [], stats: { error: 'הקובץ לא זוהה. יש להעלות ייצוא צ׳אט של וואטסאפ (‎.txt‎) או קובץ ‎.md‎ מומר.' } };
    const parsed = format === 'md' ? parseMd(text) : parseNative(text, format);
    const stats = { messages: 0, system: 0, bareMedia: 0, kept: 0 };
    const items = [];
    const occ = new Map(); const daySeq = new Map();
    for (const m of parsed.msgs) {
      stats.messages++;
      if (m.system) { stats.system++; continue; }
      const s = stripMarkers(m.raw);
      if (!s.body.trim() && !s.docName) { stats.bareMedia++; continue; }
      const key = normKey(s.body) + (s.docName ? ' |doc:' + normKey(s.docName) : '');
      const ok = m.date + '\n' + key;
      const k = occ.get(ok) || 0; occ.set(ok, k + 1);
      const seq = (daySeq.get(m.date) || 0); daySeq.set(m.date, seq + 1);
      items.push({
        id: 'i' + hash(m.date + '\n' + key + '\n#' + k), key,
        date: m.date, time: m.time, seq, occ: k, sender: m.sender || null,
        raw: clean(m.raw).replace(/\s+$/, ''), body: s.body, media: s.media, docName: s.docName, forwarded: s.forwarded
      });
      stats.kept++;
    }
    return { format, exportDate: parsed.exportDate, title: parsed.title, items, stats };
  }

  // ---------- URLs ----------
  const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'א-ת]*[^\s<>"'.,;:!?)\]א-ת]/gi;
  const TRACK = /^(utm_[a-z_]+|ttclid|fbclid|gclid|dclid|msclkid|igsh|igshid|igsi|si|stkn|srtk|xtok|_r|u_code|preview_pb|sharer_language|_d|share_item_id|source|timestamp|user_id|sec_user_id|social_share_type|share_iid|share_link_id|share_app_id|ugbiz_name|ug_btm|sp_root_share_link_id|link_reflow_popup_iteration_sharer|panel_source_v2|share_enter_from|item_author_type|enable_checksum|sp_level|sp_root_u|sp_root_d|mkt_tok|trk|sc_channel|rcm|component-type|opened-from|spot|location|feature|ab_channel|mt|urlhash|isSdui|trackingId|refId)$/i;
  function findUrls(text) { return (clean(text).match(URL_RE) || []); }
  function cleanUrl(u) {
    let s = /^www\./i.test(u) ? 'https://' + u : u;
    let url; try { url = new URL(s); } catch (e) { return s; }
    if (/linkedin\.com$/i.test(url.hostname) && /\/safety\/go/.test(url.pathname) && url.searchParams.get('url')) {
      return cleanUrl(url.searchParams.get('url'));
    }
    const del = [];
    url.searchParams.forEach((v, k) => { if (TRACK.test(k)) del.push(k); });
    del.forEach(k => url.searchParams.delete(k));
    let out = url.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  }
  function domainOf(u) {
    try { return new URL(/^www\./i.test(u) ? 'https://' + u : u).hostname.replace(/^www\./, '').replace(/^m\./, ''); } catch (e) { return ''; }
  }
  const PLATFORM = [
    [/(^|\.)tiktok\.com$/, 'tiktok'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
    [/(^|\.)spotify\.com$/, 'spotify'], [/(^|\.)github\.com$/, 'github'], [/(^|\.)linkedin\.com$/, 'linkedin'],
    [/(^|\.)(gemini\.google|g\.co|chatgpt\.com|claude\.ai)$/, 'ai'], [/(^|\.)lovable\.app$/, 'lovable']
  ];
  const platformOf = d => { for (const [re, p] of PLATFORM) if (re.test(d)) return p; return 'web'; };

  // ---------- extraction helpers ----------
  const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function validDate(y, m, d) { const dt = new Date(y, m - 1, d); return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null; }
  // all explicit dates in text, in order -> [{date:'YYYY-MM-DD', index}]
  function findDates(text, msgDate) {
    const out = []; const t = clean(text);
    const re = /(?<![\d:.\/])(\d{1,2})[\/.](\d{1,2})[\/.](\d{4}|\d{2})(?![\d\/])/g; let m;
    while ((m = re.exec(t))) {
      let y = +m[3]; if (y < 100) y += 2000;
      const dt = validDate(y, +m[2], +m[1]); if (dt) out.push({ date: ymd(dt), index: m.index });
    }
    const re2 = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:ב|ל)?(${HE_MONTHS.join('|')})(?:\\s+(\\d{4}))?`, 'g');
    const base = msgDate ? parseYmd(msgDate) : new Date();
    while ((m = re2.exec(t))) {
      const mon = HE_MONTHS.indexOf(m[2]) + 1; let y = m[3] ? +m[3] : base.getFullYear();
      let dt = validDate(y, mon, +m[1]);
      if (dt && !m[3] && dt < base) dt = validDate(y + 1, mon, +m[1]);
      if (dt) out.push({ date: ymd(dt), index: m.index });
    }
    return out.sort((a, b) => a.index - b.index);
  }
  const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  function weekdayDate(text, msgDate) {
    const m = clean(text).match(new RegExp(`ביום (${HE_DAYS.join('|')})(?: הקרוב)?`));
    if (!m || !msgDate) return null;
    const base = parseYmd(msgDate); const target = HE_DAYS.indexOf(m[1]);
    let diff = (target - base.getDay() + 7) % 7; if (diff === 0) diff = 7;
    base.setDate(base.getDate() + diff); return ymd(base);
  }
  function findTime(text) {
    const t = clean(text);
    let m = t.match(/(?:בשעה|בשעות|at|ב-?\s?)\s*(\d{1,2})[:.](\d{2})(?!\d)/i) || t.match(/(?<![\d\/.:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/);
    if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`;
    return null;
  }

  // ---------- expenses ----------
  const CUR = `(₪|ש"ח|ש״ח|שח|שקל(?:ים)?|nis|ils|\\$|דולר|usd)`;
  const AMT = `(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)`;
  const EXP_START = new RegExp(`^${CUR}?\\s*${AMT}\\s*${CUR}?\\s+(.+)$`, 'i');
  const EXP_END = new RegExp(`^(.+?)\\s+${CUR}?\\s*${AMT}\\s*${CUR}?$`, 'i');
  const curOf = c => !c ? null : /\$|דולר|usd/i.test(c) ? 'USD' : 'ILS';
  function parseExpense(body) {
    const t = normKey(body).replace(/\s+/g, ' ');
    if (!t || t.includes('\n') || findUrls(t).length) return null;
    if (t.split(' ').length > 7) return null;
    let m = t.match(EXP_START), amount, cur, desc;
    if (m) { amount = m[2]; cur = curOf(m[1] || m[3]); desc = m[4]; }
    else if ((m = t.match(EXP_END)) && ((m[2] || m[4]) || t.split(' ').length <= 4)) { desc = m[1]; cur = curOf(m[2] || m[4]); amount = m[3]; }
    else return null;
    const descCur = desc.match(new RegExp(`^${CUR}\\s+(.+)$`, 'i'));
    if (descCur) { cur = cur || curOf(descCur[1]); desc = descCur[2]; }
    const n = parseFloat(amount.replace(/,/g, ''));
    if (!isFinite(n) || n <= 0 || n >= 1e6) return null;
    if (!/[a-zא-ת]/i.test(desc)) return null;
    if (/^\d{4}$/.test(amount) && n >= 1990 && n <= 2099 && !cur) return null;
    if (/^\d+[:\/]/.test(desc)) return null;
    return { amount: n, currency: cur || 'ILS', desc: desc.trim() };
  }
  const expenseGroup = d => searchNorm(d).replace(/[^a-z0-9א-ת ]/g, '').replace(/\s+/g, ' ').trim();

  // ---------- vouchers ----------
  const HB = '(?<![\\u05d0-\\u05ea])[הובלמש]?';
  const HE = '(?![\\u05d0-\\u05ea])';
  const VOUCHER_KW = new RegExp(`${HB}(קוד(?:י|ים)?|קופון|שובר|גיפט ?קארד|ביימי|מולטיפס|תו הזהב|תו קניה)${HE}|\\b(gift ?card|voucher|coupon|promo code|buyme|dream ?card|multipass)\\b|הטבה הייחודי`, 'i');
  const VOUCHER_DOMAINS = /(^|\.)(buyme\.co\.il|dcgift\.co\.il|multipass\.co\.il)$/;
  function extractCode(t) {
    const kw = /(?<![\u05d0-\u05ea])(?:ה|ב|ו)?(קוד(?:\s+(?:השובר|הקופון|קופון|ההטבה|שובר))?(?:\s+(?:שלך|הייחודי שלך|הבא|למימוש))?|קופון(?:\s+הבא)?|code|coupon)(?![\u05d0-\u05ea])\s*[:\-–]?\s*/gi;
    let m, best = null;
    while ((m = kw.exec(t))) {
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 160);
      const c = codeIn(after); if (c) { best = c; break; }
    }
    if (!best) best = codeIn(t, true);
    return best;
  }
  function codeIn(s, strict) {
    const pats = [
      /\b([A-Z0-9]{4}(?: [A-Z0-9]{4}){2,4})\b/,
      /\b(\d{3}-\d{6,12}|\d{6,12}-\d{3,6})\b/,
      /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])([A-Z0-9]{6,16})\b/,
      /(?<![\d\/.])(\d{10,16})(?![\d\/.])/
    ];
    if (!strict) pats.push(/^\s*([A-Za-z]*\d[A-Za-z0-9]{2,15}|[A-Za-z]{3,}\d+)\b/);
    for (const p of pats) {
      const m = s.match(p);
      if (m) {
        const c = m[1].trim();
        if (/^05\d{8}$/.test(c) || /^0\d{8,9}$/.test(c)) continue;
        if (/^[A-Z]{2}\d{8,10}[A-Z]{1,2}$/.test(c)) continue;
        if (strict && /^\d+$/.test(c) && c.length < 12) continue;
        return c;
      }
    }
    return null;
  }
  function parseVoucher(body, msgDate) {
    const t = clean(body);
    const urls = findUrls(t);
    const vdom = urls.some(u => VOUCHER_DOMAINS.test(domainOf(u)));
    const kw = VOUCHER_KW.test(t);
    if (!kw && !vdom) return null;
    const code = extractCode(t);
    if (!code && !vdom) return null;
    let value = null;
    let m = t.match(/(?:בשווי|שווי|value(?: of)?)\s*(?:של\s*)?₪?\s*([\d,]+)\s*(?:₪|ש"ח|ש״ח|שח)?/i)
      || t.match(/₪\s?([\d,]{2,})/) || t.match(/([\d,]{2,})\s?(?:₪|ש"ח|ש״ח)/);
    if (m) value = parseFloat(m[1].replace(/,/g, ''));
    let expiry = null;
    m = t.match(/(?:בתוקף|תוקף(?:\s+למימוש)?|valid|expires?)[^\n\d]{0,25}?(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/i);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; const dt = validDate(y, +m[2], +m[1]); if (dt) expiry = ymd(dt); }
    if (!expiry && (m = t.match(/(?:בתוקף|תוקף)[^\n]{0,30}?(\d+)\s*(שנים|שנה|חודשים|חודש|ימים|יום)/))) {
      const base = parseYmd(msgDate); const n = +m[1];
      if (/שנ/.test(m[2])) base.setFullYear(base.getFullYear() + n);
      else if (/חודש/.test(m[2])) base.setMonth(base.getMonth() + n);
      else base.setDate(base.getDate() + n);
      expiry = ymd(base);
    }
    if (!expiry && /(עד|בתוקף)[^\n]{0,20}סוף החודש/.test(t)) {
      const b = parseYmd(msgDate); expiry = ymd(new Date(b.getFullYear(), b.getMonth() + 1, 0));
    }
    const issuer = (t.match(/(?:^|[^A-Za-z])(BuyMe|BUYME|Dream Card|DREAM CARD|KSP|Ksp|Multipass|MULTIPASS)(?![A-Za-z])/) || [])[1]
      || (t.match(/(פיצה האט|שופרסל|מולטיפס|תו הזהב|ביימי)/) || [])[1]
      || (vdom ? domainOf(urls.find(u => VOUCHER_DOMAINS.test(domainOf(u)))).split('.')[0] : null)
      || (/ksp\.co\.il/.test(t) ? 'KSP' : null);
    const link = urls.length ? cleanUrl(urls[0]) : null;
    return { code, value, expiry, issuer: issuer || null, link };
  }

  // ---------- events ----------
  const EVENT_KW = /(נקבע לך תור|תור ל|פרטי התור|התור שקבעת|אזכרה|סדנה|לסדנה|ניפגשים|נפגשים|עלייה לתורה|הופעה|כנס|מפגש|appointment|meeting|summit|workshop)/i;
  function parseEvent(body, msgDate) {
    const t = clean(body);
    if (!EVENT_KW.test(t)) return null;
    const dates = findDates(t, msgDate).filter(d => d.date >= msgDate);
    let date = dates.length ? dates[dates.length - 1].date : weekdayDate(t, msgDate);
    const strong = /(תור|אזכרה|ניפגשים|נפגשים|סדנה|עלייה לתורה)/.test(t);
    if (!date && !strong) return null;
    return { date: date || null, time: date ? findTime(t) : null };
  }

  // ---------- categories & classifier ----------
  // Default categories (Hebrew UI). Ids are stable; names can be renamed per user.
  const CATEGORIES = [
    { id: 'inbox', name: 'לא ממוינים', color: 'slate', icon: 'inbox' },
    { id: 'todo', name: 'לעשות / לבדוק', color: 'teal', icon: 'check' },
    { id: 'expenses', name: 'הוצאות', color: 'green', icon: 'coin' },
    { id: 'vouchers', name: 'שוברים וקופונים', color: 'amber', icon: 'ticket' },
    { id: 'watch', name: 'לצפות אחר כך', color: 'rose', icon: 'play' },
    { id: 'dev', name: 'פיתוח וכלים', color: 'indigo', icon: 'code' },
    { id: 'notes', name: 'פתקים וקריאה', color: 'sky', icon: 'note' },
    { id: 'events', name: 'אירועים ותורים', color: 'violet', icon: 'calendar' },
    { id: 'orders', name: 'הזמנות וקבלות', color: 'brown', icon: 'receipt' },
    { id: 'promos', name: 'פרסומות ומבצעים', color: 'orange', icon: 'megaphone' },
    { id: 'personal', name: 'אישי / אחר', color: 'pink', icon: 'folder' }
  ];

  const TODO_VERBS = ['לברר', 'לבדוק', 'לנסות', 'להתקין', 'לקנות', 'לסיים', 'להוסיף', 'לעשות', 'לתקן', 'לחבר', 'לנקות', 'להירשם', 'למלא', 'לזרוק', 'להביא', 'לדבר', 'לעבור', 'להכנס', 'להיכנס', 'לסכם', 'לעדכן', 'להגדיר', 'לשנות', 'לשלוח', 'להזמין', 'לתאם', 'להעביר', 'לקבוע', 'לחפש', 'ללמוד', 'לממש', 'לבטל', 'לחדש', 'לסגור', 'להחליף', 'לסדר', 'לארגן', 'לכתוב', 'לצלם', 'להוריד', 'לקרוא', 'לראות', 'לשאול', 'להתקשר'];
  const TODO_LINE = new RegExp(`^(?:[-*•\\s]*)(${TODO_VERBS.join('|')})(?=[\\s.,:!?]|$)`);
  const TODO_EN = /^(?:[-*•\s]*)(todo|to do|to-do|check|try|install|buy|do it|star them|read|watch)\b/i;
  const ORDER_KW = /(הזמנתך|הזמנה מס|מספר הזמנה|מס' הזמנה|משלוח [A-Z]{2}\d|בדרכו לארץ|אישור ביצוע|אישור הזמנה|order (?:no|number|#)|your order|receipt|קבלה מס|התקבלה בהצלחה|בוצעה בהצלחה)/i;
  const PROMO_KW = /(להסרה|unsubscribe|להסרה השב|הסרה מרשימ|הטבה בלעדית|\d+%\s*הנחה|עד \d+% הנחה|referral|invitation|claim free|free months|free credits|הזמינו חברים|לקוחות \S+\?|רק בריאות)/i;
  const WATCH_PLAT = new Set(['tiktok', 'instagram', 'youtube', 'spotify']);
  const DEV_DOM = /(^|\.)(github\.com|n8n\.io|lovable\.app|claude\.com|claude\.ai|anthropic\.com|skilljar\.com|ts\.net|wondel\.ai|docker\.com|npmjs\.com|stackoverflow\.com|aws\.amazon\.com)$/;
  const DEV_KW = /\b(firebase|n8n|docker(?:-compose)?|tailscale|claude(?: code)?|flutter|kotlin|sdk|api|mcp|jellyfin|proxmox|portainer|homelab|github|git|lsp|kiro|swagger|uptime kuma|antigravity|node\.?js|serverless|raspberry pi|jetkvm|torbox|cursor|copilot|webhook|json|regex|ssh|nas|synology|vpn)\b/i;

  function wordsWithoutUrls(t) { return clean(t).replace(URL_RE, ' ').split(/\s+/).filter(Boolean); }

  function ruleMatches(rule, item) {
    if (!rule || rule.enabled === false || !rule.pattern) return false;
    const text = (item.body || '') + ' ' + (item.docName || '');
    const p = rule.pattern;
    try {
      switch (rule.match) {
        case 'domain': return findUrls(text).some(u => { const d = domainOf(u); const q = p.toLowerCase().replace(/^www\./, ''); return d === q || d.endsWith('.' + q); });
        case 'starts': return searchNorm(text).trim().startsWith(searchNorm(p).trim());
        case 'regex': return new RegExp(p, 'i').test(text);
        default: return searchNorm(text).includes(searchNorm(p));
      }
    } catch (e) { return false; }
  }

  // returns {category, type, auto, labels, fields:{expense|voucher|event|link}}
  function classify(item, rules = []) {
    const body = item.body || '';
    const t = clean(body);
    const urls = findUrls(t);
    const words = wordsWithoutUrls(t);
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const fields = {};
    const linkInfo = urls.length ? (() => { const clean1 = cleanUrl(urls[0]); const d = domainOf(clean1); return { url: clean1, original: urls[0], domain: d, platform: platformOf(d), count: urls.length }; })() : null;
    if (linkInfo) fields.link = linkInfo;
    const linkDominant = linkInfo && words.length <= 8 && lines.length <= 3;

    const out = (category, type, auto = true, extraLabels = []) => ({ category, type, auto, labels: extraLabels, fields });

    // 1. user rules
    let ruleCat = null; const ruleLabels = [];
    for (const r of rules) if (ruleMatches(r, item)) { if (!ruleCat && r.category) ruleCat = r.category; for (const l of (r.labels || [])) if (!ruleLabels.includes(l)) ruleLabels.push(l); }

    // type-specific field extraction always runs so a user-rule category still gets rich cards
    const exp = item.media ? null : parseExpense(body);
    if (exp) fields.expense = exp;
    const vou = !exp ? parseVoucher(body, item.date) : null;
    if (vou) fields.voucher = vou;
    const ev = !exp && !vou ? parseEvent(body, item.date) : null;
    if (ev) fields.event = ev;

    const typeFor = cat => {
      if (cat === 'expenses' || (exp && !ruleCat)) return exp ? 'expense' : 'note';
      if (fields.voucher && (cat === 'vouchers')) return 'voucher';
      if (fields.event && (cat === 'events')) return 'event';
      if (cat === 'todo') return 'todo';
      if (linkDominant) return 'link';
      return 'note';
    };

    if (ruleCat) return out(ruleCat, typeFor(ruleCat), true, ruleLabels);
    if (exp) return out('expenses', 'expense', true, ruleLabels);
    if (vou) return out('vouchers', 'voucher', true, ruleLabels);
    if (ev) return out('events', 'event', true, ruleLabels);
    const firstTodo = lines.length && (TODO_LINE.test(lines[0]) || TODO_EN.test(lines[0])) && t.length <= 300;
    if (firstTodo) return out('todo', 'todo', true, ruleLabels);
    if (linkInfo && /spotify\.com$/.test(linkInfo.domain) && /\/(premium|referral)/.test(linkInfo.url)) return out('promos', 'link', true, ruleLabels);
    if (ORDER_KW.test(t) || (item.docName && /(אישור|receipt|invoice|חשבונית|קבלה)/i.test(item.docName))) return out('orders', linkDominant ? 'link' : 'note', true, ruleLabels);
    if (PROMO_KW.test(t)) return out('promos', linkDominant ? 'link' : 'note', true, ruleLabels);
    const scanLines = t.length <= 300 ? lines : lines.slice(0, 1);
    if (scanLines.some(l => TODO_LINE.test(l) || TODO_EN.test(l)) || /לברר/.test(t.length <= 300 ? t : lines[0] || '')) return out('todo', 'todo', true, ruleLabels);
    if (linkDominant && WATCH_PLAT.has(linkInfo.platform)) return out('watch', 'link', true, ruleLabels);
    if ((linkInfo && DEV_DOM.test(linkInfo.domain)) || DEV_KW.test(t) || /^\s*[{[]/.test(t)) return out('dev', linkDominant ? 'link' : 'note', true, ruleLabels);
    if (t.length > 300 || lines.length >= 4) return out('notes', 'note', true, ruleLabels);
    return out('inbox', linkDominant ? 'link' : 'note', false, ruleLabels);
  }

  // ---------- reconciliation ----------
  // existing: Map id -> item (stored records, incl. aliases[])
  // returns plan {newItems:[], present:n, previouslyDeleted:n, edits:[{existingId, parsed}], dups:n, possibleEdits:n}
  function reconcile(parsedItems, existing, rules = []) {
    const alias = new Map();
    for (const it of existing.values()) { alias.set(it.id, it.id); for (const a of (it.aliases || [])) alias.set(a, it.id); }
    const inFile = new Set(parsedItems.map(p => p.id));
    // existing items by slot
    const bySlot = new Map();
    for (const it of existing.values()) {
      const slot = it.date + ' ' + it.time;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot).push(it);
    }
    const firstOfKey = new Map();
    for (const p of parsedItems) if (p.occ === 0) firstOfKey.set(p.date + '\n' + p.key, p.id);
    const candidatesBySlot = new Map();
    const res = { newItems: [], present: 0, previouslyDeleted: 0, edits: [], dups: 0, possibleEdits: 0, byCategory: {}, byType: {} };
    for (const p of parsedItems) {
      const hit = alias.get(p.id);
      if (hit) { const ex = existing.get(hit); if (ex && ex.status === 'purged') res.previouslyDeleted++; else res.present++; continue; }
      const slot = p.date + ' ' + p.time;
      if (!candidatesBySlot.has(slot)) candidatesBySlot.set(slot, []);
      candidatesBySlot.get(slot).push(p);
    }
    for (const [slot, cands] of candidatesBySlot) {
      const orphans = (bySlot.get(slot) || []).filter(it => !inFile.has(it.id) && !(it.aliases || []).some(a => inFile.has(a)) && it.status !== 'purged');
      if (cands.length === 1 && orphans.length === 1) { res.edits.push({ existingId: orphans[0].id, parsed: cands[0] }); continue; }
      for (const p of cands) {
        const c = classify(p, rules);
        const rec = buildRecord(p, c);
        if (p.occ > 0) { rec.flags.dup = true; rec.dupOf = alias.get(firstOfKey.get(p.date + '\n' + p.key)) || firstOfKey.get(p.date + '\n' + p.key) || null; res.dups++; }
        if (orphans.length) { rec.possibleEditOf = orphans.map(o => o.id); rec.flags.possibleEdit = true; res.possibleEdits++; }
        res.newItems.push(rec);
        res.byCategory[rec.category] = (res.byCategory[rec.category] || 0) + 1;
        res.byType[rec.type] = (res.byType[rec.type] || 0) + 1;
      }
    }
    return res;
  }

  function buildRecord(p, c) {
    return {
      id: p.id, date: p.date, time: p.time, seq: p.seq, sender: p.sender,
      raw: p.raw, body: p.body, media: p.media, docName: p.docName, forwarded: p.forwarded,
      title: '', text: null, note: '',
      category: c.category, type: c.type, labels: c.labels || [],
      fields: c.fields || {},
      pinned: false, locked: false, color: null, done: false, watched: false, used: false,
      status: 'active',
      flags: { auto: !!c.auto, dup: false, possibleEdit: false, editedWA: false },
      possibleEditOf: null, dupOf: null, importId: null
    };
  }

  return {
    hash, clean, normKey, searchNorm, ymd, parseYmd, pad,
    detectFormat, parseExport, stripMarkers,
    findUrls, cleanUrl, domainOf, platformOf,
    parseExpense, expenseGroup, parseVoucher, parseEvent, findDates, findTime,
    CATEGORIES, classify, ruleMatches, reconcile, buildRecord
  };
})();
export default Core;
