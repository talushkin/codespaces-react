import { useEffect, useMemo, useState } from 'react';
import './App.css';

const BASE_URL = '/api';
const PREFILL_EMAIL = 'testme0@gmail.com';
const PREFILL_PASSWORD = 'xplace1207';

function App() {
  const [email, setEmail] = useState(PREFILL_EMAIL);
  const [password, setPassword] = useState(PREFILL_PASSWORD);
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('accessToken') || '');
  const [accessTokenHistory, setAccessTokenHistory] = useState([]); // newest first
  const [tokenExpiryMs, setTokenExpiryMs] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [refreshMessage, setRefreshMessage] = useState('');
  const [projects, setProjects] = useState([]);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // In a Vite/React setup we store tokens in sessionStorage to mimic "session" semantics.
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

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setProjects([]);
    try {
      const res = await fetch(`${BASE_URL}/security/sign-in`, {
        method: 'POST',
        mode: 'cors',
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateAccessToken = (token) => {
    setAccessToken(token || '');
    const expMs = token ? getExpiryMs(token) : null;
    setTokenExpiryMs(expMs);
    setAccessTokenHistory((prev) => {
      if (!token) return prev;
      const next = [{ token, expMs, recordedAt: Date.now() }, ...prev];
      return next.slice(0, 3);
    });
  };

  const getExpiryMs = (token) => {
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

  const formatDate = (value) => {
    if (!value) return 'n/a';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return 'n/a';
    return d.toLocaleString();
  };

  return (
    <div className="page">
      <div className="card">
        <h1>XPL Test Login</h1>
        <form className="form" onSubmit={handleLogin}>
          <label className="label">
            Email
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </label>
          <label className="label">
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          <button className="primary btn-login" type="submit" disabled={loading}>
            {loading ? 'Working…' : 'Login (/security/sign-in)'}
          </button>
        </form>

        <div className="actions">
          <button onClick={handleRefresh} disabled={loading} className="btn-refresh">
            Refresh token (/security/refresh)
          </button>
          <button onClick={handleGetProjects} disabled={loading || !accessToken} className="btn-projects">
            Get user projects (/projects)
          </button>
        </div>

        <div className="query-row">
          <label className="label inline">
            Page
            <input
              type="number"
              min={0}
              value={page}
              onChange={(e) => setPage(Number(e.target.value) || 0)}
            />
          </label>
          <label className="label inline">
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
          <div className="token">
            <div className="token-label">Access Token</div>
            <textarea readOnly value={accessToken} />
            <div className="expiry-row">
              <div>Expires at: {tokenExpiryMs ? new Date(tokenExpiryMs).toLocaleString() : 'unknown'}</div>
              <div className="pill subtle">Countdown: {formatRemaining()}</div>
            </div>
          </div>
        ) : (
          <div className="muted">Access token not set.</div>
        )}

        {accessTokenHistory.length > 0 && (
          <div className="history">
            <div className="token-label">Recent Access Tokens</div>
            <ul>
              {accessTokenHistory.map((entry, idx) => (
                <li key={entry.recordedAt}>
                  <span className="pill">{idx + 1}</span>
                  <span className="token-snippet">{entry.token.slice(0, 24)}…</span>
                  <span className="muted small-text">
                    exp: {entry.expMs ? new Date(entry.expMs).toLocaleTimeString() : 'n/a'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {refreshMessage && <div className="info">{refreshMessage}</div>}
        {error && <div className="error">{error}</div>}

        <div className="projects">
          <div className="token-label">Projects</div>
          {projects.length === 0 ? (
            <div className="muted">No projects loaded yet.</div>
          ) : (
            <ul>
              {projects.map((p, idx) => (
                <li key={p?.id || idx}>
                  <div className="project-main">
                    <strong>{p?.name || 'Unnamed project'}</strong>
                    {p?.id ? <span className="pill">ID: {p.id}</span> : null}
                    <span className="pill subtle">#{idx + 1}</span>
                  </div>
                  {p?.projectCategories?.length > 0 && (
                    <div className="project-categories">
                      {p.projectCategories.map((cat, catIdx) => (
                        <span key={catIdx} className="pill category">
                          {cat?.nameHe || cat?.name || 'Unknown'}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="project-meta">
                    <span>Created: {formatDate(p?.creationDate || p?.createdAt)}</span>
                    <span>Expires: {formatDate(p?.expiryDate || p?.expirationDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="muted small-text">
          Note: XPL_RT is an HttpOnly cookie set by the API. Browsers will send it automatically on
          subsequent requests with credentials included, but JavaScript cannot read its value or expiry.
        </div>
      </div>
    </div>
  );
}

export default App;
