import { useEffect, useState } from 'react';

export function AppFooter({ error, mode }) {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return (
    <footer className="app-footer">
      <span>
        sources: ll2 · flightclub · open-meteo · youtube
        <span className="dim"> · created by josh mcadams</span>
      </span>
      <span>
        <span className={online ? 'accent3' : 'warn'}>
          net {online ? 'ok' : 'offline'}
        </span>
        {error && <span className="warn"> · {error}</span>}
        <span className="dim"> · press T for themes · Y for layout</span>
      </span>
    </footer>
  );
}
