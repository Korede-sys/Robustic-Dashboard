# Robustic — setup & deployment

This is the Supabase + Vercel version of the dashboard: real accounts, real
roles enforced by the database, shared data your whole team sees. The
parsing/commission logic (`src/lib/engine-core.js`) is unchanged from the
version already validated against your real files — only the storage layer
and auth are new.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a new project (pick any
   name/region/password — the password is for the underlying Postgres
   database, you won't need it day-to-day).
2. Once it's ready, open **SQL Editor** → **New query**, paste in the entire
   contents of `schema.sql` from this folder, and run it. This creates every
   table, the role system, and the security rules that enforce who can see
   and do what.
3. Go to **Project Settings → API**. You'll need two values from here in a
   moment: **Project URL** and the **anon public** key.

## 2. Create your first (admin) account

New sign-ups default to the `viewer` role — nobody can grant themselves
`admin`, on purpose. So the very first account needs to be created and
promoted manually:

1. In Supabase, go to **Authentication → Users → Add user**. Enter your
   email and a password, and check "Auto Confirm User" so you don't need to
   click an email link.
2. Go to **Table Editor → profiles**. You'll see a row was created
   automatically for that user with `role = viewer`. Change it to `admin`
   and save.

That's your admin account. From then on, use the **Team** tab inside the app
to add everyone else and set their roles — no more manual database editing
needed.

## 3. Run it locally (optional, to test before deploying)

```bash
npm install
cp .env.example .env.local
# edit .env.local with your Project URL and anon key from step 1
npm run dev
```

Opens at `http://localhost:5173`. Sign in with the account from step 2.

## 4. Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New → Project**, import that repo.
3. Vercel will auto-detect Vite — leave the build settings as default.
4. Before deploying, add the two environment variables under **Environment
   Variables**: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values
   as your `.env.local`).
5. Deploy. You'll get a live URL your whole team can use.

## What each role can actually do

Enforced two ways: the UI hides what a role can't use, and the database
rejects it even if someone bypassed the UI (Row Level Security in
`schema.sql`) — so this isn't just a cosmetic restriction.

| | admin | finance | manager | viewer |
|---|---|---|---|---|
| View all reports | ✓ | ✓ | ✓ | ✓ |
| Upload / delete files | ✓ | ✓ | | |
| Clean Export | ✓ | ✓ | | |
| Needs Attention & Follow-ups | ✓ | ✓ | ✓ | |
| Manage team & roles | ✓ | | | |

## What's still true from before

- The sheet's own commission/bonus values are what gets reported and
  exported — the formulas in `engine-core.js` are a cross-check, never an
  override.
- Two anomalies are still flagged, unresolved, on the Formulas tab: the
  agents paid +10% above formula, and online-channel agents showing ₦0
  commission.
- A few tiers (Globalbet's A/UP-10% blocks, Sports' UP-30%/3rd-Party blocks)
  have no independently-confirmed formula — source value is used, flagged
  "unverified."

## A limitation worth knowing

I can't connect to your actual Supabase project or deploy to your actual
Vercel account from where I'm running — there's no network access in this
environment. Everything here has been checked carefully and the underlying
engine logic was tested directly in Node against your real files earlier,
but this specific Supabase-connected code path hasn't been run end-to-end
against a live database the way the parsing engine was. Test it against a
real login and a real file upload before trusting it for anything important,
the same way you would with any new system.
