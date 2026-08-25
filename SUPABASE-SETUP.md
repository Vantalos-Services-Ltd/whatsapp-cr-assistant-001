# Supabase Setup

Verified against Supabase's own documentation, August 2026. Sources at the bottom.

---

## Before you start: how this app talks to the database

This matters, because it determines every choice below.

This app uses **Prisma over a plain Postgres connection**, server-side only. It
does **not** use Supabase's client libraries (`@supabase/supabase-js`), their
REST/GraphQL endpoints, or Supabase Auth. The browser talks to our backend on
port 3001; only the backend talks to Postgres.

That makes it a **persistent server** in Supabase's terminology, not a
serverless function. Different connection settings apply.

---

## Step 1 — Create the project

1. **supabase.com** → sign in → **New project**
2. Name: `vantalos-recruiter`
3. **Region: London (eu-west-2)** — nearest to you, and keeps UK candidate data
   in the UK
4. Supabase generates a database password. **Save it to your password manager
   now** — it is shown once. Do not reuse the old one.
5. Create, then wait ~2 minutes while it provisions

---

## Step 2 — Create a dedicated `prisma` database user

Supabase's Prisma guide recommends **not** connecting as the `postgres`
superuser. A dedicated user gives better access control and makes activity
visible in their Query Performance dashboard and Log Explorer.

In the Supabase dashboard, open **SQL Editor** and run this. **Replace
`REPLACE_WITH_A_STRONG_PASSWORD`** with a new password you generate (your
password manager can make one) — this is a *separate* password from the project
password in Step 1.

```sql
create user "prisma" with password 'REPLACE_WITH_A_STRONG_PASSWORD' bypassrls createdb;

-- extend prisma's privileges to postgres (necessary to view changes in Dashboard)
grant "prisma" to "postgres";

-- grant it necessary permissions over the relevant schema
grant usage on schema public to prisma;
grant create on schema public to prisma;
grant all on all tables in schema public to prisma;
grant all on all routines in schema public to prisma;
grant all on all sequences in schema public to prisma;
alter default privileges for role postgres in schema public grant all on tables to prisma;
alter default privileges for role postgres in schema public grant all on routines to prisma;
alter default privileges for role postgres in schema public grant all on sequences to prisma;
```

Save that second password too.

---

## Step 3 — Turn the Data API OFF

**This is the important security step, and it replaces fiddling with RLS.**

Every Supabase project ships with a Data API — auto-generated REST endpoints
reachable with a *publishable* key, which is public by design. By default the
`public` schema is exposed through it, and tables created in `public` receive
`SELECT`/`INSERT`/`UPDATE`/`DELETE` grants for the `anon` role.

Supabase auto-enables RLS on tables created **through the Dashboard's Table
Editor**. Our tables are created by **Prisma migrations running raw SQL**, so
they do not get that treatment. Left alone, they would be readable by anyone
holding the publishable key.

Supabase's own guidance for an app like this is unambiguous:

> "If your app never uses Supabase client libraries, REST, or GraphQL data
> endpoints, turn the Data API off."

With it off, **none of the auto-generated endpoints respond, regardless of
grants or RLS.** That closes the exposure completely, rather than papering over
it with policies.

**Dashboard → Project Settings → Data API → disable it.**

### So do I need Row Level Security?

**No — provided you did Step 3.**

RLS is a Postgres feature that filters *rows* per user ("you can only see rows
where `user_id` is yours"), enforced by the database itself. It exists to
protect the Data API, where browsers query Postgres directly using a public key.

Two reasons it does nothing for us:

1. The Data API is switched off, so there is no public entry point to defend.
2. The `prisma` user is created with **`bypassrls`** — Supabase's own
   recommended setup. RLS does not apply to it. Enabling RLS would have no
   effect on this app's queries whatsoever.

This app already enforces tenant isolation in code — see
`src/db/tenantScope.ts`, which forces an `agencyId` filter onto queries. Same
idea as RLS, applied at the application layer.

> **Expect amber "RLS disabled" warnings** next to your tables in the Supabase
> dashboard. With the Data API off they are not applicable. Do not let them
> panic you into enabling RLS and writing policies you do not need.

---

## Step 4 — Get the connection string

**Dashboard → Connect** (or Project Settings → Database → Connection string).

Choose the **Session pooler** — port **5432**, host `[REGION].pooler.supabase.com`.

The format is:

```
postgres://prisma.[PROJECT-REF]:[PRISMA-PASSWORD]@[REGION].pooler.supabase.com:5432/postgres
```

- `prisma.[PROJECT-REF]` — the user from Step 2, dot, then your project ref
- `[PRISMA-PASSWORD]` — the password you set in Step 2 (not the Step 1 one)

**Why Session pooler and not the alternatives:**

| Option | Port | Verdict |
|---|---|---|
| **Session pooler** | 5432 | ✅ **Use this.** IPv4-compatible on every plan, and Supabase recommends it for persistent backend services. |
| Direct connection | 5432 | ❌ IPv6-only unless you buy the IPv4 add-on. |
| Transaction pooler | 6543 | ❌ For serverless/edge functions with many short-lived connections. Would need `?pgbouncer=true` and a separate `DIRECT_URL` for migrations. |

No `?pgbouncer=true` and no `DIRECT_URL` are needed here — those apply to the
serverless setup, which this is not.

---

## Step 5 — Store it and switch over

```bash
./set-key.sh DATABASE_URL
```

Paste when prompted. Nothing appears on screen — that is intentional. Then:

```bash
./run migrate      # create the tables
./run seed         # load the demo data
./start-demo.sh    # restart against Supabase
```

To switch back to the local database at any point, re-run `./set-key.sh
DATABASE_URL` with:

```
postgresql://postgres:postgres@localhost:5432/vantalos_recruiter
```

---

## Free plan: know this before you rely on it

Free projects are **paused after 7 days of low activity**. You get a warning
email about a week beforehand. "A few user requests to the database each day
over the previous week is enough to keep the project from being paused."

Restoring is self-service from the dashboard, with **no data loss** — the
project returns to its previous state. But there is a **one-year window**; after
that, restoration is impossible.

This is almost certainly what happened to your previous project. If demos are
occasional rather than weekly, either poke the database periodically or use the
local database, which never pauses and costs nothing.

---

## Sources

- [Prisma | Supabase Docs](https://supabase.com/docs/guides/database/prisma)
- [Securing your API | Supabase Docs](https://supabase.com/docs/guides/api/securing-your-api)
- [Row Level Security | Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Connecting to your database | Supabase Docs](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Project Pausing | Supabase Docs](https://supabase.com/docs/guides/platform/free-project-pausing)
