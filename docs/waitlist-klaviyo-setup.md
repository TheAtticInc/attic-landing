# Waitlist + Klaviyo setup

Step-by-step for wiring the marketing-site waitlist to Klaviyo. The code side
(`api/waitlist.ts`, `api/confirm.ts`, `_lib.ts`) is already in place — this
doc covers the Klaviyo + Vercel UI work.

Most of it is automated by `scripts/setup-klaviyo.mjs`. The only manual step
is wiring 4 flows in Klaviyo (their flow-create API is gated; ~5 min of
clicking with the templates the script pre-builds).

## 1. Get the Klaviyo API key

1. Klaviyo → **Account → Settings → API Keys**
2. **Create Private API Key**
   - Name: `attic-landing (Vercel)`
   - Permissions: enable **Profiles: Read/Write**, **Lists: Read/Write**, **Templates: Read/Write**
3. Save the `pk_...` value into `attic-landing/.env.local`:
   ```
   KLAVIYO_API_KEY=pk_...
   ```
   (That file is gitignored.)

## 2. Run the setup script

```sh
cd attic-landing
node scripts/setup-klaviyo.mjs
```

It will (idempotently — safe to re-run):
- Create the two Lists: `Waitlist - Unconfirmed` and `Waitlist - Confirmed`
- Create 4 branded email templates: Confirm, Welcome, Referral Nudge,
  Neighborhood Ready
- Print a Vercel env var block + per-flow wiring instructions

Re-running won't overwrite existing items — if a list or template with the
expected name is already there, it reuses the existing ID.

## 3. Set the Vercel env vars

Copy the env block the script printed and paste into **Vercel → attic-landing
→ Settings → Environment Variables**. Set them all to apply to *Production*
and *Preview*. (Or use the `vercel env add ...` one-liners the script also
printed — same outcome.)

After saving, redeploy so the functions pick up the new values.

## 4. Wire the 4 flows in Klaviyo UI (~5 min)

The script doesn't build flows because Klaviyo's flow-create API is still
gated. Each flow is ~30 seconds in their UI:

1. **Flows → Create Flow → From scratch**
2. Pick the trigger as noted in the script output (list-triggered for 3 of
   them; the 4th is segment-triggered and optional for launch).
3. Drag in an **Email** action.
4. Inside the email step, click "**Drag & drop my email**" then choose
   "**Use existing template**" and pick the matching template the script
   created. Paste the subject line from the script's output.
5. For Flow 3 (referral nudge), add a 48-hour **Time delay** before the email.
6. Save + set the flow to **Live**.

Repeat for each flow. The script's "Manual flow wiring" output has the
exact trigger + template ID + subject for each one.

## 5. Smoke test

1. From `attic.it.com/#waitlist`, submit the form with a real email + a
   Denver zip.
2. Check `app.attic.it.com/admin/waitlist` — the row should appear with
   `status: pending_confirm`.
3. The confirmation email (Flow 1) should land in your inbox.
4. Click the confirm link. You should land on `/confirmed`.
5. Re-check `/admin/waitlist` — `status` should now be `confirmed`,
   `confirmed_at` populated.
6. Welcome email (Flow 2) should arrive within a minute.
7. Submit again with the same email — form should show the
   "already on the list" success copy, no new Harper row.

## 6. Things to add later

- `?ref=` tracking on the share link (Harper column + attribution).
- Density-based auto-trigger for Flow 4 (today: manual segment creation
  when a zip crosses your threshold).
- Out-of-Denver auto-segment for non-Denver zips → "we'll let you know when
  we reach [city]" email so they don't get the launch flow.
- SMS + reviews channels once we're past the Klaviyo free tier.
