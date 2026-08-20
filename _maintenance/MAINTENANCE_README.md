# MandIMMO temporary containment — Render/Node patch V3

## Scope
This overlay patches the **Render/Node application only**. It does not patch the separate Netlify static deployment. Do not treat production containment as complete until the exact live Netlify deploy source is independently closed or replaced.

This is an overlay, not a standalone application bundle. Apply these files to the existing MandIMMO application repository so the existing private `env.js` remains in place. Do not upload, overwrite, or expose secrets.

## Files
- `server.js` — fail-safe global maintenance gate
- `maintenance.html` — self-contained static holding page
- `maintenance_smoke_test.sh` — clean-session HTTP and header checks
- `ROUTE_INVENTORY.md` — complete Render route behaviour under maintenance

## Fail-safe switch
Protected functionality opens only when the deployed environment contains `MAINTENANCE_MODE=false` after trimming and case normalisation. Missing, blank, malformed, `true`, or an exception keeps containment active.

For the pause, set `MAINTENANCE_MODE=true` explicitly.

## Behaviour
- `GET /health` remains `200` for Render.
- Every request under `/api` or `/api/*` returns JSON `503` before authentication, body parsing, database access, email, Stripe, or visit logging.
- Every other path and HTTP method returns the holding page with `503`, `Retry-After: 3600`, `Cache-Control: no-store`, and `X-Robots-Tag: noindex, nofollow`.
- This closes present and future non-API routes by default, including confirmation links and public document routes.

## Deployment gate
1. Review the complete diff and route inventory.
2. Apply only to a Render preview/staging service first.
3. Set `MAINTENANCE_MODE=true` in preview.
4. Run `./maintenance_smoke_test.sh https://PREVIEW-URL` from a clean session.
5. Compare Supabase and Stripe state before and after the tests; confirm zero writes.
6. Patch the exact live Netlify source separately.
7. Repeat clean-session tests against the real public routing after both surfaces are contained.
8. Only then consider production containment verified.

## Reopening
Do not set `MAINTENANCE_MODE=false` until the live schema, tenancy repair, migration/quarantine, legal wording, and cross-account tamper tests are approved.
