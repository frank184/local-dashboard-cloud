# Google OAuth token broker

This service handles Google’s authorization-code and refresh-token exchanges for the desktop app. The desktop app still starts OAuth with PKCE and its loopback redirect. It sends the resulting authorization code, original PKCE verifier, and exact redirect URI here; the broker adds the Google OAuth client secret and forwards the request to Google.

The service is stateless. It does not persist or log OAuth codes, verifiers, refresh tokens, access tokens, or request bodies. Tokens are returned to the caller so the desktop app can keep storing them in its local encrypted credential store.

## Configuration

Set these environment variables for local development:

- `GOOGLE_OAUTH_CLIENT_ID`: the Desktop OAuth client ID for Local Dashboard.
- `GOOGLE_OAUTH_CLIENT_SECRET`: the client secret for that same client, held only by this service.
- `PORT`: optional; defaults to `8080`.

Export the variables in your shell and run `npm start` from this directory. `.env.example` lists the expected local settings; the service uses Node’s built-in HTTP server and `fetch` and has no runtime dependencies.

## API

`GET /healthz` returns `{ "status": "ok" }`.

`POST /v1/oauth/google/exchange` accepts:

```json
{
  "clientId": "configured Google OAuth client ID",
  "code": "authorization code from Google",
  "codeVerifier": "the original PKCE verifier",
  "redirectUri": "http://127.0.0.1:49152/oauth/callback"
}
```

The response is Google’s token response. The broker only accepts the configured client ID and a loopback redirect URI on `127.0.0.1` with the app’s `/oauth/callback` path.

`POST /v1/oauth/google/refresh` accepts:

```json
{
  "clientId": "configured Google OAuth client ID",
  "refreshToken": "locally stored Google refresh token"
}
```

Both routes return `Cache-Control: no-store`. Provider errors are returned without logging submitted credentials.

## Deploy with Terraform

Use the [Terraform deployment guide](../terraform/README.md). Terraform provisions the runtime identity and Secret Manager binding; the Cloud Run GitHub wizard builds and deploys this folder, and Terraform imports the resulting service to manage its runtime settings. The real secret value never enters Terraform state.

The service must be reachable without Google IAM authentication because a distributed desktop app cannot safely contain a service-account credential. Treat the broker URL as a public OAuth relay. The implementation restricts exchanges to the configured client ID and loopback callback shape.

## Desktop app changes still needed

The app currently exchanges authorization codes and refresh tokens directly with Google. To use this broker, change those two calls to the corresponding broker routes and remove any desktop-side `client_secret` requirement. Keep the current PKCE verifier generation, state validation, loopback callback, token encryption, and local persistence. Configure the broker URL for the app separately from its public client ID.
