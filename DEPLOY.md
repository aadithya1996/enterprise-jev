# Deploying Enterprise Jev (GitHub + Vercel)

This app is a static frontend (`public/`) plus a small Node router (`server/`) exposed
as a single Vercel Serverless Function (`api/index.js`). There is **no build step and
zero npm dependencies**.

---

## 0. One-time safety check (secrets)

Your real API keys live in **`.env`**, which is **gitignored** — it is never committed.
Set keys as **Vercel Environment Variables** instead (Step 3). If a key was ever shared
or pasted somewhere public, rotate it.

Verify `.env` is ignored:

```bash
git check-ignore -v .env   # should print a .gitignore match
```

---

## 1. Push to GitHub

```bash
# from the project root
git add -A
git commit -m "Enterprise Jev — deployable build"

# Option A: GitHub CLI (creates the repo and pushes)
gh repo create enterprise-jev --private --source=. --remote=origin --push

# Option B: existing/empty GitHub repo
git remote add origin https://github.com/<you>/enterprise-jev.git
git branch -M main
git push -u origin main
```

---

## 2. Import into Vercel

- Go to **vercel.com → Add New… → Project → Import** your GitHub repo, **or** use the CLI:

```bash
npm i -g vercel
vercel        # first run links/creates the project (accept defaults)
vercel --prod # production deploy
```

`vercel.json` already tells Vercel how to route things:

| Request            | Served by                                  |
|--------------------|--------------------------------------------|
| `/api/*`           | `api/index.js` (Node serverless function)  |
| `/`, `/app.js`, …  | static files from `public/`                |

No framework preset, build command, or output directory is required — leave them empty.

---

## 3. Set environment variables (Vercel → Project → Settings → Environment Variables)

Choose one of the two modes:

**Mode A — Full functionality (recommended for a live demo)**
Handles arbitrary prompts and any name. Keys stay server-side.

| Key                 | Value                          |
|---------------------|--------------------------------|
| `TYPESAFE_API_KEY`  | your TypeSafe System One key    |
| `TYPESAFE_MODEL`    | `jev-latest` (optional)         |
| `OPENAI_API_KEY`    | your OpenAI key (optional; only for RLS SQL drafting) |
| `OPENAI_MODEL`      | `gpt-4o-mini` (optional)        |

**Mode B — Zero-key demo (no secrets, no external calls)**
Runs the canonical showcase prompts (Dana, Sarah, superadmin, RLS, etc.) from a local
fixture. Arbitrary new names (e.g. a brand-new "Cecil") won't classify in this mode.

| Key           | Value |
|---------------|-------|
| `JEV_FIXTURE` | `1`   |

Re-deploy after changing env vars (`vercel --prod`, or push a commit).

---

## 4. Verify

- `https://<your-app>.vercel.app/` loads the Control Plane.
- `https://<your-app>.vercel.app/api/health` returns JSON with `"configured": true`.
- Type `update Dana's role to admin` → the draft card appears → Enter deploys → Enter commits.

---

## Notes & limitations

- **In-memory state.** The directory and pending decisions live in the function's memory.
  Within a warm instance the full flow (draft → deploy → commit) works normally. Across a
  cold start or parallel instances, a `decisionId` may not be found and the card will ask
  you to resend. This is fine for a single-user demo. For multi-user or long-lived state,
  back the store with a database (e.g. Vercel KV/Postgres) or deploy the persistent Node
  server (`npm start`) on a stateful host (Render, Railway, Fly.io).
- **What ships to Vercel.** `.vercelignore` keeps the runtime lean — only `api/`, `server/`,
  `public/`, `vercel.json`, and `package.json` are needed. Reference material (`shapeshift/`),
  demo scripts, and screenshots are excluded from the deployment.
