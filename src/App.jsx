import { useEffect, useMemo, useState } from 'react';
import './App.css';

// Use hardcoded URL for local development, proxy for Vercel
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const BASE_URL = isLocal ? 'https://xpltestdev.click/app/v1' : '/api';
const PREFILL_EMAIL = 'testme0@gmail.com';
const PREFILL_PASSWORD = 'xplace1207';

// Budget range mapping based on projectBudgetRangeFacet
const getBudgetRangeText = (budgetCode) => {
  const ranges = {
    'BUDGET_0': 'Not defined',
    'BUDGET_1': 'Not defined',
    'BUDGET_2': 'Up to 2,500 ILS',
    'BUDGET_3': '2,500 - 5,000 ILS',
    'BUDGET_4': '5,000 - 10,000 ILS',
    'BUDGET_5': '10,000 - 25,000 ILS',
    'BUDGET_6': '25,000 - 50,000 ILS',
    'BUDGET_7': '50,000 - 100,000 ILS',
    'BUDGET_8': '100,000 - 250,000 ILS',
    'BUDGET_9': '250,000 - 500,000 ILS',
    'BUDGET_10': 'Above 500,000 ILS',
  };
  return ranges[budgetCode] || null;
};

function App() {
  const [email, setEmail] = useState(PREFILL_EMAIL);
  const [password, setPassword] = useState(PREFILL_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem('accessToken') || '');
  const [accessTokenHistory, setAccessTokenHistory] = useState([]); // newest first
  const [tokenExpiryMs, setTokenExpiryMs] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [refreshMessage, setRefreshMessage] = useState('');
  const [projects, setProjects] = useState([]);
  const [totalProjects, setTotalProjects] = useState(0);
  const [hasMoreProjects, setHasMoreProjects] = useState(true);
  const [projectsPayload, setProjectsPayload] = useState('');
  const [projectFilter, setProjectFilter] = useState('RECENT'); // 'RECENT' or 'HISTORY'
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(999);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userData, setUserData] = useState({
    userId: '',
    firstName: '',
    lastName: '',
    userName: '',
    userType: '',
    companyAccountType: '',
    activePlan: '',
    lastLogin: '',
  });
  const [userCategories, setUserCategories] = useState([]);
  const [sortBy, setSortBy] = useState('default'); // 'default', 'creationDate', 'expiryDate', 'price'

  // Clear both localStorage and sessionStorage on page reload
  useEffect(() => {
    localStorage.removeItem('accessToken');
    sessionStorage.removeItem('accessToken');
    setAccessToken('');
  }, []);

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
      // Do NOT send authorization header on login - only credentials
      const res = await fetch(`${BASE_URL}/security/sign-in`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include', // needed so the XPL_RT cookie is set by the browser
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          // Explicitly NOT sending any authorization header
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

      console.log('Login response tokenDto:', body?.user_info?.tokenDto);
      
      // Handle both cases: tokenDto.accessToken (object) or tokenDto itself (string)
      let token;
      const tokenDto = body?.user_info?.tokenDto;
      if (typeof tokenDto === 'string') {
        // tokenDto is already the token string
        token = tokenDto;
      } else if (tokenDto && typeof tokenDto.accessToken === 'string') {
        // tokenDto is an object with accessToken property
        token = tokenDto.accessToken;
      } else {
        token = null;
      }
      
      console.log('Extracted token type:', typeof token, 'value:', token?.slice?.(0, 20) + '...' || token);
      updateAccessToken(token);
      
      // Extract and store user data from response
      let userType = '';
      let userDataObj = {};
      if (body?.user_info) {
        // Get userType from JWT token payload
        if (token) {
          try {
            const [, payload] = token.split('.');
            const decoded = JSON.parse(atob(payload));
            userType = decoded.accountType || '';
          } catch (err) {
            // ignore parse errors
          }
        }
        
        userDataObj = {
          userId: body.user_info.id || '',
          firstName: body.user_info.firstName || '',
          lastName: body.user_info.lastName || '',
          userName: body.user_info.username || '',
          userType: userType,
          companyAccountType: body.company_info?.companyAccountType || '',
          activePlan: body.user_info.activePlan || '',
          lastLogin: body.company_info?.lastLogin || '',
        };
        setUserData(userDataObj);
      }
      
      setRefreshMessage('✓ Login succeeded! User data loaded.');
      
      // Wait 1 second before loading data
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Automatically load projects based on user type
      if (userType === 'PROVIDER') {
        // For PROVIDER: first get categories, then fetch filtered projects from search
        await handleGetUserCategories(token);
        // Wait 1 second after getting categories before fetching projects
        await new Promise(resolve => setTimeout(resolve, 1000));
        await handleGetProjects(0, false, token, userType);
      } else {
        // For BUYER: just fetch regular projects
        await handleGetProjects(0, false, token, userType);
      }
    } catch (err) {
      setError(err.message);
      // Show error alert
      alert(`✗ Login Failed!\n\nError: ${err.message}`);
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
        const fullResponse = JSON.stringify(parsed || text, null, 2);
        throw new Error(`[${res.status}] ${message}\n\nFull API Response:\n${fullResponse}`);
      }

      console.log('Refresh response parsed:', parsed);
      const token = parsed?.accessToken;
      console.log('Refresh token type:', typeof token, 'value:', token?.slice?.(0, 20) + '...' || token);
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

  const clearAllData = () => {
    // Clear access token
    updateAccessToken('');
    // Clear token history
    setAccessTokenHistory([]);
    // Clear projects
    setProjects([]);
    setTotalProjects(0);
    setHasMoreProjects(true);
    setProjectsPayload('');
    // Clear user data
    setUserData({
      userId: '',
      firstName: '',
      lastName: '',
      userName: '',
      userType: '',
      companyAccountType: '',
      activePlan: '',
      lastLogin: '',
    });
    // Clear session storage
    sessionStorage.removeItem('accessToken');
    // Clear all cookies by setting them with empty values and past expiry
    document.cookie.split(';').forEach((c) => {
      const cookieName = c.split('=')[0].trim();
      if (cookieName) {
        // Clear with no domain/path
        document.cookie = `${cookieName}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
        // Also try with domain
        document.cookie = `${cookieName}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;domain=.xpltestdev.click;path=/;`;
      }
    });
  };

  const handleSignOut = async () => {
    setError('');
    setRefreshMessage('');
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/security/sign-out`, {
        method: 'POST',
        credentials: 'include', // sends cookies including XPL_RT
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          // Send bearer token in header
          ...(accessToken && { authorization: `Bearer ${accessToken}` }),
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
        const message = parsed?.messages?.join(', ') || text || 'Sign out failed';
        throw new Error(`[${res.status}] ${message}`);
      }

      // Clear all local data
      clearAllData();
      setRefreshMessage('Signed out successfully. All tokens, cookies, and projects cleared.');
      // Reload page after successful logout
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setError(err.message);
      // Still clear local data even if the request fails
      clearAllData();
    } finally {
      setLoading(false);
    }
  };

  const handleGetProjects = async (pageNum = 0, append = false, explicitToken = null, explicitUserType = null) => {
    setError('');
    if (!append) {
      setProjects([]);
      setTotalProjects(0);
      setHasMoreProjects(true);
      setPage(0);
    }
    setLoading(true);
    let attemptedRefresh = false;

    const fetchPage = async (authToken) => {
      let url;
      let search;
      
      // Use explicit userType if provided, otherwise fall back to state
      const currentUserType = explicitUserType || userData.userType;
      
      console.log('fetchPage - currentUserType:', currentUserType, 'userCategories:', userCategories.length);
      
      // Check user type to determine which endpoint to use
      if (currentUserType === 'PROVIDER') {
        // For PROVIDER, always use search endpoint
        search = new URLSearchParams({ page: String(pageNum), size: String(size), sb: 'true' });
        if (userCategories.length > 0) {
          // Include categories if available
          const categoryParams = userCategories.map(cat => `cat=${cat.id}`).join('&');
          url = `${BASE_URL}/search/projects_search?${categoryParams}&${search.toString()}`;
        } else {
          // No categories - use search without category filter
          url = `${BASE_URL}/search/projects_search?${search.toString()}`;
        }
      } else {
        // For BUYER or default, use regular projects endpoint
        search = new URLSearchParams({ page: String(pageNum), size: String(size) });
        url = `${BASE_URL}/projects?${search.toString()}`;
      }
      
      console.log('fetchPage - calling URL:', url);
      
      // Use the provided authToken, explicit token, or fall back to current accessToken
      const tokenToUse = authToken || explicitToken || accessToken;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(tokenToUse ? { authorization: `Bearer ${tokenToUse}` } : {}),
        },
      });

      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (err) {
        body = null;
      }

      if (!res.ok) {
        return { ok: false, body, status: res.status, text };
      }

      const payload = Array.isArray(body) ? body[0] || {} : body || {};
      
      // Handle different response formats
      let items;
      if (payload?.items) {
        // Search endpoint format - normalize to match projects format
        items = payload.items.map(item => ({
          id: item.projectId,
          projectId: item.projectId,
          name: item.name,
          title: item.name,
          description: item.description,
          creationDate: item.date_posted_facet,
          createdAt: item.date_posted_facet,
          expiryDate: item.expirationDate,
          expirationDate: item.expirationDate,
          projectDueDate: item.project_due_date,
          isHotProject: item.isHotProject || false,
          urgent: item.urgent || false,
          amount_pj: item.amount_pj || 0,
          budgetRange: item.projectBudgetRangeFacet,
          projectCategories: item.categories?.map(cat => ({
            id: cat.catId_facet,
            nameHe: cat.nameHe,
            nameEn: cat.nameEn,
            name: cat.nameHe || cat.nameEn
          })) || []
        }));
      } else {
        // Regular projects endpoint format
        items = payload?.projects || payload?.content || payload?.projectsList || (Array.isArray(body) ? body : []);
      }
      
      const totalCount =
        payload?.meta?.total ?? payload?.totalElements ?? payload?.totalCount ?? payload?.total ?? payload?.count ??
        (Array.isArray(body) ? body.length : items.length);

      // Show full response for debugging (use window.alert to avoid blocking issues)
      const payloadString = JSON.stringify(body ?? {}, null, 2);
      window.alert(payloadString);
      setProjectsPayload(payloadString);

      const newProjects = append ? [...projects, ...items] : items;
      setProjects(newProjects);
      setTotalProjects(totalCount || newProjects.length);
      const moreAvailable = totalCount ? newProjects.length < totalCount : true;
      setHasMoreProjects(moreAvailable);
      setPage(pageNum);
      return { ok: true };
    };

    try {
      // Pass explicitToken on first attempt to use the newly received token
      const firstAttempt = await fetchPage(explicitToken);
      if (firstAttempt.ok) return;

      if (!attemptedRefresh) {
        attemptedRefresh = true;
        const newToken = await refreshAccessToken();
        const retry = await fetchPage(newToken);
        if (retry.ok) return;
        const message = retry.body?.messages?.join(', ') || retry.text || 'Projects failed';
        throw new Error(`[${retry.status}] ${message}`);
      }

      const message = firstAttempt.body?.messages?.join(', ') || firstAttempt.text || 'Projects failed';
      throw new Error(`[${firstAttempt.status}] ${message}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateAccessToken = (token) => {
    console.log('updateAccessToken called with:', typeof token, token?.slice?.(0, 20) + '...' || token);
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
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const recentProjects = projects.filter((p) => {
    // If user is PROVIDER, show all search results as RECENT
    if (userData.userType === 'PROVIDER') return true;
    
    const expiryDate = p?.expiryDate || p?.expirationDate || p?.projectDueDate;
    if (!expiryDate) return true;
    
    // Compare dates only (strip time) - projects expiring today should go to HISTORY
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);
    
    return expiry > today;
  }).sort((a, b) => {
    // Sort hot projects first
    if (a.isHotProject && !b.isHotProject) return -1;
    if (!a.isHotProject && b.isHotProject) return 1;
    
    // Then apply user-selected sorting
    if (sortBy === 'creationDate') {
      const aDate = new Date(a.creationDate || a.createdAt || 0).getTime();
      const bDate = new Date(b.creationDate || b.createdAt || 0).getTime();
      return bDate - aDate; // newest first
    } else if (sortBy === 'expiryDate') {
      const aDate = new Date(a.expiryDate || a.expirationDate || a.projectDueDate || 0).getTime();
      const bDate = new Date(b.expiryDate || b.expirationDate || b.projectDueDate || 0).getTime();
      return aDate - bDate; // earliest expiry first
    } else if (sortBy === 'price') {
      const aPrice = a.amount_pj || 0;
      const bPrice = b.amount_pj || 0;
      return bPrice - aPrice; // highest price first
    }
    
    return 0;
  });

  const historyProjects = projects.filter((p) => {
    // If user is PROVIDER, don't show any in HISTORY
    if (userData.userType === 'PROVIDER') return false;
    
    const expiryDate = p?.expiryDate || p?.expirationDate || p?.projectDueDate;
    if (!expiryDate) return false;
    
    // Compare dates only (strip time) - projects expiring today should go to HISTORY
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate);
    expiry.setHours(0, 0, 0, 0);
    
    return expiry <= today;
  }).sort((a, b) => {
    // Sort hot projects first
    if (a.isHotProject && !b.isHotProject) return -1;
    if (!a.isHotProject && b.isHotProject) return 1;
    
    // Then apply user-selected sorting
    if (sortBy === 'creationDate') {
      const aDate = new Date(a.creationDate || a.createdAt || 0).getTime();
      const bDate = new Date(b.creationDate || b.createdAt || 0).getTime();
      return bDate - aDate; // newest first
    } else if (sortBy === 'expiryDate') {
      const aDate = new Date(a.expiryDate || a.expirationDate || a.projectDueDate || 0).getTime();
      const bDate = new Date(b.expiryDate || b.expirationDate || b.projectDueDate || 0).getTime();
      return aDate - bDate; // earliest expiry first
    } else if (sortBy === 'price') {
      const aPrice = a.amount_pj || 0;
      const bPrice = b.amount_pj || 0;
      return bPrice - aPrice; // highest price first
    }
    
    return 0;
  });

  const filteredProjects = projectFilter === 'RECENT' ? recentProjects : historyProjects;

  const loadMoreProjects = () => {
    if (!loading && hasMoreProjects) {
      handleGetProjects(page + 1, true);
    }
  };

  const handleScroll = (e) => {
    const reachedBottom = e.target.scrollHeight - e.target.scrollTop <= e.target.clientHeight + 50;
    if (reachedBottom) {
      loadMoreProjects();
    }
  };

  const handleGetUserCategories = async (explicitToken = null) => {
    console.log('handleGetUserCategories called with explicitToken:', typeof explicitToken, explicitToken?.slice?.(0, 20) + '...' || explicitToken);
    setError('');
    setUserCategories([]);
    let attemptedRefresh = false;

    const fetchCategories = async (authToken) => {
      // Use the provided authToken, explicit token, or fall back to current accessToken
      const tokenToUse = authToken || explicitToken || accessToken;
      console.log('fetchCategories using token:', typeof tokenToUse, tokenToUse?.slice?.(0, 20) + '...' || tokenToUse);
      
      const authHeader = tokenToUse ? `Bearer ${tokenToUse}` : undefined;
      console.log('Authorization header:', authHeader?.slice?.(0, 30) + '...' || authHeader);
      
      const res = await fetch(`${BASE_URL}/core/categories_user`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(authHeader ? { authorization: authHeader } : {}),
        },
      });

      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch (err) {
        body = null;
      }

      if (!res.ok) {
        return { ok: false, body, status: res.status, text };
      }

      const categories = Array.isArray(body) ? body : [];
      
      // Only show alert when manually called (not during auto-load after login)
      if (projects.length === 0) {
        // Auto-load scenario - don't show alert
        console.log('User categories loaded:', categories);
      } else {
        // Manual button click - show alert
        const responseString = JSON.stringify(body, null, 2);
        window.alert(`User Categories Response:\n\n${responseString}`);
      }
      
      setUserCategories(categories);
      return { ok: true };
    };

    try {
      // Pass explicitToken on first attempt to use the newly received token
      const firstAttempt = await fetchCategories(explicitToken);
      if (firstAttempt.ok) return;

      if (!attemptedRefresh) {
        attemptedRefresh = true;
        const newToken = await refreshAccessToken();
        const retry = await fetchCategories(newToken);
        if (retry.ok) return;
        const message = retry.body?.messages?.join(', ') || retry.text || 'Get user categories failed';
        throw new Error(`[${retry.status}] ${message}`);
      }

      const message = firstAttempt.body?.messages?.join(', ') || firstAttempt.text || 'Get user categories failed';
      throw new Error(`[${firstAttempt.status}] ${message}`);
    } catch (err) {
      setError(err.message);
    }
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
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                style={{ paddingRight: '80px', width: '100%' }}
              />
              <button
                type="button"
                onClick={() => setPassword('')}
                style={{
                  position: 'absolute',
                  right: '40px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontSize: '1.2rem',
                  color: '#7bd7ff',
                }}
                title="Clear password"
              >
                ✕
              </button>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  fontSize: '1.2rem',
                  color: '#7bd7ff',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </label>
          <button className="primary btn-login" type="submit" disabled={loading}>
            {loading ? 'Working…' : 'Login (/security/sign-in)'}
          </button>
        </form>

        <div className="actions">
          <button onClick={handleRefresh} disabled={loading} className="btn-refresh">
            Refresh token (/security/refresh)
          </button>
          <button 
            onClick={() => handleGetProjects(0, false)} 
            disabled={loading || !accessToken} 
            className="btn-projects"
            style={userData.userType === 'PROVIDER' ? { backgroundColor: '#ff69b4', borderColor: '#ff69b4' } : {}}
          >
            {userData.userType === 'PROVIDER' 
              ? 'Get Filtered projects (/search)' 
              : 'Get user projects (/projects)'}
          </button>
          <button onClick={handleGetUserCategories} disabled={loading || !accessToken} className="btn-projects">
            Get user categories (/core/categories_user)
          </button>
          <button onClick={handleSignOut} disabled={loading} className="btn-signout">
            Sign out (/security/sign-out)
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

        {accessToken && (userData.firstName || userData.lastName || userData.userName || userData.userId) && (
          <div className="token">
            <div className="token-label">User Information</div>
            <ul>
              {userData.userId && (
                <li>
                  <span className="pill">User ID</span>
                  <span className="token-snippet">{userData.userId}</span>
                </li>
              )}
              {(userData.firstName || userData.lastName) && (
                <li>
                  <span className="pill">Name</span>
                  <span className="token-snippet">
                    {userData.firstName} {userData.lastName}
                  </span>
                </li>
              )}
              {userData.userName && (
                <li>
                  <span className="pill">Username</span>
                  <span className="token-snippet">{userData.userName}</span>
                </li>
              )}
              {userData.userType && (
                <li>
                  <span className="pill">User Type</span>
                  <span className="token-snippet" style={{ fontWeight: 'bold', color: userData.userType === 'PROVIDER' ? '#7bd7ff' : '#90EE90' }}>{userData.userType}</span>
                </li>
              )}
              {userData.companyAccountType && (
                <li>
                  <span className="pill">Company Type</span>
                  <span className="token-snippet">{userData.companyAccountType}</span>
                </li>
              )}
              {userData.activePlan !== '' && (
                <li>
                  <span className="pill">Active Plan</span>
                  <span className="token-snippet">{userData.activePlan ? 'Yes' : 'No'}</span>
                </li>
              )}
              {userData.lastLogin && (
                <li>
                  <span className="pill">Last Login</span>
                  <span className="token-snippet">{formatDate(userData.lastLogin)}</span>
                </li>
              )}
            </ul>
          </div>
        )}

        {userCategories.length > 0 && (
          <div className="token">
            <div className="token-label">User Categories ({userCategories.length})</div>
            <ul>
              {userCategories.map((category) => (
                <li key={category.id}>
                  <span className="pill">CAT_ID: {category.id}</span>
                  <span className="token-snippet">{category.nameHe || category.nameEn || 'N/A'}</span>
                  <span className="pill subtle">Industry: {category.industryId || 'N/A'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {accessTokenHistory.length > 0 && (
          <div className="history">
            <div className="token-label">Recent Access Tokens</div>
            <ul>
              {accessTokenHistory.map((entry, idx) => (
                <li key={entry.recordedAt}>
                  <span className="pill">{idx + 1}</span>
                  <span className="token-snippet">
                    {entry.token.length > 48
                      ? `${entry.token.slice(0, 24)}…${entry.token.slice(-20)}`
                      : entry.token}
                  </span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div
                className="token-label"
                title={projectsPayload || 'No projects payload loaded yet.'}
              >
                Projects ({filteredProjects.length}/{totalProjects || projects.length})
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setProjectFilter('RECENT')}
                  className={projectFilter === 'RECENT' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '6px 12px', fontSize: '0.9rem' }}
                >
                  RECENT ({recentProjects.length})
                </button>
                <button
                  onClick={() => setProjectFilter('HISTORY')}
                  className={projectFilter === 'HISTORY' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '6px 12px', fontSize: '0.9rem' }}
                >
                  HISTORY ({historyProjects.length})
                </button>
              </div>
            </div>
            
            {projects.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: '#999' }}>Sort by:</span>
                <button
                  onClick={() => setSortBy('default')}
                  className={sortBy === 'default' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  Default
                </button>
                <button
                  onClick={() => setSortBy('creationDate')}
                  className={sortBy === 'creationDate' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  Creation Date
                </button>
                <button
                  onClick={() => setSortBy('expiryDate')}
                  className={sortBy === 'expiryDate' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  Expiry Date
                </button>
                <button
                  onClick={() => setSortBy('price')}
                  className={sortBy === 'price' ? 'btn-projects' : 'subtle'}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  Price
                </button>
              </div>
            )}
          </div>
          {projects.length === 0 ? (
            <div className="muted">No projects loaded yet.</div>
          ) : filteredProjects.length === 0 ? (
            <div className="muted">No {projectFilter.toLowerCase()} projects found.</div>
          ) : (
            <div
              onScroll={handleScroll}
              style={{ maxHeight: '500px', overflowY: 'auto', paddingRight: '8px' }}
            >
              <ul>
                {filteredProjects.map((p, idx) => {
                  const projectId = p?.id ?? p?.projectId;
                  const title = p?.name ?? p?.title ?? 'Unnamed project';
                  const createdAt = p?.creationDate ?? p?.createdAt ?? p?.dateCreated;
                  const expiresAt = p?.expiryDate ?? p?.expirationDate ?? p?.projectDueDate;
                  const price = p?.amount_pj;
                  const budgetRangeText = p?.budgetRange ? getBudgetRangeText(p.budgetRange) : null;
                  return (
                    <li key={projectId || idx}>
                      <div className="project-main">
                        <strong>{title}</strong>
                        {p.isHotProject && (
                          <span className="pill" style={{ backgroundColor: '#ff4444', color: 'white', fontWeight: 'bold' }}>
                            🔥 HOT
                          </span>
                        )}
                        {projectId ? <span className="pill">ID: {projectId}</span> : null}
                        {budgetRangeText ? <span className="pill" style={{ backgroundColor: '#4CAF50', color: 'white' }}>{budgetRangeText}</span> : 
                         price ? <span className="pill" style={{ backgroundColor: '#4CAF50', color: 'white' }}>₪{price.toLocaleString()}</span> : null}
                        <span className="pill subtle">#{idx + 1}</span>
                      </div>
                      {p?.projectCategories?.length > 0 && (
                        <div className="project-categories">
                          {p.projectCategories.map((cat, catIdx) => (
                            <span key={catIdx} className="pill category">
                              {cat?.nameHe || cat?.name || cat?.nameEn || 'Unknown'}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="project-meta">
                        <span>Created: {formatDate(createdAt)}</span>
                        <span>Expires: {formatDate(expiresAt)}</span>
                      </div>
                    </li>
                  );
                })}
                {loading && projects.length > 0 && (
                  <li className="muted" style={{ textAlign: 'center', padding: '10px' }}>Loading more...</li>
                )}
                {!loading && projects.length > 0 && (
                  <li style={{ textAlign: 'center', padding: '10px' }}>
                    <button
                      type="button"
                      className="btn-projects"
                      style={{ width: '100%' }}
                      onClick={() => handleGetProjects(page + 1, true)}
                    >
                      Read more projects
                    </button>
                  </li>
                )}
                {!loading && !hasMoreProjects && projects.length > 0 && (
                  <li className="muted" style={{ textAlign: 'center', padding: '6px 10px' }}>
                    Reached total ({totalProjects || projects.length})
                  </li>
                )}
              </ul>
            </div>
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
