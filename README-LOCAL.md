# Running Victoria Unit Flow locally

This app was built on the Emergent platform and was wired to a hosted preview URL.
A few things had to be fixed before it could run on a normal machine — those fixes
are already applied (see [What I changed](#what-i-changed) at the bottom).

---

## TL;DR

```
1. Install MongoDB (see step 1 below)
2. Double-click  setup-local.bat      <- once, takes a few minutes
3. Double-click  start-backend.bat    <- leave running
4. Double-click  start-frontend.bat   <- leave running
5. Open http://localhost:3000         <- admin@example.com / admin123
```

---

## Two ways to run it

Pick based on what you're doing.

### A. Development mode — for editing the app

```
start-backend.bat    +    start-frontend.bat
   API on :8000            UI on :3000
```

Open **<http://localhost:3000>**. Edit any file under `frontend/src` and the
browser updates instantly. This is what you want while changing things.

Two servers means two different origins, so the API has to explicitly allow
`http://localhost:3000` — `setup-local.bat` writes that into `backend\.env` as
`CORS_ORIGINS`. If you ever set it to `"*"`, login will break: wildcard origins
are rejected on purpose, because combining `*` with cookie credentials is what
lets any website on the internet make requests as a logged-in user.

### B. Preview mode — to see exactly what the hosted version looks like

```
preview-production.bat
   everything on :8000
```

Open **<http://localhost:8000>**. This compiles the React bundle and has FastAPI
serve it directly — the identical single-service setup that runs on Render. Use
it to sanity-check before deploying, or to show someone the finished thing.

No hot-reload here: after changing code you have to stop it and run the script
again, since it serves a compiled build.

**One deliberate difference from production:** `PUBLIC_MODE` stays `false`
locally. In production it forces `Secure` cookies, which browsers only accept
over HTTPS — on plain `http://localhost` that would block every login. Nothing
else differs.

### Testing from your phone on the same wifi

`preview-production.bat` binds to all network interfaces, so you can open it on
a phone connected to the same network. Find your PC's address:

```powershell
ipconfig | findstr IPv4
```

Then browse to `http://192.168.x.x:8000` on the phone. You may need to allow
Python through Windows Firewall the first time.

---

## Step 1 — Get MongoDB running

Pick **one** of these three.

### Option A — Docker (easiest if you have Docker Desktop)

```powershell
docker compose -f docker-compose.mongo.yml up -d
```

That's it. Mongo is now on `localhost:27017`.

### Option B — MongoDB Community Server (native install)

1. Download **MongoDB Community Server** (MSI) from
   <https://www.mongodb.com/try/download/community>
2. Run the installer, keep **"Install MongoDB as a Service"** ticked.
3. It now starts automatically on `localhost:27017`. Verify:
   ```powershell
   Get-Service MongoDB
   ```

### Option C — MongoDB Atlas (free cloud tier, no install)

1. Create a free M0 cluster at <https://www.mongodb.com/cloud/atlas>
2. Add your IP to the Network Access allowlist, create a DB user.
3. Copy the connection string and put it in `backend\.env`:
   ```
   MONGO_URL="mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"
   ```

---

## Step 2 — Prerequisites

| Tool | Version | Link |
|---|---|---|
| Python | 3.10 – 3.12 (3.11 recommended) | <https://www.python.org/downloads/> — tick **"Add python.exe to PATH"** |
| Node.js | 20 LTS or 22 LTS | <https://nodejs.org/> |

Verify in a fresh PowerShell window:

```powershell
python --version
node --version
```

---

## Step 3 — One-time setup

Double-click **`setup-local.bat`** (or run it from a terminal).

It will:

1. Rewrite `backend\.env` and `frontend\.env` to point at `localhost`
   (your originals are backed up as `.env.emergent.bak`).
2. Create a Python virtualenv at `backend\.venv`.
3. Install backend deps from `backend\requirements-local.txt`.
4. Run `npm install` for the frontend.

---

## Step 4 — Run it

Two terminals, or just double-click both files:

| File | What it starts | URL |
|---|---|---|
| `start-backend.bat` | FastAPI + Uvicorn (auto-reload) | <http://localhost:8000> |
| `start-frontend.bat` | React dev server | <http://localhost:3000> |
| `preview-production.bat` | Both together, production build | <http://localhost:8000> |

Then open **<http://localhost:3000>**.

**Login:** `admin@example.com` / `admin123`
(set by `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend\.env`; the admin user is
re-seeded on every backend start, and the password is reset to match the .env)

Interactive API docs: **<http://localhost:8000/docs>**

---

## First-run walkthrough

The database starts empty except for the admin user. Set things up in this order —
later screens depend on earlier ones:

1. **Operators** — the people doing the work. Codes (`OP001`…) are auto-assigned.
2. **Operations** — the tasks: Overlock, Flatlock, Button, Checking…
3. **Colors** and **Size Charts** — e.g. chart "Adult" with sizes S, M, L, XL.
4. **Weeks** — generate the payroll weeks for the year. *Nothing can be entered
   without a week.*
5. **Lots** — a production order: style name, size chart, per-colour/per-size
   quantities, and which operations apply at what piece rate + which operators
   are assigned.
6. **Production Entry** — the daily grid: pick week + lot + operation + colour,
   then type quantities per operator per size.
7. **Payroll / Vouchers / Reports** — earnings, advance deductions, exports.

---

## Running the tests

With the API running on :8000:

```powershell
backend\.venv\Scripts\python.exe backend\test_api.py
backend\.venv\Scripts\python.exe backend\test_enquiries.py
backend\.venv\Scripts\python.exe backend\test_audit.py
backend\.venv\Scripts\python.exe backend\test_approvals.py
backend\.venv\Scripts\python.exe backend\test_groups.py
backend\.venv\Scripts\python.exe backend\test_lotmath.py
backend\.venv\Scripts\python.exe backend\test_phase3.py
backend\.venv\Scripts\python.exe backend\test_phase4.py
backend\.venv\Scripts\python.exe backend\test_phase5.py
backend\.venv\Scripts\python.exe backend\test_phase6.py
backend\.venv\Scripts\python.exe backend\test_salary.py
```

`test_phase5.py` needs the dev-only test tools (`pip install -r backend\requirements-dev.txt`) and a
`CRON_TOKEN` in `backend\.env`. Frontend: `cd frontend; npm test`.

Each cleans up the records it creates (audit and approval history are kept on purpose).

## Troubleshooting

**Backend changes don't show up / `--reload` seems stuck**
Uvicorn's auto-reload can hang on Windows while a browser tab still holds a connection open. Stop the
backend (Ctrl+C, or end the process listening on port 8000) and start it again.

**"MongoDB connection refused" / backend hangs on first request**
Mongo isn't running. `Get-Service MongoDB`, or `docker ps` if using Docker.

**Port 8000 or 3000 already in use**
```powershell
netstat -ano | findstr :8000
taskkill /PID <pid> /F
```
If you change the backend port, also change `REACT_APP_BACKEND_URL` in
`frontend\.env` — and restart the frontend (CRA only reads `.env` at startup).

**Login fails in dev mode, browser console shows a CORS error**
`CORS_ORIGINS` in `backend\.env` must list the dev server explicitly:
```
CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
```
`"*"` is rejected by design. Restart the backend after changing it. (Not
applicable in preview mode — there's only one origin there.)

**Login succeeds but every page says "Not authenticated"**
The auth cookies are issued with `Secure; SameSite=None`. Browsers make an
exception for `localhost`, so this normally works — but **use
`http://localhost:3000`, not your machine's LAN IP** (`192.168.x.x` is not a
trusted origin, so the browser will silently drop the cookies). If you must use
a LAN IP, change the two `response.set_cookie(...)` calls in `backend/server.py`
to `secure=False, samesite="lax"`.

**Frontend compiles but the page is blank / slow to load**
`frontend/public/index.html` loads a script from `assets.emergent.sh`. If that
host is unreachable the page still works, but may pause first. You can safely
delete that `<script>` tag (line ~26) for local use.

**`npm start` fails with an `ajv` / `schema-utils` error**
```powershell
cd frontend
npm install --legacy-peer-deps ajv@8
```

**Changing the admin password**
Edit `ADMIN_PASSWORD` in `backend\.env` and restart the backend — it resets on boot.

---

## What I changed

Everything below was required to make the project runnable outside Emergent.

| # | Change | Why |
|---|---|---|
| 1 | **Added `frontend/src/components/ui/` (12 files)** — badge, button, card, checkbox, dialog, input, label, progress, select, switch, table, tabs | These were imported by every page but **the folder did not exist**. The frontend could not compile at all. Rebuilt as standard shadcn/ui components on the Radix packages already listed in `package.json`, using the CSS variables already defined in `index.css`. |
| 2 | **Added `frontend/craco.config.js`** | `package.json` runs `craco start`, but there was no craco config — and `index.js` imports `@/App`, so the `@` → `src` alias had to be defined or the build fails. |
| 3 | **Added `frontend/jsconfig.json`** | So VS Code resolves `@/...` imports for autocomplete. |
| 4 | **Patched `backend/server.py`** — `/app/memory` → `<backend>/memory`, overridable via `MEMORY_DIR` | Hardcoded Linux container path. On Windows this writes to `C:\app\memory` and can crash startup with a permission error. |
| 5 | **Added `backend/requirements-local.txt`** | The original `requirements.txt` pins ~130 packages (pandas, numpy, boto3, litellm, google-genai, openai, stripe…) that `server.py` never imports. Slow and error-prone to build on Windows. This file is the 11 packages actually used. |
| 6 | **Removed `@emergentbase/visual-edits` from `package.json` devDependencies** *(only in my test copy — your `package.json` is untouched)* | It installs from `https://assets.emergent.sh/...`, a private CDN. If your network can't reach it, `npm install` hangs. If `setup-local.bat` stalls on npm install, delete that line and retry. |
| 7 | `.env` files rewritten to localhost by `setup-local.bat` | They pointed at `https://stitch-track-29.preview.emergentagent.com`. Originals backed up as `.env.emergent.bak`. |

**Not changed** — flagged in `ANALYSIS.md` instead: the committed `JWT_SECRET`,
the default admin password, and the permissive CORS regex. Fix these before this
goes anywhere near a real network.

## Phase 1 — public website (2026-10-25)

Logged-out `/` and `/home` show the public website. Staff login remains `/login`;
logged-in `/` remains the dashboard. Admins can review website submissions at
`/enquiries` and mark them new or handled. No SMTP configuration is needed.

All marketing copy and optional facts live in `frontend/src/landing/content.js`.
Postal address, hours, WhatsApp, certifications, statistics, gallery and public
origin remain `TODO(owner)` and are omitted until confirmed. Images are explicitly
illustrative, not factory or catalogue photographs. See `frontend/public/landing/ASSETS.md`.

Before deploying, confirm the public URL: update the canonical link and absolute
Open Graph/Twitter image URLs in `frontend/public/index.html`, populate
`frontend/public/sitemap.xml` with the absolute `/home` URL, and add its Sitemap
line to `robots.txt`. The owner explicitly deferred this URL during local work.
No new runtime environment variables or runtime dependencies were added.

Enquiries accept plain text only, with a five-submission, one-hour per-IP quota
starting with the first submission. The MongoDB TTL index cleans expired quotas;
the atomic update resets expired quotas even before TTL cleanup. Client IP comes
from ASGI request.client (Uvicorn's trusted-proxy handling); the application does
not independently trust arbitrary `X-Real-IP` headers. Keep the backend behind
Render's trusted ingress in production. Email forwarding is deferred to Phase 5.

Install test-only dependencies with `backend\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt`.
Run `backend\.venv\Scripts\python.exe backend/test_enquiries.py` alongside the main
regression suite. These tests create and remove only their own enquiry/user
fixtures, and preserve the prior local quota and notification read states.

## Landing page v2

The public page now uses the official vector logo and blue theme. The logged-out root
and `/home` show the public page; staff links keep their existing routing. The
public enquiry endpoint and its five-per-IP hourly quota are unchanged. Product
images are illustrative and not photos of the unit or its product catalogue.

Copy, contact details and all withheld business facts live in
`frontend/src/landing/content.js`. Empty arrays hide the corresponding sections.
`canonicalUrl` may be set to a confirmed full HTTPS origin; if it is empty,
`REACT_APP_SITE_URL` can supply that origin at frontend build time. Until one is set,
the canonical and absolute social-image tags are omitted. The API generates
`/robots.txt` and `/sitemap.xml` from the incoming host, including a later custom
domain, and lists only `/home` in the sitemap.

Image variants can be rebuilt with `scripts/landing_assets_v2.py`. Its Pillow and
CairoSVG packages are needed only to generate assets; the deployed application
has no new runtime dependency. The landing render test is in
`frontend/src/landing/LandingPage.test.js`, and the SEO route test is
`backend/test_public_seo.py`.
