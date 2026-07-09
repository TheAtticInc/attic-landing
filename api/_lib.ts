/**
 * api/_lib.ts — shared helpers for the marketing-site API functions.
 *
 * Filename prefix `_` keeps Vercel from treating this as its own route.
 *
 * Edge runtime: only Web APIs (fetch, crypto.subtle, Request/Response).
 */

const KLAVIYO_REVISION = process.env.KLAVIYO_API_REVISION ?? '2024-10-15';

export interface Env {
  harperBaseUrl: string;
  klaviyoApiKey: string;
  klaviyoUnconfirmedListId: string;
  klaviyoConfirmedListId: string;
  marketingSiteUrl: string;
  // Friends & Family tester lists — optional so the waitlist endpoint never
  // fails if they're not configured. The /api/beta endpoint validates its own.
  klaviyoFfListId?: string;
  klaviyoIosListId?: string;
  // Resend — transactional welcome email for F&F signups. Optional so the
  // waitlist endpoint never fails if it isn't configured.
  resendApiKey?: string;
}

export function readEnv(): Env {
  const harperBaseUrl = process.env.HARPER_BASE_URL;
  const klaviyoApiKey = process.env.KLAVIYO_API_KEY;
  const klaviyoUnconfirmedListId = process.env.KLAVIYO_UNCONFIRMED_LIST_ID;
  const klaviyoConfirmedListId = process.env.KLAVIYO_CONFIRMED_LIST_ID;
  const marketingSiteUrl = process.env.MARKETING_SITE_URL ?? 'https://www.heyattic.com';
  const klaviyoFfListId = process.env.KLAVIYO_FF_LIST_ID;
  const klaviyoIosListId = process.env.KLAVIYO_IOS_LIST_ID;
  const resendApiKey = process.env.RESEND_API_KEY;

  // Surface a clear server-config error if anything's missing — better than a
  // mysterious 500 from a downstream call with an undefined Authorization
  // header. The form returns the message to the user as "Couldn't save —
  // please try again," so the actual error stays in the function log.
  if (!harperBaseUrl) throw new Error('Missing HARPER_BASE_URL');
  if (!klaviyoApiKey) throw new Error('Missing KLAVIYO_API_KEY');
  if (!klaviyoUnconfirmedListId) throw new Error('Missing KLAVIYO_UNCONFIRMED_LIST_ID');
  if (!klaviyoConfirmedListId) throw new Error('Missing KLAVIYO_CONFIRMED_LIST_ID');

  return {
    harperBaseUrl,
    klaviyoApiKey,
    klaviyoUnconfirmedListId,
    klaviyoConfirmedListId,
    marketingSiteUrl,
    klaviyoFfListId,
    klaviyoIosListId,
    resendApiKey,
  };
}

/**
 * Send a transactional email through Resend. Plain + personal on purpose —
 * transactional sends from our own domain land in the Primary tab, unlike the
 * Klaviyo marketing flow which Gmail files under Promotions. Best-effort:
 * callers log + swallow failures so a send hiccup never fails the signup.
 *
 * `from` is the org (not a person — emails come from Attic, per Luke
 * 2026-07-09) on our verified domain (DKIM signs as attic.it.com;
 * Return-Path is rp.attic.it.com → SPF+DKIM both align).
 */
export async function sendResendEmail(
  env: Env,
  msg: { to: string; subject: string; html: string; text: string },
): Promise<void> {
  if (!env.resendApiKey) {
    console.error('[resend] RESEND_API_KEY not set — skipping welcome email to', msg.to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Attic <hello@heyattic.com>',
      reply_to: 'hello@heyattic.com',
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Render the waitlist double-opt-in confirm email. Kept plain + text-forward on
 * purpose: a transactional, single-CTA email from our own domain lands in the
 * Primary inbox, whereas the same thing sent as a Klaviyo marketing flow gets
 * filed under Promotions. One terracotta button + the raw link as a fallback.
 */
export function renderWaitlistConfirmEmail(confirmUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your spot on the Attic waitlist';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#faf7f2;font-family:-apple-system,'Segoe UI',Roboto,sans-serif;color:#2b2b2b;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi there,</p>
    <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Thanks for joining the Attic waitlist — you're almost in. Just confirm your email to lock in your spot:</p>
    <p style="margin:0 0 24px;"><a href="${confirmUrl}" style="display:inline-block;background:#C65D3C;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:16px;font-weight:600;">Confirm my spot</a></p>
    <p style="font-size:14px;line-height:1.6;color:#666666;margin:0 0 24px;">Or paste this link into your browser:<br><a href="${confirmUrl}" style="color:#C65D3C;">${confirmUrl}</a></p>
    <p style="font-size:14px;line-height:1.6;color:#666666;margin:0;">Didn't sign up? You can safely ignore this email.</p>
    <p style="font-size:14px;line-height:1.6;color:#666666;margin:24px 0 0;">— The Attic team · <a href="mailto:hello@heyattic.com" style="color:#C65D3C;">hello@heyattic.com</a></p>
  </div>
</body></html>`;
  const text = `Hi there,

Thanks for joining the Attic waitlist — you're almost in. Confirm your email to lock in your spot:

${confirmUrl}

Didn't sign up? You can safely ignore this email.

— The Attic team · hello@heyattic.com`;
  return { subject, html, text };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function validateEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function validateZip(zip: unknown): zip is string {
  return typeof zip === 'string' && /^\d{5}$/.test(zip);
}

/**
 * SHA-256 hex of the source IP — recorded with the signup so we can spot
 * abuse patterns without storing raw IPs alongside emails. Returns null if
 * no IP header was found (local dev, unusual proxies).
 */
export async function hashIp(req: Request): Promise<string | null> {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
  const ip = fwd.split(',')[0]?.trim();
  if (!ip) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Harper Resource call. The WaitlistSignup + WaitlistConfirm Resources set
 * checkPermission=false so we don't pass an Authorization header.
 */
export async function callHarper<T = unknown>(
  env: Env,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${env.harperBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const message = (parsed && typeof parsed === 'object' && 'message' in parsed)
      ? String((parsed as { message: unknown }).message)
      : (typeof parsed === 'string' ? parsed : `Harper ${res.status}`);
    const err = new Error(message);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return parsed as T;
}

/**
 * Klaviyo API call. Klaviyo uses a JSON:API-ish payload shape and a
 * `revision` header pinning the API contract version.
 */
export async function callKlaviyo<T = unknown>(
  env: Env,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Klaviyo-API-Key ${env.klaviyoApiKey}`,
    revision: KLAVIYO_REVISION,
    accept: 'application/json',
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`https://a.klaviyo.com/api${path}`, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  // 204 = success with no body (subscribe / list-add endpoints)
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const err = new Error(`Klaviyo ${res.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return parsed as T;
}

/**
 * Upsert a Klaviyo profile by email and write our custom waitlist fields
 * onto it. Returns the profile id (klaviyo "id" attribute) for downstream
 * list operations.
 *
 * `profile-import` is Klaviyo's documented upsert path — POST with the same
 * email is idempotent and returns the existing profile rather than 409-ing.
 */
export async function klaviyoUpsertProfile(
  env: Env,
  attrs: {
    email: string;
    zip: string;
    confirm_token: string;
    confirm_url: string;
    source: string;
  },
): Promise<string> {
  const res = await callKlaviyo<{ data: { id: string } }>(env, '/profile-import/', {
    method: 'POST',
    body: {
      data: {
        type: 'profile',
        attributes: {
          email: attrs.email,
          properties: {
            waitlist_zip: attrs.zip,
            waitlist_confirm_token: attrs.confirm_token,
            waitlist_confirm_url: attrs.confirm_url,
            waitlist_source: attrs.source,
          },
        },
      },
    },
  });
  return res.data.id;
}

/**
 * Add a profile to a Klaviyo list. Triggers any flows configured to fire
 * "when a profile is added to list <id>" in the Klaviyo UI.
 */
export async function klaviyoAddToList(env: Env, listId: string, profileId: string): Promise<void> {
  await callKlaviyo(env, `/lists/${listId}/relationships/profiles/`, {
    method: 'POST',
    body: {
      data: [{ type: 'profile', id: profileId }],
    },
  });
}

/**
 * Track a custom Klaviyo event (metric) on a profile. We fire this so the
 * double-opt-in confirm email can run off a METRIC-triggered flow rather than
 * a list-triggered one — only metric-triggered flow messages can be designated
 * transactional in Klaviyo, and transactional is what lets the confirm email
 * send to an as-yet-unconfirmed (i.e. unsubscribed) profile. The `confirm_url`
 * rides along as an event property so the flow email can render the link via
 * {{ event.confirm_url }}.
 */
export async function klaviyoTrackEvent(
  env: Env,
  metricName: string,
  email: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await callKlaviyo(env, '/events/', {
    method: 'POST',
    body: {
      data: {
        type: 'event',
        attributes: {
          properties,
          metric: { data: { type: 'metric', attributes: { name: metricName } } },
          profile: { data: { type: 'profile', attributes: { email } } },
        },
      },
    },
  });
}
