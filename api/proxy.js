export default async function handler(req, res) {
  const { path } = req.query;
  const fullPath = Array.isArray(path) ? path.join('/') : path;
  
  const url = `https://xpltestdev.click/app/v1/${fullPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'xpltestdev.click',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
    });

    const data = await response.text();
    
    // Copy response headers
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'content-encoding') {
        res.setHeader(name, value);
      }
    });

    res.status(response.status);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
