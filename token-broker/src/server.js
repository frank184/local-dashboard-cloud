const http = require('node:http');
const { exchangeCode, refreshToken } = require('./providers/google-oauth');

const MAX_BODY_BYTES = 16 * 1024;
const config = {
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

function hasRequiredConfig() {
  return Boolean(config.clientId && config.clientSecret);
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;

  if (request.method === 'GET' && path === '/healthz') {
    return sendJson(response, 200, { status: 'ok' });
  }

  const routes = {
    '/v1/oauth/google/exchange': () => exchangeCode,
    '/v1/oauth/google/refresh': () => refreshToken,
  };
  const routeFactory = routes[path];
  if (request.method !== 'POST' || !routeFactory) {
    return sendJson(response, 404, { error: 'not_found' });
  }
  if (!hasRequiredConfig()) {
    return sendJson(response, 503, { error: 'service_not_configured' });
  }
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    return sendJson(response, 415, { error: 'content_type_must_be_json' });
  }

  try {
    const input = await readJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 });
    }
    const operation = routeFactory();
    const result = await operation(input, config);
    return sendJson(response, 200, result);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    const body = error.publicDetails || {
      error: statusCode === 400 ? error.message : 'oauth_request_failed',
    };
    if (statusCode >= 500 && !error.publicDetails) {
      console.error('OAuth broker request failed:', error.message);
    }
    return sendJson(response, statusCode, body);
  }
});

const port = Number(process.env.PORT || 8080);
server.listen(port, '0.0.0.0', () => {
  console.log(`Token broker listening on ${port}`);
});
