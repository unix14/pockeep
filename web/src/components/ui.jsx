import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { isRtl } from '../i18n/index.js';
import { t } from '../i18n/index.js';

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, footer, size = '', labelledBy, initialFocus = true }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey, true);
    const prev = document.activeElement;
    if (initialFocus) setTimeout(() => ref.current?.querySelector('[data-autofocus], input, textarea, select, button')?.focus(), 0);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose, initialFocus]);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`dlg ${size}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} aria-labelledby={labelledBy} ref={ref}>
        {title !== null && (
          <div className="dlg-head">
            <h2>{title}</h2>
            <button className="iconbtn" onClick={onClose} aria-label={t('סגירה')}><Icon name="close" /></button>
          </div>
        )}
        {children}
        {footer && <div className="dlg-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Popover menu anchored to an element or point ---------- */
export function Popover({ anchor, onClose, children, width = 240 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });
  useLayoutEffect(() => {
    const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    // align with the anchor's start edge (right in RTL, left in LTR)
    let left = Math.min(Math.max(8, isRtl() ? r.right - w : r.left), vw - w - 8);
    let top = r.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [anchor]);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target) && !(anchor instanceof Element && anchor.contains(e.target))) onClose(); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('touchstart', down); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', onClose); };
  }, [anchor, onClose]);
  return <div className="menu" ref={ref} style={{ top: pos.top, left: pos.left, minWidth: width }} role="menu">{children}</div>;
}

export function MenuItem({ icon, dot, children, onClick, checked, danger, disabled }) {
  return (
    <button className="mi" role="menuitem" onClick={onClick} disabled={disabled} style={danger ? { color: 'var(--bad)' } : disabled ? { opacity: .45 } : undefined}>
      {dot ? <span className="dot" style={{ background: dot }} /> : icon ? <Icon name={icon} size="sm" /> : null}
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {checked ? <span className="chk"><Icon name="check" size="sm" /></span> : null}
    </button>
  );
}

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((message, opts = {}) => {
    clearTimeout(timer.current);
    const t = { id: Date.now(), message, ...opts };
    setToast(t);
    timer.current = setTimeout(() => setToast(cur => (cur?.id === t.id ? null : cur)), opts.duration || (opts.action ? 7000 : 4000));
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span style={{ flex: 1 }}>{toast.message}</span>
          {toast.action && <button onClick={() => { setToast(null); toast.action.run(); }}>{toast.action.label}</button>}
          <button onClick={() => setToast(null)} aria-label={t('סגירת ההודעה')} style={{ color: '#aab3ad', padding: 6 }}><Icon name="close" size="sm" /></button>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

/* ---------- Confirm dialog (promise based) ---------- */
const ConfirmCtx = createContext(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const confirm = useCallback(opts => new Promise(resolve => setReq({ ...opts, resolve })), []);
  const done = v => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {req && (
        <Modal title={req.title} onClose={() => done(false)} size="narrow" footer={<>
          <button className="btn ghost" onClick={() => done(false)}>{req.cancel || t('ביטול')}</button>
          <button className={`btn ${req.danger ? 'danger solid' : 'primary'}`} onClick={() => done(true)} data-autofocus>{req.confirm || t('אישור')}</button>
        </>}>
          <div className="dlg-body"><div style={{ color: 'var(--fg-2)', whiteSpace: 'pre-line' }}>{req.body}</div></div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function Spinner() { return <div className="spinner" role="progressbar" aria-label={t('טוען')} />; }
