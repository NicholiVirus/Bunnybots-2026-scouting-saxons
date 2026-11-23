# Saxon Scout — Harvest Havoc scouting & strategy

Offline-first scouting and alliance-selection system for **Saxon Robotics — FRC 611 (Saxons) and FRC 526 (Saxon Sparks)** at **Blair BunnyBots 2026** (Sat **Dec 12 2026**, Montgomery Blair HS). Game: **Harvest Havoc** (manual v1.5 + Team Updates 00–05).

One URL works on every phone, tablet and laptop, installs to the home screen, and **keeps working with zero connectivity** — event rule E6 bans hotspots and routers, so scouting data moves by **QR code** when there is no network.

| | |
|---|---|
| **Scout** | Alliance-based tap scouting (watch 1, 2 or 3 robots), every tap timestamped → cycle times, live coverage, post-match notes + mechanism report, 449 QRScout compatible |
| **Results** | Live feed from 449's *The Bunnybots Alliance* API (every 30 s), CSV import, manual entry, demo sandbox |
| **Analyze** | Team catalog + pit scouting + photos, OPR, reliability, cycle stats, win %, bonus-RP odds, match previews for 611 and 526 |
| **Pick** | Live draft board, per-robot pick lists, captain predictor, availability %, capped alliance simulator, playoff bracket sim, accept/decline helper, lockable final list |

---

## 1. Try it in 2 minutes (no setup)

1. Run it locally (§7) or open your deployed URL.
2. **Settings → Demo sandbox** → ON. This loads 449's simulated event into a separate local database (it never syncs and never touches real data).
3. **Admin → Data sources → "Show results through"** lets you replay the event mid-day (e.g. through Q20) to try the predictor and the draft board.

Without Supabase keys the app runs in **local-only mode**: one device, full features, data moves between devices by QR code or JSON file.

---

## 2. Deploy in under 30 minutes

You need: a GitHub account, a free [Supabase](https://supabase.com) account, a free [Vercel](https://vercel.com) account (or Cloudflare Pages, §2.7).

### 2.1 Get the code (2 min)
Fork this repository on GitHub (or push it to your team's org).

### 2.2 Create the database (5 min)
1. Supabase → **New project**. Name it `saxon-scout`, pick the closest region (East US), save the database password somewhere safe.
2. When it finishes, open **SQL Editor → New query**.
3. Open [`supabase/setup.sql`](supabase/setup.sql) in this repo, copy **all** of it, paste, press **Run**. It creates every table, the Row-Level Security rules, the 28-team roster, the alias map and default settings. (Safe to run again.)

### 2.3 Turn on sign-in (5 min)
Supabase → **Authentication**:
1. **Sign In / Providers → Email**: on. For an event, turning **Confirm email** off makes sign-up instant.
2. **URL Configuration**: set **Site URL** to your future Vercel URL (e.g. `https://saxon-scout.vercel.app`) and add **Redirect URL** `https://saxon-scout.vercel.app/auth/callback/`. (Come back and fix this after step 2.5 if the URL changes.)
3. *(Optional)* **Google** provider: follow Supabase's Google guide, paste the Client ID/Secret.

### 2.4 Copy your keys (1 min)
Supabase → **Project Settings → API**: copy the **Project URL** and the **anon public** key. (The anon key is safe in a browser; RLS decides what each role can do.)

### 2.5 Deploy the website (5 min)
1. Vercel → **Add New → Project** → import your fork.
2. **Environment Variables**:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from 2.4 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key from 2.4 |
   | `NEXT_PUBLIC_TBA_CLONE_URL` | *(optional)* 449's results site — can also be set later in the app |
3. **Deploy**. [`vercel.json`](vercel.json) already sets the build command (`npm run build`) and output folder (`out`).

### 2.6 First sign-in = admin (2 min)
Open the site, **Create account**. **The very first account becomes Admin.** Everyone else starts as **Viewer**; promote them in **Admin → Users & roles** (Scout / Strategist / Admin).

**More admins:** anyone signed in can open **Admin** and enter the admin passcode (default `SSTI`) to become an Admin. The server checks the passcode (`public.claim_admin`), allows 5 wrong tries per 15 minutes per account, and the role change lands in the audit log. To change the passcode, run in SQL Editor: `update private.admin_passcode set sha256 = encode(sha256(convert_to(upper('NEWCODE'), 'UTF8')), 'hex');` and update `PASSCODE_SHA256` in `src/components/admin/PasscodeGate.tsx`.

**Master admin:** one account is the master admin. It is always an Admin, cannot be demoted or removed through the app, and is the only account that can demote other admins (admins can still step down themselves). Change it only in SQL Editor: `update public.profiles set is_master = true, role = 'admin' where email = 'someone@example.com';` (and `set is_master = false` on the old one).

> Locked out? In Supabase SQL Editor: `update public.profiles set role = 'admin' where email = 'you@example.com';`

### 2.7 Alternative host: Cloudflare Pages (free, any use)
Pages → **Create → Connect to Git** → build command `npm run build`, output directory `out`, env vars as in 2.5 plus `NODE_VERSION = 22`. [`public/_headers`](public/_headers) sets the caching headers.

### 2.8 Keep the free database awake (3 min)
Supabase Free **pauses after 1 week without activity**. [`keepalive.yml`](.github/workflows/keepalive.yml) pings it daily:
1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**: `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same values as 2.4).
2. **Actions** tab → enable workflows → **Supabase keepalive → Run workflow** once to test (green ✓).
3. It runs from the **default branch** only — merge this code into `main`.

**If the project already paused:** Supabase dashboard → your project → **Restore project** (takes a few minutes; nothing is lost). Then run the keepalive workflow.

**Optional upgrade:** switch Supabase to **Pro ($25/mo) around Dec 1**, downgrade after Dec 12 — no auto-pause and daily backups during event month.

---

## 3. Install on every scouting device

Open the site **once while online** (that caches everything), then:
- **iPhone / iPad (Safari):** Share ⬆ → **Add to Home Screen**.
- **Android (Chrome):** ⋮ → **Install app** (or *Add to Home screen*). The app also shows an **Install** button in Settings.

**Sign in with e-mail + password on installed apps.** E-mail links open in the browser, not in the installed app (iOS keeps them separate).

---

## 4. Event-day runbook

**Before doors**
- Every device: open the app on Wi-Fi/cell, check the sync badge (top right), sign in.
- Admin → **Data sources**: paste 449's *Bunnybots Alliance* URL as soon as they publish it → **Test connection** → **Poll now**. If the site is down: **Manual entry** still works (paste the schedule, enter results in < 30 s each).
- Admin → **Scout rotation**: generate assignments (6 × 1 robot, 4 scouts 1 + 2, or 2 × 3). Scouts see their alliance/robots pre-filled.

**During quals**
- Scouts: **Scout** → match (defaults to the next one) → Red/Blue → tap robots → **Start at the buzzer** → tap → **End** → notes → **Submit**.
- No network? Everything saves on the device. Hand data over with **QR transfer → Send**, scanned by a lead's phone (**Receive**). The lead's phone uploads when it gets signal. Re-scanning is safe (no duplicates).
- 449 scouts using QRScout? Scan their codes in **QR transfer → Receive** too.

**Lunch (12:30–1:15) — pick-list meeting**
- **Picks → Pick list** (choose **Picking as 611 / 526**): drag teams into 1st / 2nd / Do-Not-Pick (every DNP needs a reason). Scouts vote ▲▼ (karma never reorders).
- **Suggestions**: 1st-pick (ceiling + synergy) and 2nd-pick (floor + reliability + low fouls) lists with availability %.
- **Meeting → Snapshot** "after lunch".

**2:30 PM** — **Meeting → Pit check** the top 10 (healthy / concern).
**2:55 PM** — list **auto-locks** (Admin → Settings sets the time; only admins unlock).
**3:00 PM** — **Board**: tap picks/declines as they happen (or it follows the official feed automatically). Send the person at the field the **Quick card** tab. Use **Predictor → Accept / decline helper** if 611 or 526 is invited.

---

## 5. Pre-event checklist

- [ ] `supabase/setup.sql` run; first admin signed in; roles assigned
- [ ] Keepalive workflow green (runs daily) — see §2.8
- [ ] Load test with 25 simulated users passes (§7: `npm run loadtest`) — includes "picked shows on a second device < 2 s"
- [ ] App **installed on every scout device**; everyone can sign in
- [ ] One **full practice match in airplane mode** on every device, then QR-transfer it to a lead phone
- [ ] Alliance count + auto-lock time set (Admin → Settings)
- [ ] Logo replaced (§6) and `npm run brand` committed
- [ ] Results URL tested, or the manual-entry fallback rehearsed
- [ ] *(Optional)* Supabase Pro from ~Dec 1

---

## 6. Logo & launch animation

- **Drop your logo in `public/brand/`** named `logo.svg`, `logo.png`, `logo.gif`, `logo.mp4`, `logo.webm` or `logo.json` (Lottie). Delete the placeholder `logo.svg`. If several exist, the first in this order wins: **json → webm → mp4 → gif → png → svg**.
- Video/Lottie logos: also add a still image `public/brand/logo-still.png` (used for icons and reduced-motion).
- Run **`npm run brand`** to regenerate the PWA icons, favicon and iOS launch images, then commit.
- **Admins can upload a logo in the app** (Admin → Branding); it overrides the file and is cached for offline use.
- Splash rules: plays once per launch (~1.5 s for images, ≤ 3 s for video/GIF/Lottie), **tap to skip**, respects *Reduce Motion*, never blocks (load errors go straight in), works offline, can be turned off (Settings, or for everyone in Admin → Settings).
- **Saxon color:** change `--saxon` in [`src/app/globals.css`](src/app/globals.css).

---

## 7. Development

```bash
npm install
```
```bash
npm run dev          # http://localhost:3000 (local-only mode unless .env.local has Supabase keys)
```
```bash
npm run build && npm start   # production static export served from out/
```

| Script | What it does |
|---|---|
| `npm test` | Unit tests + **Row-Level Security tests** (the real migration in Postgres 17 via PGlite) |
| `npm run test:e2e` | Playwright against the built app (scouting flow, offline, QR, live feed, draft board, every screen) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run seed:sql` | Regenerates `supabase/seed.sql` + `setup.sql` from `src/config/event.ts` |
| `npm run brand` | Icons + iOS splash images from your logo |
| `npm run keepalive` | Pings Supabase once (needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`) |
| `npm run loadtest` | 25 simulated devices against your project (needs an **admin** login in `LOADTEST_EMAIL` / `LOADTEST_PASSWORD`; cleans up after itself; don't run during alliance selection) |

Copy [`.env.example`](.env.example) to `.env.local` for local development with Supabase.

### Project layout
```
src/game/harvestHavoc.config.ts   ← EVERY point value / rule (edit only this for a new Team Update)
src/config/event.ts               ← event facts, 28-team roster, B-robot alias map
src/data/      IndexedDB (Dexie) tables, write path (outbox), hooks
src/sync/      Supabase client, auth/roles, sync engine (push / pull / realtime)
src/sources/   Bunnybots Alliance API, CSV import, manual entry, demo data
src/scouting/  event log → totals, cycle timing, duplicate merge, QR + QRScout formats
src/analytics/ model, OPR, strength, win %, capped alliance sim, pick score, leaderboard
src/selection/ draft engine, predictor / availability / bracket / accept-decline (Web Worker)
src/app/       pages (static export)          supabase/   migration, seed, RLS tests
```

### How it works (short)
- **Offline-first:** the UI reads only from IndexedDB. Writes go to IndexedDB, then an outbox the sync engine pushes when online (permission errors are parked, never block the queue). Pull is incremental by server `updated_at`; Supabase Realtime pushes changes in < 2 s. The service worker precaches the whole static app.
- **Official results are the source of truth.** Scores are recomputed from the config to flag data problems (449's simulation scored oven cakes at 2; the manual says 1). The field system sends B robots as `9`+number (`9449` → `449b`) — every importer uses the editable alias map.
- **Cycle time** = time between scoring placements in teleop (first cycle from 0:15; the endgame haul is the last cycle). Placements < 3 s apart with no intake between count as one multi-piece delivery (configurable; 0 = literal). Died/disabled time is excluded; cycles > 60 s are "long gaps". Cycle stats weight 1-robot scouts highest.
- **Duplicate coverage:** counts are averaged, timestamps come from the scout who watched the fewest robots, big disagreements are flagged.
- **Win %** = Φ((μ_red − μ_blue) / √(σ²_red + σ²_blue)); teams with < 2 matches blend toward OPR / cycle-implied points / the event average ("estimate").
- **Capped alliance simulation** (bonus-RP odds, fit, simulator, bracket): 5 pieces per shelf with value-ordered cascade, cakes only via 3 oven carrots → 1 cake (max 9 + 1 prestaged, oven cakes recycle), hauls ≤ 3 when parked. Seeded Monte Carlo, ≥ 2,000 runs.

### Security model
- Every table has RLS; `npm test` proves Viewers and the public cannot write (16 tests).
- Admin: everything (roles, results, teams, settings, audit log). Strategist: pick lists, draft board, strategy notes, catalog, rotation, QR imports for others. Scout: own scouting/pit reports, photos, votes. Viewer: read-only.
- Signed-in members can read scouting rows (analytics run on-device); e-mails and the audit log are admin-only.
- The public board link is **off by default**, token-gated, revocable, and never exposes notes or Do-Not-Pick reasons.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Badge shows **Offline · N** | Data is safe on the device; it uploads when online. Or hand it over by QR. |
| **N failed** in the sync panel | Usually a role problem (e.g. a Viewer tried to scout). Fix the role, then **Retry failed**. |
| "Results feed not set" | Admin → Data sources → paste the URL. Feed down? Switch to **Manual only**. |
| Results show **data warning** | The field's score differs from the rules — check the match page; a newer Team Update may need a config change. |
| Can't sign in on the installed app | Use e-mail + password (not the e-mail link). |
| Everything shows 0 / empty | Check the team filter (611 / 526 / Both) and that Demo mode is off for real data. |
| New version banner | Tap **Update now** between matches (it never auto-reloads mid-match). |

---

## Credits
- Game: **Harvest Havoc**, Blair BunnyBots 2026 by **FRC 449 The Blair Robot Project**.
- Demo data and the results API shape: 449's [The Bunnybots Alliance](https://github.com/449-Data-Science/The-Bunnybots-Alliance) (see [`data/demo/README.md`](data/demo/README.md)); QRScout form: 449's [bunnybots_scouting_2026](https://github.com/449-Data-Science/bunnybots_scouting_2026).
- Rules verification log: [`docs/manual-verification.md`](docs/manual-verification.md).
