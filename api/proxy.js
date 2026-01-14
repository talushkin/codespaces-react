export default async function handler(req, res) {
  const { path } = req.query;
  const fullPath = Array.isArray(path) ? path.join('/') : path;
  
  const url = `https://xpltestdev.click/app/v1/${fullPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

  try {
    // Prepare headers - forward cookies from the client
    const headers = {
      ...req.headers,
      host: 'xpltestdev.click',
    };
    
    // Remove headers that shouldn't be forwarded
    delete headers['content-length'];
    
    const response = await fetch(url, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      credentials: 'include', // Important: include cookies in the request
    });

    const data = await response.text();
    
    // Copy response headers, including Set-Cookie
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'content-encoding' && name.toLowerCase() !== 'transfer-encoding') {
        res.setHeader(name, value);
      }
    });

    res.status(response.status);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
