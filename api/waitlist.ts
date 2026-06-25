/**
 * api/waitlist.ts — Vercel edge function.
 *
 * POST /api/waitlist
 *   { email, zip, _h? }
 *
 * Validates input → writes Harper WaitlistSignup row → upserts Klaviyo profile
 * + adds to the Unconfirmed list (triggering the double-opt-in email flow).
 *
 * The `_h` field is a honeypot — visible in the DOM only via display:none, so
 * real users never fill it. Bot-filled submissions get a 200 ok response but
 * no write actually happens.
 *
 * Klaviyo writes are best-effort: if Klaviyo is down, the Harper row still
 * lands and we'll see the signup in /admin/waitlist. Better to record demand
 * than to fail the form because a third party hiccuped.
 */

import { readEnv, json, validateEmail, validateZip, hashIp, callHarper, klaviyoUpsertProfile, klaviyoAddToList, klaviyoTrackEvent } from './_lib';

export const config = { runtime: 'edge' };

interface FormBody {
  email?: unknown;
  zip?: unknown;
  _h?: unknown;
  source?: unknown;
}

interface HarperSignupResponse {
  uuid: string;
  confirm_token: string | null;
  already_confirmed?: boolean;
  already_pending?: boolean;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: FormBody;
  try {
    body = await req.json() as FormBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Honeypot — bots scribble in every text field. Return 200 so they don't
  // learn anything from a 4xx, but skip the actual work.
  if (typeof body._h === 'string' && body._h.trim().length > 0) {
    return json({ ok: true });
  }

  if (!validateEmail(body.email)) return json({ error: 'invalid_email' }, 400);
  if (!validateZip(body.zip)) return json({ error: 'invalid_zip' }, 400);

  let env;
  try {
    env = readEnv();
  } catch (err) {
    console.error('[waitlist] env config error:', err);
    return json({ error: 'server_misconfigured' }, 500);
  }

  const email = body.email.trim().toLowerCase();
  const zip = body.zip.trim();
  const source = typeof body.source === 'string' && body.source.length <= 100
    ? body.source
    : 'attic.it.com';
  const ip_hash = await hashIp(req);
  const user_agent = req.headers.get('user-agent') ?? '';

  // 1. Harper write — this is the system of record. If it fails, fail the
  // whole request so the user retries (rather than silently dropping into
  // Klaviyo with no admin visibility).
  let harperResult: HarperSignupResponse;
  try {
    harperResult = await callHarper<HarperSignupResponse>(env, '/WaitlistSignup', {
      email,
      zip,
      source,
      ip_hash: ip_hash ?? '',
      user_agent,
    });
  } catch (err) {
    console.error('[waitlist] Harper write failed:', err);
    return json({ error: 'save_failed' }, 502);
  }

  // Already confirmed → return early. We don't re-trigger Klaviyo for these;
  // the user has already gotten the welcome email.
  if (harperResult.already_confirmed) {
    return json({ ok: true, already_confirmed: true });
  }

  // 2. Klaviyo upsert + list add — best-effort. Log + swallow errors so the
  // user still sees a success state even if Klaviyo is having a bad day.
  if (harperResult.confirm_token) {
    const confirm_url = `${env.marketingSiteUrl}/api/confirm?token=${encodeURIComponent(harperResult.confirm_token)}`;
    try {
      const profileId = await klaviyoUpsertProfile(env, {
        email,
        zip,
        confirm_token: harperResult.confirm_token,
        confirm_url,
        source,
      });
      await klaviyoAddToList(env, env.klaviyoUnconfirmedListId, profileId);
      // Fire the metric that the transactional, metric-triggered confirm flow
      // listens for. confirm_url rides along so the flow email can render it.
      await klaviyoTrackEvent(env, 'Waitlist Signed Up', email, {
        confirm_url,
        confirm_token: harperResult.confirm_token,
        zip,
        source,
      });
    } catch (err) {
      console.error('[waitlist] Klaviyo write failed (Harper write succeeded):', err);
    }
  }

  return json({ ok: true });
}
