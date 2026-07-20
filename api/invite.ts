/**
 * api/invite.ts — Vercel edge function.
 *
 * GET /api/invite?code=K7M4QR
 *   → { ok: true, referrer_name: "Maya C." }   real code
 *   → { ok: false }                            unknown/malformed
 *
 * Thin proxy to Harper's anonymous GET /ReferralInvite (attic-dev). Exists so
 * the /r/<code> invite page personalizes ("Maya gave you $20") without the
 * browser talking to the API host directly. Shape-validates before proxying;
 * short CDN cache since names change ~never.
 */

import { json } from './_lib';

export const config = { runtime: 'edge' };

const CODE_SHAPE = /^[A-Za-z0-9]{6}$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  const url = new URL(req.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  if (!CODE_SHAPE.test(code)) return json({ ok: false });

  const base = process.env.HARPER_BASE_URL;
  if (!base) return json({ ok: false });

  try {
    const res = await fetch(`${base}/ReferralInvite?code=${encodeURIComponent(code.toUpperCase())}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return json({ ok: false });
    const data = (await res.json()) as { ok?: boolean; referrer_name?: string };
    const body = data?.ok && typeof data.referrer_name === 'string'
      ? { ok: true, referrer_name: data.referrer_name }
      : { ok: false };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        // Cache hits at the edge; a referrer's short name is effectively static.
        'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch {
    return json({ ok: false });
  }
}
