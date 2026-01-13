'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

const BASE_URL = '/api';
const PREFILL_EMAIL = 'testme0@gmail.com';
const PREFILL_PASSWORD = 'xplace1207';

export default function Home() {
  const [email, setEmail] = useState(PREFILL_EMAIL);
  const [password, setPassword] = useState(PREFILL_PASSWORD);
  const [accessToken, setAccessToken] = useState('');
  const [accessTokenHistory, setAccessTokenHistory] = useState<Array<{token: string; expMs: number | null; recordedAt: number}>>([]); 
  const [tokenExpiryMs, setTokenExpiryMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [refreshMessage, setRefreshMessage] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // In Next.js setup we store tokens in sessionStorage to persist across navigations
  useEffect(() => {
    const stored = sessionStorage.getItem('accessToken');
    if (stored) setAccessToken(stored);
  }, []);

  useEffect(() => {
    if (accessToken) {
      sessionStorage.setItem('accessToken', accessToken);
    }
  }, [accessToken]);

  // Tick every second to update countdown display.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const commonHeaders = useMemo(
    () => ({
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: accessToken ? `Bearer ${accessToken}` : undefined,
    }),
    [accessToken]
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setProjects([]);
    try {
      const res = await fetch(`${BASE_URL}/security/sign-in`, {
        method: 'POST',
        credentials: 'include', // needed so the XPL_RT cookie is set by the browser
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          userRegistrationMethod: 'REG_ON_JOIN_MARKET_PAGE',
        }),
      });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (err) {
        body = null;
      }

      if (!res.ok) {
        const msg = body?.messages?.join(', ') || text || `Login failed`;
        throw new Error(`[${res.status}] ${msg}`);
      }

      const token = body?.user_info?.tokenDto?.accessToken;
      updateAccessToken(token);
      setRefreshMessage('Login succeeded. XPL_RT cookie set by server (HttpOnly, not readable via JS).');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshAccessToken = async () => {
    setError('');
    setRefreshMessage('');
    try {
      const res = await fetch(`${BASE_URL}/security/refresh`, {
        method: 'POST',
        credentials: 'include', // sends XPL_RT cookie
        headers: {
          accept: 'application/json',
        },
      });

      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        parsed = null;
      }

      if (!res.ok) {
        const message = parsed?.messages?.join(', ') || `Refresh failed`;
        throw new Error(`[${res.status}] ${message}`);
      }

      const token = parsed?.accessToken;
      updateAccessToken(token);
      setRefreshMessage('Access token refreshed. XPL_RT cookie expiry is not exposed to JS (HttpOnly).');
      return token;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshAccessToken();
    } finally {
      setLoading(false);
    }
  };

  const handleGetProjects = async () => {
    setError('');
    setProjects([]);
    setLoading(true);
    let attemptedRefresh = false;
    try {
      const search = new URLSearchParams({ page: String(page), size: String(size) });
      const res = await fetch(`${BASE_URL}/projects?${search.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          ...commonHeaders,
        },
      });
      if (res.ok) {
        const body = await res.json();
        const items = Array.isArray(body) ? body : body?.content || body?.projects || [];
        setProjects(items);
        return;
      }

      // If expired and server returns 500, attempt refresh once then retry.
      if (res.status === 500 && !attemptedRefresh) {
        attemptedRefresh = true;
        const newToken = await refreshAccessToken();
        const retryHeaders = {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: newToken ? `Bearer ${newToken}` : undefined,
        };
        const retryRes = await fetch(`${BASE_URL}/projects?${search.toString()}`, {
          method: 'GET',
          credentials: 'include',
          headers: retryHeaders,
        });
        if (!retryRes.ok) {
          const retryBody = await retryRes.json().catch(() => ({}));
          throw new Error(`[${retryRes.status}] ${retryBody?.messages?.join(', ') || `Projects failed`}`);
        }
        const retryBody = await retryRes.json();
        const items = Array.isArray(retryBody) ? retryBody : retryBody?.content || retryBody?.projects || [];
        setProjects(items);
        return;
      }

      const body = await res.json().catch(() => ({}));
      throw new Error(`[${res.status}] ${body?.messages?.join(', ') || `Projects failed`}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateAccessToken = (token: string) => {
    setAccessToken(token || '');
    const expMs = token ? getExpiryMs(token) : null;
    setTokenExpiryMs(expMs);
    setAccessTokenHistory((prev) => {
      if (!token) return prev;
      const next = [{ token, expMs, recordedAt: Date.now() }, ...prev];
      return next.slice(0, 3);
    });
  };

  const getExpiryMs = (token: string): number | null => {
    try {
      const [, payload] = token.split('.');
      const decoded = JSON.parse(atob(payload));
      if (decoded?.exp) {
        return decoded.exp * 1000;
      }
    } catch (err) {
      // ignore parse errors
    }
    return null;
  };

  const formatRemaining = () => {
    if (!tokenExpiryMs) return 'n/a';
    const remainingMs = tokenExpiryMs - nowMs;
    if (remainingMs <= 0) return 'expired';
    const totalSec = Math.floor(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDate = (value: any) => {
    if (!value) return 'n/a';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'n/a';
    return d.toLocaleString();
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1>XPL Test Login</h1>
        <form className={styles.form} onSubmit={handleLogin}>
          <label className={styles.label}>
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button className={`${styles.primary} ${styles.btnLogin}`} type="submit" disabled={loading}>
            {loading ? 'Working…' : 'Login (/security/sign-in)'}
          </button>
        </form>

        <div className={styles.actions}>
          <button onClick={handleRefresh} disabled={loading} className={styles.btnRefresh}>
            Refresh token (/security/refresh)
          </button>
          <button onClick={handleGetProjects} disabled={loading || !accessToken} className={styles.btnProjects}>
            Get user projects (/projects)
          </button>
        </div>

        <div className={styles.queryRow}>
          <label className={`${styles.label} ${styles.inline}`}>
            Page
            <input
              type="number"
              min={0}
              value={page}
              onChange={(e) => setPage(Number(e.target.value) || 0)}
            />
          </label>
          <label className={`${styles.label} ${styles.inline}`}>
            Size
            <input
              type="number"
              min={1}
              value={size}
              onChange={(e) => setSize(Number(e.target.value) || 10)}
            />
          </label>
        </div>

        {accessToken ? (
          <div className={styles.token}>
            <div className={styles.tokenLabel}>Access Token</div>
            <textarea readOnly value={accessToken} />
            <div className={styles.expiryRow}>
              <div>Expires at: {tokenExpiryMs ? new Date(tokenExpiryMs).toLocaleString() : 'unknown'}</div>
              <div className={`${styles.pill} ${styles.subtle}`}>Countdown: {formatRemaining()}</div>
            </div>
          </div>
        ) : (
          <div className={styles.muted}>Access token not set.</div>
        )}

        {accessTokenHistory.length > 0 && (
          <div className={styles.history}>
            <div className={styles.tokenLabel}>Recent Access Tokens</div>
            <ul>
              {accessTokenHistory.map((entry, idx) => (
                <li key={entry.recordedAt}>
                  <span className={styles.pill}>{idx + 1}</span>
                  <span className={styles.tokenSnippet}>{entry.token.slice(0, 24)}…</span>
                  <span className={`${styles.muted} ${styles.smallText}`}>
                    exp: {entry.expMs ? new Date(entry.expMs).toLocaleTimeString() : 'n/a'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {refreshMessage && <div className={styles.info}>{refreshMessage}</div>}
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.projects}>
          <div className={styles.tokenLabel}>Projects</div>
          {projects.length === 0 ? (
            <div className={styles.muted}>No projects loaded yet.</div>
          ) : (
            <ul>
              {projects.map((p: any, idx: number) => (
                <li key={p?.id || idx}>
                  <div className={styles.projectMain}>
                    <strong>{p?.name || 'Unnamed project'}</strong>
                    {p?.id ? <span className={styles.pill}>ID: {p.id}</span> : null}
                    <span className={`${styles.pill} ${styles.subtle}`}>#{idx + 1}</span>
                  </div>
                  {p?.projectCategories?.length > 0 && (
                    <div className={styles.projectCategories}>
                      {p.projectCategories.map((cat: any, catIdx: number) => (
                        <span key={catIdx} className={`${styles.pill} ${styles.category}`}>
                          {cat?.nameHe || cat?.name || 'Unknown'}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.projectMeta}>
                    <span>Created: {formatDate(p?.creationDate || p?.createdAt)}</span>
                    <span>Expires: {formatDate(p?.expiryDate || p?.expirationDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={`${styles.muted} ${styles.smallText}`}>
          Note: XPL_RT is an HttpOnly cookie set by the API. Browsers will send it automatically on
          subsequent requests with credentials included, but JavaScript cannot read its value or expiry.
        </div>
      </div>
    </div>
  );
}
