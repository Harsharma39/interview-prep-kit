# Interview Preparation Kit

## Overview

Interview Preparation Kit turns a pasted job description, company website, and available preparation days into a structured interview-preparation kit. It produces a sourced company brief, role requirements, questions, flashcards, a day-by-day schedule, and a practice/confidence workflow.

The app researches the supplied company site and attempts to find public interview-process material. Missing public process evidence is represented as an absence; it is never turned into invented company hiring stages.

## Tech stack

- Frontend: React (Create React App) and CSS
- Backend: Node.js and Express
- Database: MongoDB with Mongoose
- Authentication: HTTP-only JWT session cookie
- Optional AI provider: Google Gemini API
- Research: server-side HTML crawler plus public interview-process discovery

The assessment preference was Next.js and Tailwind. This project uses React because it is an authenticated client-side workflow with no server-rendering or SEO requirement; Express remains independently deployable as the API.

## Architecture

```text
JD + company URL + days
        |
        v
company crawl + public interview-process lookup
        |
        v
JD requirement extraction
        |
        v
candidate question / flashcard generation
        |
        v
deterministic coverage check -> targeted second pass when needed
        |
        v
deterministic schedule -> Appendix A validation -> persistence or batch output
```

The LLM may suggest candidate content. Application code owns requirement-ID coverage, the second-pass decision, schedule construction, and final schema validation. The web API and batch evaluator both call the same `generateKit` service.

## Project structure

```text
client/                 React interface
  src/                  views, builder controls, practice UI
server/
  batch/                Appendix B evaluator entry point
  controllers/          authenticated API handlers
  middleware/           auth and rate limiting
  models/               Mongoose documents
  routes/               Express route definitions
  schemas/              Appendix A validation
  services/             research, generation, coverage, scheduler, builder merge
  test/                 Node test suite
```

## Prerequisites

- Node.js 18+ (the backend uses the built-in Fetch API)
- npm
- MongoDB for the authenticated web application
- A reachable company URL for live generation

Gemini is optional. Without `GEMINI_API_KEY`, generation uses the deterministic fallback.

## Installation

From a clean clone:

```sh
npm --prefix server ci
npm --prefix client ci
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Set secure local values in `server/.env`; do not commit either `.env` file.

## Environment variables

Server variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port; defaults to `3000`. |
| `MONGODB_URI` | MongoDB connection URI for the web API. |
| `JWT_SECRET` | Long random secret used to sign session JWTs. |
| `CLIENT_ORIGIN` | Allowed browser origin; defaults to `http://localhost:3001`. |
| `NODE_ENV` | Use `production` in deployed environments to enable secure cookies. |
| `COOKIE_SAME_SITE` | Cookie SameSite policy; defaults to `Lax`. |
| `JSON_BODY_LIMIT` | Optional Express JSON body limit; defaults to `1mb`. |
| `GEMINI_API_KEY` | Optional Gemini credential. |
| `GEMINI_MODEL` | Optional Gemini model override. |
| `PUBLIC_INTERVIEW_RESEARCH` | Set `false` to disable optional public-process lookup, useful for offline tests. |
| `ALLOW_PRIVATE_RESEARCH` | Set `true` only for trusted direct research integration tests. Never enable it in production. |
| `SKIP_DB` | Test/development escape hatch that skips the database connection. |

Client variables:

| Variable | Purpose |
| --- | --- |
| `REACT_APP_API_URL` | Optional API base URL; defaults to `http://localhost:3000/api`. |

`REACT_APP_BACKEND_URL` is not used by this application. CRA embeds `REACT_APP_*` values at build time, so set `REACT_APP_API_URL` in the frontend host before each production build; it is not a runtime secret.

## Deployment

The simplest supported production shape keeps the existing separation: a static React build, a Node/Express API, and a hosted MongoDB-compatible database. The recommended path is **Vercel** for `client/`, **Render** for `server/`, and **MongoDB Atlas** (or an equivalent managed MongoDB provider). No platform-specific code is required by the API.

### Environment matrix

| Component | Variable | Classification | Production value / behavior |
| --- | --- | --- | --- |
| Backend | `PORT` | Platform-provided | Render assigns this automatically. The API listens on it. |
| Backend | `MONGODB_URI` | Required | Hosted MongoDB connection string. Never commit it. |
| Backend | `JWT_SECRET` | Required | Unique, long random secret. Startup rejects a missing value. |
| Backend | `NODE_ENV` | Required | `production`. Enables `Secure` session cookies. |
| Backend | `CLIENT_ORIGIN` | Required | Exact deployed frontend origin, such as the actual Vercel URL. Comma-separate exact origins only when intentionally supporting more than one. |
| Backend | `COOKIE_SAME_SITE` | Required for cross-site frontend/API deployments | `None` when frontend and API are on different sites; otherwise `Lax` is suitable. `None` requires HTTPS and production enables `Secure`. |
| Backend | `JSON_BODY_LIMIT` | Optional | Bounded JSON limit; defaults to `1mb`. |
| Backend | `GEMINI_API_KEY` | Optional | Enables Gemini generation; deterministic fallback remains available when absent or unavailable. |
| Backend | `GEMINI_MODEL` | Optional | Gemini model override. |
| Backend | `PUBLIC_INTERVIEW_RESEARCH` | Optional | Keep `true` to attempt public interview-process research; use `false` only for controlled/offline runs. |
| Backend | `ALLOW_PRIVATE_RESEARCH` | Evaluator/test-only | Leave unset or `false` in production. It must never be `true` on a public API. |
| Backend | `SKIP_DB` | Test-only | Do not set in deployment. |
| Frontend | `REACT_APP_API_URL` | Required for separate production API | Exact HTTPS API base URL including `/api`, for example `https://<actual-api-host>/api`. |

### Backend deployment (Render)

Create a Node web service with `server/` as its root directory.

```text
Install command: npm ci
Build command:   (leave empty)
Start command:   npm start
Health check:    /api/health
```

Set the backend variables from the matrix. The service must be able to reach the hosted MongoDB deployment; allow the provider's outbound IP/network access in the database configuration. The API does not use local files or local MongoDB in production. Startup fails clearly when the required production configuration or database connection is unavailable.

### Frontend deployment (Vercel)

Create a static Vercel project with `client/` as its root directory.

```text
Install command: npm ci
Build command:   npm run build
Output directory: build
```

Set `REACT_APP_API_URL` to the final HTTPS API URL ending in `/api`, then build/redeploy. [client/vercel.json](client/vercel.json) supplies the SPA fallback required by the application’s browser-history routes.

### Authentication and CORS

Authentication uses an HTTP-only JWT session cookie, not localStorage or an Authorization header. Browser requests include `credentials: 'include'`. CORS accepts only `CLIENT_ORIGIN` values and never uses wildcard origins with credentials; preflight supports the app’s GET/POST/PATCH/DELETE requests.

For separate Vercel and Render sites, use HTTPS, set `CLIENT_ORIGIN` to the exact frontend URL, and set `COOKIE_SAME_SITE=None`. The API adds `Secure` in `NODE_ENV=production`. For a same-site custom-domain deployment, `COOKIE_SAME_SITE=Lax` may be retained. On every configuration change, test register, login, authenticated kit access, and logout in a real browser.

### Production checklist

1. Provision MongoDB and add its connection string as `MONGODB_URI`.
2. Deploy the API with `NODE_ENV=production`, a generated `JWT_SECRET`, `CLIENT_ORIGIN`, `COOKIE_SAME_SITE`, and `ALLOW_PRIVATE_RESEARCH=false`.
3. Confirm `GET https://<api-host>/api/health` returns `status: ok`.
4. Configure the frontend’s `REACT_APP_API_URL`, deploy the React build, then update `CLIENT_ORIGIN` with the final frontend origin.
5. Verify registration/login, kit generation, research failure handling, builder/regeneration, flashcard practice, and logout over HTTPS.
6. Keep the batch evaluator local/CI runnable with `npm run evaluate -- --input <cases.json> --output <kits.json>`; it is not a web endpoint.

### Submission handoff

Before submitting, create a Git repository with meaningful commits, push it to the required GitHub location, deploy the frontend and API using the steps above, and record a 3–4 minute walkthrough. The walkthrough should show kit creation, research/generation and coverage, edits and regeneration preservation, flashcard practice, schedule allocation, and the weak-spots feature. These delivery actions require the submitter's hosting, GitHub, and video-upload access and are not performed by this repository.

### Dependency audit status

`npm audit --omit=dev` reports zero backend production dependency vulnerabilities after the non-breaking Express/Mongoose and transitive lockfile updates. The frontend audit is dominated by the deprecated Create React App build/test toolchain; those packages are not shipped by the static build. The unused Axios package has been removed and non-breaking updates applied, but the remaining CRA toolchain advisories require a planned build-tool migration or upgrade rather than a forced production deploy change.

## Run locally

Start MongoDB, then run the API:

```sh
npm --prefix server run dev
```

In a second terminal run the client:

```sh
npm --prefix client start
```

The API defaults to `http://localhost:3000`; the React app normally runs at `http://localhost:3001` when port 3000 is occupied.

## Batch evaluator

The required command works from the repository root:

```sh
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Example input:

```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\n\nRequired: Node.js experience",
    "company_url": "http://localhost:8099/acme/",
    "days": 5
  }
]
```

Output uses the Appendix B envelope:

```json
{
  "version": "1.0",
  "generated_at": "2026-09-01T09:12:44.000Z",
  "kits": [
    { "id": "case-01", "status": "ok", "kit": {}, "error": null }
  ]
}
```

Appendix B localhost/loopback fixtures are supported by the evaluator without changing the public API's SSRF policy:

```sh
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Keep `ALLOW_PRIVATE_RESEARCH=false` in production. The evaluator uses the shared generation pipeline directly and does not require Express, authentication, or MongoDB.

## Testing

```sh
npm --prefix server test
CI=true npm --prefix client test -- --watchAll=false
npm --prefix client run build
```

The backend suite uses deterministic fixtures and mocked HTTP boundaries; it does not require public internet, Gemini credentials, or MongoDB.

## Core behavior

- Register, sign in, sign out, and access only owner-scoped kits.
- Create one kit or submit a batch of roles through the web API.
- Follow persisted generation states while research and generation run.
- Edit company briefs, questions, and flashcards; add/delete/reorder questions and flashcards.
- Regenerate company briefs, question categories, flashcards, or schedules.
- Preserve manual, edited, and pinned content during relevant regeneration; rebuild coverage and schedule after question changes.
- Practice flashcards one at a time, save confidence, prioritize lower-confidence cards, and inspect weak spots.

## API summary

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/kits`, `POST /api/kits/batch`, `GET /api/kits`, `GET /api/kits/:id`, `PATCH /api/kits/:id`, `DELETE /api/kits/:id`
- `POST /api/kits/:id/regenerate`
- Question builder: `POST /api/kits/:id/questions`, `PATCH`/`DELETE /api/kits/:id/questions/:questionId`, `POST /api/kits/:id/questions/reorder`
- Company brief: `PATCH /api/kits/:id/company-brief`
- Flashcards: `POST /api/kits/:id/flashcards`, `PATCH`/`DELETE /api/kits/:id/flashcards/:flashcardId`
- Practice: `GET /api/kits/:id/practice`, `POST /api/kits/:id/practice/confidence`, `GET /api/kits/:id/weak-spots`

All kit and practice routes require authentication and resolve ownership from the session.

## Appendix A contract

Every successful generated kit contains `source`, `company_brief`, `role`, `questions`, `flashcards`, `schedule`, and `coverage`. Requirement, question, and flashcard IDs are stable within a kit; question and flashcard references are validated; difficulty is 1–3; and the schedule contains exactly the requested number of days.

## Research, safety, and failure handling

The crawler discovers and ranks same-host links dynamically, resolves relative URLs, checks `robots.txt`, retries transient failures, caps response size, validates redirects, and blocks private network targets by default. Scraped pages, public-process sources, and JD content are untrusted reference material in the LLM prompt.

Partial research and unavailable public interview evidence are non-fatal. An unusable company target produces a structured failure. A failed targeted second pass retains the initial questions and truthful uncovered requirement IDs. Gemini failures fall back deterministically where possible.

## Design decisions

- Coverage is calculated from explicit requirement IDs, never model self-assessment.
- Scheduling is deterministic so every reference can be validated.
- Crawling discovers links rather than assuming fixed `/careers` paths.
- Public interview evidence is optional and never fabricated.
- The API and evaluator share one generation service.

## Known limitations

- Public interview-process discovery depends on a public search endpoint and gracefully reports no evidence when unavailable.
- Live Gemini behavior depends on provider availability and rate limits.
- Automated tests mock external HTTP and provider boundaries rather than relying on live services.
- Deployment configuration and a public deployment URL are not included in this repository yet.
