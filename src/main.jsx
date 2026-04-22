import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/base.css';
import './styles/themes.css';

// Lightweight path-based route switch. No react-router so we don't add
// another dep just for three routes. If the path starts with /retro we
// load the retro SPA; if it starts with /admin/retro we load the
// narrator admin page; otherwise we fall through to the existing kiosk
// App (ambient + live).
// Visible error fallback — if the dynamic import or first render throws
// on some browser (looking at you, older iOS Safari), we don't want a
// silent black screen. Paint the actual error + userAgent into #root so
// we (or the user) can see what blew up rather than guessing remotely.
function paintError(where, err) {
  try {
    const root = document.getElementById('root');
    if (!root) return;
    const msg = err && (err.stack || err.message || String(err)) || 'unknown error';
    root.innerHTML = '';
    const box = document.createElement('pre');
    box.style.cssText = [
      'position:fixed', 'inset:0', 'margin:0', 'padding:16px',
      'background:#0a0e14', 'color:#ffc631', 'overflow:auto',
      'font:12px/1.4 ui-monospace,Menlo,monospace', 'white-space:pre-wrap',
      'z-index:99999',
    ].join(';');
    box.textContent =
      'VSFB /retro crashed at ' + where + '\n\n' +
      msg + '\n\n' +
      'ua: ' + (navigator.userAgent || '?') + '\n' +
      'path: ' + window.location.pathname;
    root.appendChild(box);
  } catch { /* last-ditch */ }
}
window.addEventListener('error', (e) => paintError('window.error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => paintError('unhandledrejection', e.reason));

async function mount() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  const path = window.location.pathname.replace(/\/+$/, '');

  if (path === '/admin/retro' || path === '/admin/retro/') {
    const { default: RetroAdmin } = await import('./components/retro/RetroAdmin.jsx');
    root.render(<React.StrictMode><RetroAdmin /></React.StrictMode>);
    return;
  }

  if (path.startsWith('/retro')) {
    const { default: RetroApp } = await import('./components/retro/RetroApp.jsx');
    root.render(<React.StrictMode><RetroApp /></React.StrictMode>);
    return;
  }

  const { default: App } = await import('./App.jsx');
  root.render(<React.StrictMode><App /></React.StrictMode>);
}

mount().catch((err) => paintError('mount', err));
