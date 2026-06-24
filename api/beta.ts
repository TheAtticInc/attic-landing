/**
 * api/beta.ts — Vercel edge function for the Friends & Family tester signup.
 *
 * POST /api/beta
 *   { email, name?, platform: 'android' | 'ios', _h? }
 *
 * Klaviyo holds the LIST (profile + list membership + marketing consent); the
 * welcome email goes out via RESEND as a plain, personal transactional message
 * so it lands in Gmail's Primary tab instead of Promotions. Android testers
 * land on the "F&F Testers" list (their email is exported into Play Console's
 * closed test); iPhone folks land on "iOS Interest". The Klaviyo welcome FLOW
 * is disabled — Resend is the only sender now.
 *
 * The `_h` honeypot mirrors /api/waitlist: a filled value returns 200 ok with
 * no write so bots learn nothing.
 */

import { readEnv, json, validateEmail, callKlaviyo, klaviyoAddToList, sendResendEmail, type Env } from './_lib';

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/**
 * Plain, personal welcome email — deliberately not a marketing template (no
 * images, no buttons, signed by a person) so Gmail keeps it in Primary.
 */
function buildWelcomeEmail(platform: 'android' | 'ios', name: string): { subject: string; html: string; text: string } {
  const hi = name ? escapeHtml(name) : 'there';
  const hiText = name || 'there';
  const wrap = (paras: string[]) =>
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#23180F;max-width:560px">`
    + paras.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join('')
    + `</div>`;

  if (platform === 'android') {
    return {
      subject: "You're on the Attic Friends & Family list",
      text:
        `Hi ${hiText},\n\n`
        + `Thanks for signing up to help test the Attic app — you're on the Friends & Family list.\n\n`
        + `What happens next: once we've gathered everyone, you'll get a separate email from Google Play with your invite to install the app. That's the one that gets you in, so keep an eye out — and if it lands in spam or the Promotions tab, drag it to your inbox so you don't miss it.\n\n`
        + `As a thank-you for testing, you'll get a $50 Attic storage credit when we launch.\n\n`
        + `Any questions, just reply — this comes straight to me.\n\n— Luke\nAttic`,
      html: wrap([
        `Hi ${hi},`,
        `Thanks for signing up to help test the Attic app — you're on the Friends &amp; Family list.`,
        `<strong>What happens next:</strong> once we've gathered everyone, you'll get a separate email from <strong>Google Play</strong> with your invite to install the app. That's the one that gets you in, so keep an eye out — and if it lands in spam or the Promotions tab, drag it to your inbox so you don't miss it.`,
        `As a thank-you for testing, you'll get a <strong>$50 Attic storage credit</strong> when we launch.`,
        `Any questions, just reply — this comes straight to me.`,
        `— Luke<br>Attic`,
      ]),
    };
  }
  return {
    subject: "You're on the Attic iOS list",
    text:
      `Hi ${hiText},\n\n`
      + `Thanks! The Attic app is Android-only for this first round of testing, but you're on the iOS list — I'll email you the moment the iPhone version is ready to try.\n\n`
      + `Any questions, just reply.\n\n— Luke\nAttic`,
    html: wrap([
      `Hi ${hi},`,
      `Thanks! The Attic app is Android-only for this first round of testing, but you're on the iOS list — I'll email you the moment the iPhone version is ready to try.`,
      `Any questions, just reply.`,
      `— Luke<br>Attic`,
    ]),
  };
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

  // Required path: upsert the profile (+ F&F properties) and add to the list.
  // The list-add triggers the "you're on the list" welcome flow (same mechanism
  // as the waitlist confirm flow). If this fails we fail the request so the user
  // retries rather than silently dropping.
  try {
    const profileRes = await callKlaviyo<{ data: { id: string } }>(env, '/profile-import/', {
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
    await klaviyoAddToList(env, listId, profileRes.data.id);
  } catch (err) {
    console.error('[beta] Klaviyo write failed:', err);
    return json({ error: 'save_failed' }, 502);
  }

  // Best-effort: record single-opt-in marketing consent (they consented on the
  // form) so the marketing welcome flow can deliver. Non-fatal. The revision is
  // PINNED to 2024-10-15 here (not env-driven) because the subscription-bulk
  // endpoint is revision-sensitive and a stale KLAVIYO_API_REVISION env was
  // silently failing this call in production.
  try {
    const subRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${env.klaviyoApiKey}`,
        revision: '2024-10-15',
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'profile-subscription-bulk-create-job',
          attributes: {
            custom_source: source === 'ff_tester' ? 'F&F tester signup' : 'iOS interest signup',
            profiles: { data: [{ type: 'profile', attributes: { email, subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } } }] },
          },
          relationships: { list: { data: { type: 'list', id: listId } } },
        },
      }),
    });
    if (!subRes.ok) throw new Error(`subscribe ${subRes.status}: ${(await subRes.text()).slice(0, 200)}`);
  } catch (err) {
    console.error('[beta] Klaviyo subscribe (non-fatal) failed:', err);
  }

  // Welcome email via Resend (transactional + personal → Primary tab). Replaces
  // the Klaviyo marketing flow. Best-effort: they're already on the list, so a
  // send hiccup shouldn't fail the signup.
  try {
    const mail = buildWelcomeEmail(platform, name);
    await sendResendEmail(env, { to: email, ...mail });
  } catch (err) {
    console.error('[beta] Resend welcome email (non-fatal) failed:', err);
  }

  return json({ ok: true });
}
