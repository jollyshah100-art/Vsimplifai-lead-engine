# Render/Node route inventory under maintenance — V3

## Remains available
- `GET /health` → `200` health response only.

## Closed by the API namespace gate
- Every HTTP method on `/api` and `/api/*` → JSON `503`.
- This covers all current API routes and any future route added under that namespace.

Current API routes found in `server.js`:
- `GET /api/admin/data`
- `GET /api/export.csv`
- `POST /api/signup`
- `POST /api/login`
- `GET /api/me`
- `POST /api/profile`
- `GET /api/capture-info`
- `POST /api/logout`
- `POST /api/forgot`
- `POST /api/reset`
- `POST /api/stripe/webhook`
- `GET /api/properties`
- `GET /api/leads`
- `GET /api/plans`
- `GET /api/config`
- `POST /api/optin`
- `POST /api/confirm`

## Closed by the global non-health gate
- Every other path and every HTTP method → HTML holding page with `503`.
- This includes the present UI routes, the consent-confirmation GET route, public PDF document routes, forgotten/static paths, and unknown future non-API routes.

Current non-API routes found in `server.js` include:
- `/`, `/index.html`
- `/admin`
- `/login`
- `/capture`
- `/reset`
- `/confirm`
- `/docs/deroule-pedagogique.pdf`
- `/docs/note-justificative.pdf`

## Ordering evidence
Inside the request handler, the order is:
1. Parse the URL only.
2. Allow `GET /health`.
3. Evaluate maintenance mode.
4. Return `503` for `/api`/`/api/*`, or return the `503` holding page for every other path.
5. Only after that point can normal authentication, request-body parsing, database access, email, Stripe, consent confirmation, document serving, or visit logging run.

## Startup nuance
Modules and environment configuration load when the Node process starts. The containment guarantee is that no **request-driven** auth, body parsing, data access, external API call, or logging occurs before the gate.
