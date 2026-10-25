# Putting Victoria Unit Flow online

Goal: a private URL like `https://victoria-unit-flow.onrender.com` that your
staff can open from a laptop at the unit or a phone at home — and nobody else
can use, because every page requires a login.

**Time:** about 45 minutes, most of it waiting for the first build.
**Cost:** ₹0 to start. ~₹600/month (US$7) if you want it always-on — see
[Free vs paid](#free-vs-paid).

---

## How it's put together

One service does everything:

```
        your staff (browser / phone)
                    |
                 HTTPS
                    |
   ┌────────────────────────────────┐
   │  Render web service            │
   │                                │
   │  FastAPI  ──serves──>  React   │   <- one origin, one URL
   │     |                          │
   └─────|──────────────────────────┘
         |  encrypted connection
   ┌─────────────────────┐
   │  MongoDB Atlas      │   <- your data lives here
   └─────────────────────┘
```

FastAPI now serves the React files itself. That matters for two practical
reasons: there's only one thing to deploy and pay for, and login cookies stay
same-origin, which is what makes sessions reliable on iPhones (Safari is
aggressive about blocking cross-site cookies).

---

## Before you start

You need three free accounts:

| Account | For | Link |
|---|---|---|
| GitHub | Storing the code; Render deploys from it | <https://github.com> |
| MongoDB Atlas | The database | <https://www.mongodb.com/cloud/atlas/register> |
| Render | Running the app | <https://render.com> |

---

## Step 1 — Put the code on GitHub (private)

A `.gitignore` is already in place so your `.env` secrets are never uploaded.
Verify that before your first push.

Install Git from <https://git-scm.com/download/win> if you don't have it, then
in PowerShell **inside this folder**:

```powershell
git init
git add .
git status          # confirm NO .env files are listed
git commit -m "Victoria Unit Flow"
```

Create a **private** repo at <https://github.com/new> — name it
`victoria-unit-flow`, tick **Private**, don't add a README. Then:

```powershell
git remote add origin https://github.com/YOUR-USERNAME/victoria-unit-flow.git
git branch -M main
git push -u origin main
```

> **Keep the repo private.** It contains your business logic and payroll rules.

---

## Step 2 — Create the database (MongoDB Atlas)

1. Sign up, choose the **M0 free** cluster.
2. Provider **AWS**, region **Mumbai (ap-south-1)** — closest to Tiruppur.
3. **Database Access** → *Add New Database User*
   - Username: `victoria_app`
   - Password: click **Autogenerate**, then **copy it somewhere safe**
   - Role: *Read and write to any database*
4. **Network Access** → *Add IP Address* → **Allow access from anywhere**
   (`0.0.0.0/0`).
   Render doesn't publish fixed outbound IPs on the free plan, so this is
   required. The database is still protected by username, password and TLS.
5. **Database** → *Connect* → *Drivers* → copy the connection string:

```
mongodb+srv://victoria_app:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Replace `<db_password>` with the real password. **Keep this string handy** —
it's the `MONGO_URL` value in the next step.

---

## Step 3 — Generate your secrets

In PowerShell:

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the output — that's your `JWT_SECRET`. It signs login sessions; anyone who
has it can forge an admin login, so it must be new and never committed.

Also decide a **strong admin password** now. The app will refuse to start with
`admin123` when `PUBLIC_MODE=true` — that's deliberate.

---

## Step 4 — Deploy on Render

1. <https://dashboard.render.com> → **New** → **Blueprint**.
2. Connect your GitHub account, pick `victoria-unit-flow`.
3. Render reads `render.yaml` and proposes a service. Click **Apply**.
4. It will prompt for the two values marked `sync: false`:

| Variable | Value |
|---|---|
| `MONGO_URL` | the Atlas string from Step 2 |
| `ADMIN_PASSWORD` | your strong admin password |

`JWT_SECRET` is generated automatically by Render. Everything else is preset.

5. Before the first deploy finishes, open **Environment** and change
   `ADMIN_EMAIL` to the real address you want to log in with.

First build takes **10–15 minutes** (it compiles the React bundle). Later
deploys are faster.

When the log shows `Serving frontend from /app/frontend/build` and the service
goes **Live**, open your URL and log in.

---

## Step 5 — Lock it down

Do these on day one:

1. **Log in as admin and change the password from inside the app**
   (Users → your account). It will now stick across restarts — the old code
   used to silently reset it on every reboot; that's fixed.
2. **Create one account per person.** Never share a login — the audit trail
   records who entered and edited every figure, which is worthless if three
   people share one account.

   | Role | Give it to |
   |---|---|
   | `admin` | You / the owner. Full access. |
   | `accounts` | Whoever handles payroll, advances and reports. |
   | `data_entry` | Supervisors recording production. |

3. **Set the per-user permission checkboxes deliberately.** These now actually
   work — until this change they were decorative and unticking one did nothing.
   In particular `can_view_financial` controls whether someone sees rates,
   earnings and payroll.
4. **Turn off `ADMIN_PASSWORD_RESET`** if you ever switch it on for recovery.

---

## Free vs paid

| | Free | Starter (US$7/mo) |
|---|---|---|
| Sleeps when idle | Yes, after 15 min | No |
| First load after sleep | ~50 seconds | Instant |
| Good for | Trying it out | Daily factory use |

The free tier's sleep is genuinely annoying in practice: the supervisor opening
the app after lunch waits nearly a minute. Two options:

- **Upgrade to Starter** — Render dashboard → your service → *Settings* → *Plan*.
- **Keep it awake for free** — the app exposes `/api/health`. Point a free
  monitor at `https://YOUR-APP.onrender.com/api/health` every 10 minutes
  (<https://uptimerobot.com> works). This also alerts you if the app goes down.

Atlas M0 stays free permanently — 512 MB holds years of production entries for
a unit this size.

---

## Backups

Atlas M0 does **not** include automated backups. Your payroll history is the
one thing you can't recreate, so take a manual dump periodically:

```powershell
# one-time: install MongoDB Database Tools
# https://www.mongodb.com/try/download/database-tools

mongodump --uri="YOUR_MONGO_URL" --out="C:\backups\victoria-2026-07-28"
```

Do it monthly, and always before closing a financial year. Restore with
`mongorestore`. If the data becomes critical, Atlas M10 (~US$9/mo) adds
continuous backups.

---

## Updating the app later

```powershell
git add .
git commit -m "describe the change"
git push
```

Render redeploys automatically (`autoDeploy: true`). Watch the build log; if it
fails, the previous version keeps running.

---

## Troubleshooting

**Build fails on `npm install`**
Almost always the `@emergentbase/visual-edits` devDependency, which installs from
a private CDN. Remove that line from `frontend/package.json`, commit, push.

**App starts then immediately crashes**
Read the Render log. If it says *"JWT_SECRET is still the shared development
value"* or *"ADMIN_PASSWORD is unsafe"*, that's the safety check doing its job —
set proper values in **Environment**.

**"Database unreachable" at `/api/health`**
Atlas Network Access is missing `0.0.0.0/0`, or the password in `MONGO_URL`
wasn't substituted for `<db_password>`. Special characters in the password must
be URL-encoded (`@` → `%40`).

**Login works, then every page says "Not authenticated"**
Check you're on `https://`, not `http://`. Cookies are `Secure` in public mode
and browsers drop them over plain HTTP.

**Locked out of admin**
Render → Environment → set `ADMIN_PASSWORD_RESET=true` and `ADMIN_PASSWORD` to a
new value → *Manual Deploy*. Log in, then **set it back to `false`**.

**Company logo doesn't load**
The logos are hotlinked from `customer-assets.emergentagent.com`. If that host
disappears, drop your own image into `frontend/public/` and update the two
`LOGO_` constants at the top of `frontend/src/components/Layout.js`.

---

## Running it on your own server instead

The `Dockerfile` isn't Render-specific. On any Linux box with Docker:

```bash
docker build -t victoria-unit-flow .
docker run -d --name victoria -p 80:8000 \
  -e MONGO_URL="mongodb://host.docker.internal:27017" \
  -e DB_NAME="victoria_unit_flow" \
  -e JWT_SECRET="your-generated-secret" \
  -e ADMIN_EMAIL="admin@victoriagarments.in" \
  -e ADMIN_PASSWORD="your-strong-password" \
  -e PUBLIC_MODE="true" \
  victoria-unit-flow
```

Put a reverse proxy (Caddy or nginx) in front for HTTPS. Without HTTPS, set
`COOKIE_SECURE=false` or logins will fail.

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_URL` | yes | Atlas / MongoDB connection string |
| `DB_NAME` | yes | Database name |
| `JWT_SECRET` | yes | Signs sessions. Changing it logs everyone out. |
| `ADMIN_EMAIL` | yes | First admin account |
| `ADMIN_PASSWORD` | yes | First admin password (creation only) |
| `PUBLIC_MODE` | prod | `true` = HTTPS cookies, no API docs, rejects weak secrets |
| `CORS_ORIGINS` | no | Leave empty in production (same-origin) |
| `ADMIN_PASSWORD_RESET` | no | `true` forces the admin password back on next boot |
| `COOKIE_SECURE` | no | Follows `PUBLIC_MODE` unless set |
| `FRONTEND_BUILD_DIR` | no | Where the React build lives |
| `PORT` | no | Injected by Render |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | no | Email reports. Leave `SMTP_HOST` empty and the app simply says email is off. Use an app password, never the mailbox login password. |
| `CRON_TOKEN` | for scheduled email | Long random value; the outside timer must send it (see below) |


---

## Scheduled emails (the free plan sleeps)

On Render's free plan the service goes to sleep when idle, so a timer *inside* the app would silently miss
its sends. Use an outside timer instead. It also keeps the app awake while it runs.

1. Set `CRON_TOKEN` (Render's `render.yaml` generates one) and the `SMTP_*` variables above.
2. In **Settings, Email reports**, switch on the reports you want and add recipients. "Send test" proves the
   mailbox details are right.
3. Create a free job at cron-job.org (or a Render Cron Job) that sends a `POST` every 15 minutes to

   `https://<your-app>.onrender.com/api/jobs/run?token=<CRON_TOKEN>`

   The app decides what is due (Indian time, 08:00 or later), sends each report once per period, and
   records every attempt under "Recent sends". Calling it more often than needed is harmless.
4. A later move to Cloudflare could use a Cron Trigger for the same call.

## Custom domain for the public landing page

In Render, add the chosen domain to the existing web service. Create the DNS records
shown by Render at the domain registrar and wait for Render's TLS certificate to
become active. Set `canonicalUrl` in `frontend/src/landing/content.js` to the
confirmed HTTPS origin, or set `REACT_APP_SITE_URL` to that origin for the frontend
build, then redeploy. No Dockerfile, service or database migration is required.
The generated `/robots.txt` and `/sitemap.xml` use the incoming host and update
automatically when the domain changes. Direct staff URLs remain on the same origin.
