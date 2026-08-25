export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/');
    
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }

    if (parts.length < 3) {
      return new Response('Paw Proxy: Invalid URL structure. Expected /<site>/...', { status: 404 });
    }

    const sitePrefix = parts[1]; // 'pawchive', 'kemono', 'cum'
    const actualPath = '/' + parts.slice(2).join('/') + url.search;

    let domain = '';
    let fileDomain = '';
    
    if (sitePrefix === 'pawchive') {
      domain = 'https://pawchive.pw';
      fileDomain = 'https://file.pawchive.pw';
    } else if (sitePrefix === 'kemono') {
      domain = 'https://kemono.cr';
      fileDomain = 'https://kemono.cr';
    } else if (sitePrefix === 'cum') {
      domain = 'https://cum.st';
      fileDomain = 'https://cum.st';
    } else {
      return new Response('Paw Proxy: Unknown site prefix', { status: 404 });
    }

    let targetUrl = null;
    if (actualPath.startsWith('/api/')) {
      targetUrl = domain + actualPath;
    } else if (actualPath.startsWith('/file/data/')) {
      targetUrl = fileDomain + '/data/' + actualPath.substring(11);
    } else if (actualPath.startsWith('/icons/')) {
      targetUrl = domain + actualPath;
    } else {
      return new Response('Paw Proxy: Not Found', { status: 404 });
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');
    headers.set('Referer', domain + '/');
    
    // Kemono and Coomer require this header to bypass DDOS-Guard
    if (sitePrefix === 'kemono' || sitePrefix === 'cum') {
      headers.set('Accept', 'text/css');
    }
    
    // Follow redirects (kemono icons redirect to img.kemono.cr)
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      redirect: 'follow'
    });

    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.delete('set-cookie');
    newResponse.headers.delete('x-frame-options');
    
    return newResponse;
  }
};
