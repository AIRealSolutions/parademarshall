# Parade Marshal

A mobile-first platform for managing a community parade from registration through staging, dispatch, live checkpoint tracking and the spectator portal. It is configured first for the **Southport Christmas Parade** (Southport, NC), and every record is scoped to an event so other towns can run their own parades.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + PostGIS, Auth, RLS, Storage) · Vercel.

## Status: Phase 1 (foundation and registration)

| Area | State |
| --- | --- |
| Database schema for the whole SDS data model (§5) | ✅ |
| Row Level Security on every table, roles per event (§2) | ✅ |
| Workflow rules in the database: application lifecycle, staging placement, restrictions, check-in, single-authorization dispatch, parade-wide hold, checkpoints, publication layer, annual cloning (§6) | ✅ tested |
| Participant registration, drafts, resubmission, withdrawal and QR pass | ✅ |
| Director dashboard, application review, audit history and event settings | ✅ |
| Public event page (announcements, published lineup, approximate progress) | ✅ basic |
| Staging map editor, lineup builder, dispatch and marshal screens | Phases 2–4 (database rules are already in place) |

## How rules are enforced

The browser is never trusted. Status columns on applications, units and the parade hold can change only through `SECURITY DEFINER` functions in `supabase/migrations/…_workflows.sql`. Each function checks the caller's event role, validates the transition and writes an audit record. Key guarantees, all covered by `supabase/tests/test_business_rules.sql`:

- Participants cannot approve themselves, edit an entry after submitting it, or see other organizations' data.
- Only the director or assistant director approves entries and staging placement.
- A placement must reserve the unit's full footprint (vehicles + trailers + separation), fit inside the block, never overlap another unit (enforced by a Postgres exclusion constraint), and never sit on a closed or unavailable block. A safety restriction cannot be overridden. A non-safety restriction can be overridden only with a written reason.
- A new restriction **flags** affected placements and notifies the directors. It never moves units on its own.
- Only one unit can hold the release authorization at the merge at a time. A parade-wide hold blocks both new authorizations and releases.
- Offline actions carry a `client_action_id`. Replaying one returns the original result. A conflicting dispatch action is recorded and escalated for a person to resolve.
- Spectators read only from published snapshots (`publications`), which contain no contacts, documents or staging locations.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL and publishable key
npm run dev
```

### Supabase setup

1. Create a Supabase project.
2. Apply the migrations in `supabase/migrations/` in order, using `supabase db push` or the SQL editor. Then run `supabase/seed.sql` to load the Southport 2026 event.
3. In **Auth → URL Configuration**, add `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback`) to the redirect URLs.
4. Sign in once through the app, then make yourself the administrator and director:

```sql
update public.profiles set is_system_admin = true where email = 'you@example.com';
insert into public.event_roles (event_id, user_id, role)
select '00000000-0000-4000-8000-000000002026', id, 'parade_director' from public.profiles where email = 'you@example.com';
```

### Deploying to Vercel

Import the repository, set the variables from `.env.example`, and deploy. For a custom domain hosted at GoDaddy, add the domain in Vercel and create the DNS records Vercel shows (an `A` record for the apex domain and a `CNAME` for `www`) in GoDaddy's DNS manager.

## Tests

```bash
npm test            # domain logic (vitest)
npm run test:db     # migrations + business rules against a throwaway PostgreSQL/PostGIS cluster
npm run typecheck && npm run lint
```

`test:db` needs PostgreSQL 15+ with PostGIS installed locally. `supabase/tests/supabase_shim.sql` stands in for the Supabase `auth` and `storage` schemas. Never apply that file to a real project.

## Before launch (SDS §10)

All Southport geometry in `seed.sql` is a **placeholder** and is marked `field_validated = false`. Before any staging plan is approved, the following must be confirmed with the responsible authorities:

- staging boundaries, especially the shoreline construction area (seeded as a safety restriction on West Bay block 3)
- road dimensions and emergency access
- checkpoint placement and dispersal arrangements

Also still open: fees, the approval policy, the hosting domain, official dates, and which organization runs the platform.
