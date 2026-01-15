export default async function handler(req, res) {
  const { path, ...queryParams } = req.query;
  const fullPath = Array.isArray(path) ? path.join('/') : path;
  
  // Build query string from remaining query parameters (excluding 'path')
  const queryString = new URLSearchParams(queryParams).toString();
  const url = `https://xpltestdev.click/app/v1/${fullPath}${queryString ? '?' + queryString : ''}`;
  
  console.log(`[Proxy] ${req.method} ${url}`);
  console.log('[Proxy] Authorization:', req.headers.authorization ? 'Bearer ' + req.headers.authorization.substring(7, 30) + '...' : 'none');

  try {
    // Prepare headers - forward cookies and authorization from the client
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    
    // Forward cookies from the client to the backend
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }
    
    // Forward Authorization header (Bearer token)
    if (req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    }
    
    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.text();
    
    // Copy all response headers
    response.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (lowerName !== 'content-encoding' && 
          lowerName !== 'transfer-encoding') {
        res.setHeader(name, value);
      }
    });

    res.status(response.status);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
