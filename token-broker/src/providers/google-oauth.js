const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CALLBACK_PATH = '/oauth/callback';

function requiredString(value, name, { min = 1, max = 8192 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw new RequestError(`Invalid ${name}.`);
  }
  return value;
}

class RequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestError';
    this.statusCode = 400;
  }
}

function validateRedirectUri(value) {
  const uri = requiredString(value, 'redirectUri', { max: 256 });
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new RequestError('Invalid redirectUri.');
  }

  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.pathname !== CALLBACK_PATH ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RequestError('redirectUri must be the app’s 127.0.0.1 OAuth callback URI.');
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RequestError('Invalid redirectUri port.');
  }
  return parsed.toString();
}

function verifyClientId(clientId, configuredClientId) {
  const supplied = requiredString(clientId, 'clientId', { max: 256 });
  if (!configuredClientId || supplied !== configuredClientId) {
    throw new RequestError('Unknown OAuth client.');
  }
  return supplied;
}

async function exchangeCode(input, config) {
  const clientId = verifyClientId(input.clientId, config.clientId);
  const code = requiredString(input.code, 'code', { max: 4096 });
  const codeVerifier = requiredString(input.codeVerifier, 'codeVerifier', { min: 43, max: 128 });
  if (!/^[A-Za-z0-9._~-]+$/.test(codeVerifier)) {
    throw new RequestError('Invalid codeVerifier.');
  }
  const redirectUri = validateRedirectUri(input.redirectUri);

  return requestToken({
    client_id: clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
}

async function refreshToken(input, config) {
  const clientId = verifyClientId(input.clientId, config.clientId);
  const refreshTokenValue = requiredString(input.refreshToken, 'refreshToken', { max: 8192 });

  return requestToken({
    client_id: clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshTokenValue,
  });
}

async function requestToken(parameters) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(parameters),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error('Google rejected the OAuth token request.');
      error.statusCode = 502;
      error.publicDetails = {
        provider: 'google',
        error: typeof body.error === 'string' ? body.error : 'token_exchange_failed',
        errorDescription:
          typeof body.error_description === 'string'
            ? body.error_description.slice(0, 500)
            : undefined,
      };
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Google token endpoint timed out.');
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { RequestError, exchangeCode, refreshToken };
