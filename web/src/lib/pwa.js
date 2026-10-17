let deferredPrompt = null;
const listeners = new Set();

if (typeof window !== 'undefined') {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    for (const fn of listeners) fn(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    for (const fn of listeners) fn(false);
  });
}

export function canInstall() { return !!deferredPrompt; }

export async function installApp() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') deferredPrompt = null;
  return outcome === 'accepted';
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
