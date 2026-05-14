/**
 * api/confirm.ts — Vercel edge function.
 *
 * GET /api/confirm?token=<uuid>
 *
 * Called when a waitlist signup clicks the link in their Klaviyo confirmation
 * email. We:
 *   1. POST the token to Harper /WaitlistConfirm → row flips to 'confirmed'.
 *   2. Look up the Klaviyo profile by email + add it to the Confirmed list
 *      (which triggers the welcome-email flow in Klaviyo).
 *   3. Redirect to /confirmed.html so the user sees a static thank-you page.
 *
 * Bad / missing / expired token → redirect to /confirm-error.html.
 *
 * Klaviyo failures here are non-fatal: the Harper status is already flipped
 * and the user has shown clear intent, so we render the thank-you regardless.
 * An ops query on (Harper status=confirmed, Klaviyo membership) can reconcile
 * stragglers later if Klaviyo had an outage.
 */

import { readEnv, callHarper, callKlaviyo, klaviyoAddToList } from './_lib';

export const config = { runtime: 'edge' };

interface HarperConfirmResponse {
  ok: true;
  email: string;
  zip: string;
  already_confirmed?: boolean;
}

interface KlaviyoProfileSearch {
  data: { id: string }[];
}

function redirect(target: string): Response {
  return new Response(null, { status: 302, headers: { Location: target } });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return redirect('/confirm-error.html');

  let env;
  try {
    env = readEnv();
  } catch (err) {
    console.error('[confirm] env config error:', err);
    return redirect('/confirm-error.html');
  }

  // 1. Flip Harper status. Bad/missing token → 404 → error page.
  let harperResult: HarperConfirmResponse;
  try {
    harperResult = await callHarper<HarperConfirmResponse>(env, '/WaitlistConfirm', { token });
  } catch (err) {
    console.error('[confirm] Harper confirm failed:', err);
    return redirect('/confirm-error.html');
  }

  // 2. Move Klaviyo profile to Confirmed list — best-effort. Already-
  // confirmed callers still get re-added (idempotent) so a re-clicked link
  // doesn't break flows that depend on list membership.
  try {
    const profileId = await findKlaviyoProfileIdByEmail(env, harperResult.email);
    if (profileId) {
      await klaviyoAddToList(env, env.klaviyoConfirmedListId, profileId);
    } else {
      console.warn('[confirm] no Klaviyo profile found for', harperResult.email);
    }
  } catch (err) {
    console.error('[confirm] Klaviyo list-move failed (Harper confirmed):', err);
  }

  return redirect('/confirmed.html');
}

async function findKlaviyoProfileIdByEmail(env: ReturnType<typeof readEnv>, email: string): Promise<string | null> {
  // Klaviyo profile filter: ?filter=equals(email,"x")
  const filter = encodeURIComponent(`equals(email,"${email.replace(/"/g, '\\"')}")`);
  const res = await callKlaviyo<KlaviyoProfileSearch>(env, `/profiles/?filter=${filter}`, { method: 'GET' });
  return res.data?.[0]?.id ?? null;
}
