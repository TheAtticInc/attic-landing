/**
 * api/beta.ts — Vercel edge function for the Friends & Family tester signup.
 *
 * POST /api/beta
 *   { email, name?, platform: 'android' | 'ios', _h? }
 *
 * Single opt-in, Klaviyo-only (no Harper — the waitlist's WaitlistSignup
 * resource hard-requires a ZIP, which F&F testers don't have). Android testers
 * land on the "F&F Testers" list (their email is exported into Play Console's
 * closed test); iPhone folks land on "iOS Interest" to be notified at iOS launch.
 *
 * The `_h` honeypot mirrors /api/waitlist: a filled value returns 200 ok with
 * no write so bots learn nothing.
 */

import { readEnv, json, validateEmail, callKlaviyo, type Env } from './_lib';

export const config = { runtime: 'edge' };

interface FormBody {
  email?: unknown;
  name?: unknown;
  platform?: unknown;
  _h?: unknown;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: FormBody;
  try {
    body = await req.json() as FormBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // Honeypot — 200 so bots don't learn anything; skip the work.
  if (typeof body._h === 'string' && body._h.trim().length > 0) {
    return json({ ok: true });
  }

  if (!validateEmail(body.email)) return json({ error: 'invalid_email' }, 400);
  const platform = body.platform === 'ios' ? 'ios' : body.platform === 'android' ? 'android' : null;
  if (!platform) return json({ error: 'invalid_platform' }, 400);

  let env: Env;
  try {
    env = readEnv();
  } catch (err) {
    console.error('[beta] env config error:', err);
    return json({ error: 'server_misconfigured' }, 500);
  }

  const listId = platform === 'android' ? env.klaviyoFfListId : env.klaviyoIosListId;
  if (!listId) {
    console.error(`[beta] missing list id for platform=${platform} (set KLAVIYO_FF_LIST_ID / KLAVIYO_IOS_LIST_ID)`);
    return json({ error: 'server_misconfigured' }, 500);
  }

  const email = body.email.trim().toLowerCase();
  const name = clip(body.name, 100);
  const source = platform === 'android' ? 'ff_tester' : 'ios_interest';
  const now = new Date().toISOString();

  try {
    // 1. Upsert the profile + stamp our F&F properties (idempotent on email).
    await callKlaviyo(env, '/profile-import/', {
      method: 'POST',
      body: {
        data: {
          type: 'profile',
          attributes: {
            email,
            ...(name ? { first_name: name } : {}),
            properties: { ff_name: name, ff_platform: platform, ff_source: source, ff_signup_at: now },
          },
        },
      },
    });

    // 2. Subscribe (single opt-in — they consented on the form) AND add to the
    // list in one call. The marketing email consent is what lets the "you're on
    // the list" welcome flow actually deliver; a bare list-add wouldn't.
    await callKlaviyo(env, '/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      body: {
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            custom_source: source === 'ff_tester' ? 'F&F tester signup' : 'iOS interest signup',
            profiles: {
              data: [{
                type: 'profile',
                attributes: { email, subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } },
              }],
            },
          },
          relationships: { list: { data: { type: 'list', id: listId } } },
        },
      },
    });
  } catch (err) {
    console.error('[beta] Klaviyo write failed:', err);
    return json({ error: 'save_failed' }, 502);
  }

  return json({ ok: true });
}
