# Waitlist + Klaviyo setup

Step-by-step for wiring the marketing-site waitlist to Klaviyo. The code side
(`api/waitlist.ts`, `api/confirm.ts`, `_lib.ts`) is already in place — this
doc covers everything you have to do in the Klaviyo + Vercel UIs.

## 1. Klaviyo account prep

### a. Create the private API key
1. Klaviyo → **Account → Settings → API Keys**
2. **Create Private API Key**
   - Name: `attic-landing (Vercel)`
   - Permissions: enable `Profiles: Read/Write` and `Lists: Read/Write`
3. Copy the `pk_...` value — you'll paste it into Vercel in step 3.

### b. Create the two lists
Both lists need to exist before traffic hits `/api/waitlist`. The code adds
profiles to them by ID, so the IDs are referenced as env vars.

1. **Audience → Lists & Segments → Create List → List**
   - Name: `Waitlist - Unconfirmed`
   - Description: "Filled the form on attic.it.com; hasn't clicked the
     double-opt-in link yet."
2. Same for `Waitlist - Confirmed`.
3. On each list page, copy the **List ID** from the URL or the list info
   panel (looks like `WaXyZ1`). Save both — they go into Vercel.

> Keep Klaviyo's built-in "single opt-in" setting on these lists. We do the
> opt-in handshake ourselves via the confirm-token link so we can flip Harper
> in lockstep with Klaviyo. Don't enable Klaviyo's built-in double opt-in or
> it'll fight our flow.

## 2. Build the four flows

All flows live under **Flows → Create Flow → From scratch**, then set the
trigger as described. Each one has a single email (you can add more later).
Match the brand: terracotta + sage, Fraunces for the heading, no mascot.

### Flow 1 — Confirmation email
- **Trigger:** *List-triggered* → `Waitlist - Unconfirmed`
- **Filter:** none
- **Email:**
  - Subject: `One quick step — confirm your spot on the Attic waitlist`
  - Preheader: `Tap the button below and you're in.`
  - Single CTA button → `{{ person.waitlist_confirm_url }}`
    - Button label: `Confirm my spot`
  - Body copy idea (negative-space brand):
    > You just reserved a spot for **{{ person.waitlist_zip }}**.
    > Tap below to confirm it's really you and we'll let you know the
    > minute Attic reaches your neighborhood.
- **Delay:** send immediately on list-add.

### Flow 2 — Welcome (post-confirmation)
- **Trigger:** *List-triggered* → `Waitlist - Confirmed`
- **Email:**
  - Subject: `You're on the list. Here's what comes next.`
  - Body: 2-3 paragraphs framing Attic as "what isn't there anymore" — no
    clutter, no storage-unit trips, no hauling. Mention Denver rollout
    cadence ("small batches, neighborhood by neighborhood"). End with a
    soft referral nudge.
- **Delay:** send immediately on list-add.

### Flow 3 — Referral nudge
- **Trigger:** *List-triggered* → `Waitlist - Confirmed`
- **Delay:** 48 hours
- **Email:**
  - Subject: `Know a neighbor? They jump the line — so do you.`
  - Body: Explain that we route by neighborhood density, so referrals
    from the same zip move *both* people up. Single share link:
    `https://attic.it.com/?ref={{ person.waitlist_zip }}` (no actual ref
    tracking yet — that's a future build).

### Flow 4 — Neighborhood-ready (segment-triggered, optional for launch)
- **Audience → Segments → Create Segment:**
  - Properties about someone → `waitlist_zip` equals one of `<your zip list>`
  - AND is in list `Waitlist - Confirmed`
- **Flow trigger:** *Segment-triggered* → the segment above
- **Email:** "We're opening in your zip — your invite is coming this week."
- Use this when a zip crosses the threshold to launch. Manual today; can
  automate by zip count later.

## 3. Vercel environment variables

In the Vercel dashboard for `attic-landing` → **Settings → Environment
Variables**, add the following (Production + Preview):

| Name | Value | Notes |
|---|---|---|
| `HARPER_BASE_URL` | `https://app.attic.it.com` | The waitlist Resources are at `/WaitlistSignup` and `/WaitlistConfirm` there. |
| `KLAVIYO_API_KEY` | `pk_...` from step 1a | Private — never commit. |
| `KLAVIYO_UNCONFIRMED_LIST_ID` | List ID from step 1b | e.g. `WaXyZ1`. |
| `KLAVIYO_CONFIRMED_LIST_ID` | List ID from step 1b | |
| `KLAVIYO_API_REVISION` | `2024-10-15` | Optional — defaults to this if unset. Bump deliberately when migrating. |
| `MARKETING_SITE_URL` | `https://attic.it.com` | Used to construct the confirm URL written onto the Klaviyo profile. |

After saving, redeploy (Settings → Deployments → ⋯ → Redeploy) so the
functions pick up the new values.

## 4. Smoke test

1. From `attic.it.com/#waitlist`, submit the form with a real email + a
   Denver zip.
2. Check Harper admin → **/admin/waitlist** — the row should appear with
   `status: pending_confirm`.
3. Check the inbox for the confirmation email (Klaviyo flow 1).
4. Click the confirm link. You should land on `/confirmed`.
5. Re-check `/admin/waitlist` — `status` should now be `confirmed` and
   `confirmed_at` populated.
6. Welcome email (flow 2) should arrive within a minute.
7. Submit again with the same email — the form should show the
   "already on the list" success copy and no new Harper row should appear.

## 5. Things to add later

- `?ref=` tracking on the share link (Harper column + attribution).
- Density-based auto-trigger for Flow 4 (today: manual segment).
- Out-of-Denver geographic auto-segment that sends a "we'll let you know
  when we reach [city]" email so non-Denver zips don't get the launch flow.
- Klaviyo Reviews / SMS once we're past free tier.
