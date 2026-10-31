# Parade Marshal

A mobile-first platform for managing a community parade from registration through staging, dispatch, live checkpoint tracking and the spectator portal. It is configured first for the **Southport Christmas Parade** (Southport, NC), and every record is scoped to an event so other towns can run their own parades.

Stack: Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + PostGIS, Auth, RLS, Storage) · Vercel.

## What's built

| Area (SDS) | Where |
| --- | --- |
| Registration with drafts, vehicles, footprint, waiver and QR pass (FR-02) | `/events/[slug]/register`, `/my` |
| Application review with role-aware transitions (FR-02) | Staff → Applications |
| Unit registry: split multi-vehicle entries, reissue passes, print passes | Staff → Unit Registry |
| Staging map editor: draw streets, route and checkpoints; edit blocks and lanes; place units by measured footprint; live conflict checks; restrictions; plan approval with versioning; arrival instructions (FR-03, FR-04) | Staff → Staging Map |
| Lineup builder: drag-and-drop or keyboard reordering, final unit, feasibility warnings (lane order, consecutive bands, split groups), publish to spectators (FR-05) | Staff → Lineup Builder |
| Dispatch center: single active authorization, release, revoke, hold/skip, parade-wide hold, conflict resolution, live via Supabase Realtime (FR-06) | Staff → Dispatch Center |
| Marshal field app: QR scan check-in, staged/ready, checkpoint passage, incident reports, offline queue showing "saved on device" vs "synced" (FR-06, FR-07) | `/marshal` |
| Checkpoint progress matrix (FR-07) | Staff → Checkpoints |
| Incidents and restrictions (FR-04, FR-09) | Staff → Safety & Alerts |
| Announcements (public, participants, staff, emergency) and email/SMS delivery log (FR-09) | Staff → Communications |
| Staff roles by email, positions and shifts | Staff → Volunteers |
| Reports, CSV export, printable operational plan (FR-10, §6) | Staff → Reports |
| Event settings, categories, next-year duplication (FR-01) | Staff → Event Settings |
| Spectator page: route map, published lineup, approximate progress, announcements, favorites (on device), People's Choice voting, sponsors, photo gallery (FR-08) | `/events/[slug]`, `/events/[slug]/photos` |
| Sponsors, voting window and results, photo moderation (FR-08 enhancements) | Staff → Engagement |
| Audit history (§6) | Staff → Audit History |

Not yet built: payment processing (fees are disabled by policy) and participant-uploaded entry media.

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
4. In **Auth → Email Templates → Magic Link**, use a template that works on any device and includes a code:

```html
<h2>Sign in to Parade Marshal</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/my">Sign in</a></p>
<p>Or enter this code: <strong>{{ .Token }}</strong></p>
```

   Set **Site URL** to your production address (e.g. `https://parademarshall.vercel.app`). The default template's link only works when opened in the same browser that requested it. The code works anywhere.
5. Sign in once through the app, then make yourself the administrator and director:

```sql
update public.profiles set is_system_admin = true where email = 'you@example.com';
insert into public.event_roles (event_id, user_id, role)
select '00000000-0000-4000-8000-000000002026', id, 'parade_director' from public.profiles where email = 'you@example.com';
```

### Realtime

The Dispatch Center and marshal screens subscribe to database changes. The migrations add the operational tables to the `supabase_realtime` publication; Realtime applies the same RLS policies, so spectators receive nothing. If the connection drops, screens fall back to polling.

### Notifications

Status changes, arrival instructions and incident alerts are queued in `notifications`. They are delivered by `/api/cron/notifications` (Vercel Cron, daily on the Hobby plan) or immediately with **Deliver pending now** on the Communications page. Configure `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and either Resend (email) or Twilio (SMS). Without a provider, messages stay queued. SMS falls back to email.

### Map tiles

Maps use OpenStreetMap tiles, which suit low-volume use under the [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/). For a high-traffic public page, switch the tile URL in `src/components/map/parade-map.tsx` to a commercial provider.

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
