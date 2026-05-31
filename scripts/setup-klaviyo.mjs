#!/usr/bin/env node
/**
 * scripts/setup-klaviyo.mjs — one-shot Klaviyo provisioner.
 *
 * Idempotent: creates `Waitlist - Unconfirmed`, `Waitlist - Confirmed` lists
 * + 4 branded email templates (confirm, welcome, referral-nudge,
 * neighborhood-ready) if they don't already exist; otherwise reuses the
 * existing IDs. Safe to re-run.
 *
 * After running, the script prints:
 *   - A `.env.local`-ready block of Vercel env vars
 *   - A `vercel env add` one-liner for each var (optional)
 *   - A short manual-steps checklist for the 4 flows (Klaviyo's flow-create
 *     API is gated; flows still need a few UI clicks to wire to triggers)
 *
 * Usage:
 *   node scripts/setup-klaviyo.mjs
 *
 * Reads KLAVIYO_API_KEY from .env.local.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

// --- Config ----------------------------------------------------------------

// 2025-10-15 is the first revision that supports POST /flows/. The runtime
// (api/_lib.ts) is pinned to 2024-10-15 because it only does profile + list
// operations, which are stable on the older revision.
const REVISION = '2025-10-15';

// Klaviyo creates a per-flow draft email with this from address by default;
// keep it consistent across the 3 flows so they look like one sender.
// hello@ is a real configured Google Workspace alias/group (not the orphaned
// hi@), and matches the branded sending domain set up in Klaviyo 2026-05-31.
const FROM_EMAIL = 'hello@attic.it.com';
const FROM_LABEL = 'Attic';

// Inbox-placement preview text per flow (empty preview text renders a raw
// HTML snippet in the inbox, which reads as spam). Keep these short + plain.
const PREVIEW_TEXT = {
  confirm:  'One tap to confirm your spot — takes a second.',
  welcome:  'Your space back, $15 a crate. Here is what happens next.',
  referral: 'A neighbor on the list moves you both up the line.',
};

const LIST_NAMES = {
  unconfirmed: 'Waitlist - Unconfirmed',
  confirmed: 'Waitlist - Confirmed',
};

const TEMPLATE_NAMES = {
  confirm:           'Attic Waitlist — Confirm Email',
  welcome:           'Attic Waitlist — Welcome',
  referral:          'Attic Waitlist — Referral Nudge',
  neighborhoodReady: 'Attic Waitlist — Neighborhood Ready',
};

// Flow names: our canonical ones + any prior names we know to clean up on
// rebuild (so an old run's mis-wired flows don't shadow the new ones).
const FLOW_NAMES = {
  confirm:  'Attic Waitlist · Confirm',
  welcome:  'Attic Waitlist · Welcome',
  referral: 'Attic Waitlist · Referral Nudge',
};
const FLOW_NAMES_TO_WIPE = new Set([
  ...Object.values(FLOW_NAMES),
  'Confirmation email',
  'Welcome (post-confirmation)',
  'Referral nudge',
]);

// --- Env -------------------------------------------------------------------

function loadDotEnv(file) {
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* missing file is fine — env may already be set */ }
}

loadDotEnv(join(repoRoot, '.env.local'));

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
if (!KLAVIYO_API_KEY) {
  console.error('Missing KLAVIYO_API_KEY in .env.local or environment.');
  process.exit(1);
}

// --- Klaviyo API helper ----------------------------------------------------

async function klaviyo(path, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
    revision: REVISION,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`https://a.klaviyo.com/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  if (!res.ok) {
    const detail = parsed?.errors?.[0]?.detail || (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
    throw new Error(`Klaviyo ${method} ${path} → ${res.status}: ${detail}`);
  }
  return parsed;
}

// --- Find-or-create helpers ------------------------------------------------

async function findOrCreateList(name) {
  // Klaviyo list filter: ?filter=equals(name,"X")
  const filter = encodeURIComponent(`equals(name,"${name.replace(/"/g, '\\"')}")`);
  const existing = await klaviyo(`/lists/?filter=${filter}`);
  if (existing?.data?.[0]?.id) {
    return { id: existing.data[0].id, created: false };
  }
  const created = await klaviyo('/lists/', {
    method: 'POST',
    body: { data: { type: 'list', attributes: { name } } },
  });
  return { id: created.data.id, created: true };
}

async function findOrCreateTemplate(name, html, subject) {
  const filter = encodeURIComponent(`equals(name,"${name.replace(/"/g, '\\"')}")`);
  const existing = await klaviyo(`/templates/?filter=${filter}`);
  const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (existing?.data?.[0]?.id) {
    const id = existing.data[0].id;
    // Upsert: push the current HTML so edits in this file actually take
    // effect on re-run (the flow rebuild below re-clones the updated template).
    await klaviyo(`/templates/${id}/`, {
      method: 'PATCH',
      body: { data: { type: 'template', id, attributes: { html, text: plainText } } },
    });
    return { id, created: false, updated: true, subject };
  }
  const created = await klaviyo('/templates/', {
    method: 'POST',
    body: {
      data: {
        type: 'template',
        attributes: {
          name,
          editor_type: 'CODE',
          html,
          // Klaviyo's "text" is the plain-text fallback. Strip tags from html
          // for a passable default; users can refine in the UI.
          text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
          // The subject lives on the email-message inside a flow, not on the
          // template itself in 2024 API revisions. We surface it in the
          // manual-steps output so the operator can paste it.
        },
      },
    },
  });
  return { id: created.data.id, created: true, subject };
}

// --- Flow lifecycle -------------------------------------------------------

async function wipeWaitlistFlows() {
  // Klaviyo caps page[size] at 50; paginate via the cursor link.
  const all = [];
  let next = '/flows/?page[size]=50';
  while (next) {
    const page = await klaviyo(next);
    all.push(...(page.data || []));
    const nextLink = page.links?.next;
    if (!nextLink) break;
    // links.next is a fully-qualified URL — slice off the host to keep klaviyo()'s path-relative API.
    next = nextLink.replace(/^https?:\/\/[^/]+\/api/, '');
  }
  const matches = all.filter((f) => FLOW_NAMES_TO_WIPE.has(f.attributes?.name ?? ''));
  const deleted = [];
  for (const f of matches) {
    // Klaviyo may reject DELETE on a live flow — flip to draft first.
    if (f.attributes?.status === 'live') {
      try {
        await klaviyo(`/flows/${f.id}/`, {
          method: 'PATCH',
          body: { data: { type: 'flow', id: f.id, attributes: { status: 'draft' } } },
        });
      } catch { /* fall through to delete; if it still fails we'll surface */ }
    }
    try {
      await klaviyo(`/flows/${f.id}/`, { method: 'DELETE' });
      deleted.push({ id: f.id, name: f.attributes?.name });
    } catch (err) {
      console.warn(`  (couldn't delete flow ${f.id} "${f.attributes?.name}": ${err.message})`);
    }
  }
  return deleted;
}

/**
 * Build the action list for a flow. If delayHours > 0, prepends a time-delay
 * action wired to the send-email action. Klaviyo wants `temporary_id`s for
 * each action and an `entry_action_id` pointing at the first one.
 */
function buildActions({ template, subject, delayHours, transactional, previewText }) {
  const emailAction = {
    temporary_id: 'email',
    type: 'send-email',
    data: {
      status: 'live',
      message: {
        from_email: FROM_EMAIL,
        from_label: FROM_LABEL,
        subject_line: subject,
        preview_text: previewText || '',
        template_id: template.id,
        // Confirm = a genuine double-opt-in (transactional): bypasses the
        // marketing/Promotions treatment + List-Unsubscribe, sends regardless
        // of consent, and is built to land in Primary. REQUIRES transactional
        // sending enabled on the Klaviyo account, else the flow stays draft.
        // Welcome/referral stay marketing (transactional must NOT carry promo).
        smart_sending_enabled: !transactional,
        transactional: !!transactional,
        name: 'Email #1',
      },
    },
    links: { next: null },
  };

  if (!delayHours || delayHours <= 0) {
    return { actions: [emailAction], entry: 'email' };
  }

  const delayAction = {
    temporary_id: 'delay',
    type: 'time-delay',
    data: { value: delayHours, unit: 'hours' },
    links: { next: 'email' },
  };
  return { actions: [delayAction, emailAction], entry: 'delay' };
}

async function createFlow({ name, triggerListId, template, delayHours, transactional, previewText }) {
  const { actions, entry } = buildActions({
    template,
    subject: template.subject,
    delayHours,
    transactional,
    previewText,
  });

  const created = await klaviyo('/flows/', {
    method: 'POST',
    body: {
      data: {
        type: 'flow',
        attributes: {
          name,
          definition: {
            triggers: [{ type: 'list', id: triggerListId }],
            profile_filter: null,
            entry_action_id: entry,
            actions,
          },
        },
      },
    },
  });

  const id = created.data.id;

  // Flows are born in draft. Try to flip live; if Klaviyo rejects (e.g.
  // missing-info validation that's specific to live state), keep it as draft
  // and surface the reason so the operator can fix it in the UI.
  let activated = false;
  let activationError = null;
  try {
    await klaviyo(`/flows/${id}/`, {
      method: 'PATCH',
      body: { data: { type: 'flow', id, attributes: { status: 'live' } } },
    });
    activated = true;
  } catch (err) {
    activationError = err.message;
  }

  return { id, activated, activationError };
}

// --- Email HTML templates -------------------------------------------------

const BRAND_CSS = `
  body { margin: 0; padding: 0; background: #FFF8EE; color: #23180F; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-family: 'Fraunces', Georgia, 'Times New Roman', serif; font-weight: 600; font-size: 30px; line-height: 1.15; margin: 0 0 18px; color: #23180F; letter-spacing: -0.01em; }
  h1 em { font-style: italic; color: #C65D3C; }
  p { font-size: 16px; line-height: 1.55; color: #5A4A3C; margin: 0 0 16px; }
  .btn { display: inline-block; background: #C65D3C; color: #FFF8EE; padding: 14px 28px; border-radius: 999px; font-weight: 600; text-decoration: none; font-size: 15.5px; }
  .btn:hover { background: #B14F32; }
  .fine { font-size: 13px; color: #8C7A68; margin-top: 28px; }
  .eyebrow { font-size: 12px; color: #C65D3C; text-transform: uppercase; letter-spacing: 1.2px; font-weight: 600; margin-bottom: 14px; }
  hr { border: none; border-top: 1px solid #E4DCC9; margin: 28px 0; }
`;

function wrap(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${BRAND_CSS}</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

const TEMPLATES = {
  confirm: {
    name: TEMPLATE_NAMES.confirm,
    subject: 'One quick step — confirm your spot on the Attic waitlist',
    html: wrap(`
      <p class="eyebrow">Attic — Denver waitlist</p>
      <h1>One tap and you're <em>in</em>.</h1>
      <p>Thanks for reserving a spot for ZIP <strong>{{ person|lookup:'waitlist_zip'|default:'your area' }}</strong>. Just confirm it's really you so we know where to send your invite.</p>
      <p style="margin: 24px 0;"><a href="{{ person|lookup:'waitlist_confirm_url' }}" class="btn">Confirm my spot</a></p>
      <p>If the button doesn't work, paste this into your browser:<br><span style="color:#8C7A68;font-size:13px;word-break:break-all;">{{ person|lookup:'waitlist_confirm_url' }}</span></p>
      <hr>
      <p class="fine">We're opening Denver neighborhood by neighborhood. Fuller blocks get scheduled first, so a friend or two in your ZIP moves you both up the line.<br><br>Didn't sign up? Ignore this email and we won't bother you again.</p>
    `),
  },

  welcome: {
    name: TEMPLATE_NAMES.welcome,
    subject: "You're on the list. Here's what comes next.",
    html: wrap(`
      <p class="eyebrow">Attic — you're in</p>
      <h1>Less stuff in your way, <em>not more storage to manage.</em></h1>
      <p>That's the whole pitch. Attic isn't a storage unit you visit at midnight — it's space back in your closet, your garage, and your weekends.</p>
      <p>We pick up what you don't need this season in our crates, store it for $15 each per month, and bring it back when you ask. No driving. No truck rental. No hauling boxes up apartment stairs.</p>
      <p><strong>What happens now:</strong> We're opening Denver in small batches, neighborhood by neighborhood. You'll hear from us the moment your block is on the schedule — usually a week or two.</p>
      <hr>
      <p class="fine">Got a question or a story about the worst thing in your storage right now? Reply to this email — it comes to a real person.</p>
    `),
  },

  referral: {
    name: TEMPLATE_NAMES.referral,
    subject: 'Know a neighbor? You both jump the line.',
    html: wrap(`
      <p class="eyebrow">Attic — referral</p>
      <h1>Fuller blocks <em>open first.</em></h1>
      <p>The way Attic launches is by neighborhood density — when enough people on a block sign up, we open service there. So when a friend in your ZIP joins the list, you <em>both</em> move up.</p>
      <p style="margin: 24px 0;"><a href="https://attic.it.com/?ref={{ person|lookup:'waitlist_zip'|default:'' }}" class="btn">Share Attic with a neighbor</a></p>
      <p>If they sign up too, we'll route both your invites together so you don't have to wait for the next round.</p>
      <hr>
      <p class="fine">Three honest sells:<br>— You get your space back, $15 per crate per month, flat.<br>— No driving, no truck, no boxes up the stairs.<br>— On-demand pickup and return — like a normal app, not a storage unit.</p>
    `),
  },

  neighborhoodReady: {
    name: TEMPLATE_NAMES.neighborhoodReady,
    subject: "We're opening in your neighborhood — your invite is coming.",
    html: wrap(`
      <p class="eyebrow">Attic — your turn</p>
      <h1>Your block's <em>up.</em></h1>
      <p>We're opening service in ZIP <strong>{{ person|lookup:'waitlist_zip' }}</strong> this week. Watch your inbox for a separate email with your sign-up link and your first pickup window.</p>
      <p>If you want to grab a couple of crates the moment we open, reply with how many you think you'll need (most folks start with 2-4) and we'll have them on the truck.</p>
      <hr>
      <p class="fine">First-block pricing is the same as everywhere: $15 per crate per month, no setup, no minimum, cancel anytime by returning your crates.</p>
    `),
  },
};

// --- Main ------------------------------------------------------------------

async function main() {
  console.log('Klaviyo setup — starting (idempotent, safe to re-run).\n');

  const results = {};

  for (const [key, name] of Object.entries(LIST_NAMES)) {
    const { id, created } = await findOrCreateList(name);
    results[`list_${key}`] = { id, name, created };
    console.log(`${created ? '+ created' : '= exists  '} list:     ${name}  →  ${id}`);
  }

  for (const [key, tpl] of Object.entries(TEMPLATES)) {
    const { id, created } = await findOrCreateTemplate(tpl.name, tpl.html, tpl.subject);
    results[`tpl_${key}`] = { id, name: tpl.name, subject: tpl.subject, created };
    console.log(`${created ? '+ created' : '= exists  '} template: ${tpl.name}  →  ${id}`);
  }

  console.log('\n--- Vercel env vars (paste into Vercel → Project → Settings → Environment Variables) ---\n');
  const lines = [
    `HARPER_BASE_URL=https://app.attic.it.com`,
    `KLAVIYO_API_KEY=${KLAVIYO_API_KEY}`,
    `KLAVIYO_UNCONFIRMED_LIST_ID=${results.list_unconfirmed.id}`,
    `KLAVIYO_CONFIRMED_LIST_ID=${results.list_confirmed.id}`,
    // Runtime (api/_lib.ts) only does profile + list ops; pin to the stable
    // revision rather than the flow-create one used by this script.
    `KLAVIYO_API_REVISION=2024-10-15`,
    `MARKETING_SITE_URL=https://attic.it.com`,
  ];
  for (const l of lines) console.log(l);

  console.log('\n--- Or via Vercel CLI (run each line; you will be prompted for the value) ---\n');
  for (const l of lines) {
    const [k] = l.split('=');
    console.log(`vercel env add ${k} production`);
  }

  // -- Flow rebuild --------------------------------------------------------
  // Flow create requires API revision 2025-10-15+. We always wipe the 3
  // known waitlist flows by name and recreate from scratch — flows are
  // cheap to rebuild, and prior runs may have left them mis-wired.
  console.log('\n--- Flow rebuild (delete + recreate the 3 waitlist flows) ---');
  const wiped = await wipeWaitlistFlows();
  for (const w of wiped) console.log(`- deleted flow:  ${w.name}  (${w.id})`);
  if (wiped.length === 0) console.log('(no existing waitlist flows found to delete)');

  const flowSpecs = [
    {
      key: 'confirm',
      name: FLOW_NAMES.confirm,
      triggerListId: results.list_unconfirmed.id,
      template: results.tpl_confirm,
      delayHours: 0,
      // TODO(F&F launch): flip to true once Klaviyo is on a paid plan with
      // transactional sending enabled — that lands the opt-in in Primary
      // instead of Promotions. Kept false now so the confirm flow stays
      // marketing and works on the current (free) tier. Tracked in Asana.
      transactional: false,
      previewText: PREVIEW_TEXT.confirm,
    },
    {
      key: 'welcome',
      name: FLOW_NAMES.welcome,
      triggerListId: results.list_confirmed.id,
      template: results.tpl_welcome,
      delayHours: 0,
      previewText: PREVIEW_TEXT.welcome,
    },
    {
      key: 'referral',
      name: FLOW_NAMES.referral,
      triggerListId: results.list_confirmed.id,
      template: results.tpl_referral,
      delayHours: 48,
      previewText: PREVIEW_TEXT.referral,
    },
  ];

  for (const spec of flowSpecs) {
    const created = await createFlow(spec);
    results[`flow_${spec.key}`] = created;
    const activation = created.activated ? 'LIVE' : `draft (couldn't auto-activate: ${created.activationError})`;
    console.log(`+ created flow:  ${spec.name}  →  ${created.id}  [${activation}]`);
  }

  console.log('\n--- Neighborhood-ready (skipped — segment-triggered) ---');
  console.log(`Template ready for when you want it: ${results.tpl_neighborhoodReady.name} (id ${results.tpl_neighborhoodReady.id}).`);
  console.log('Create the segment in Klaviyo (e.g. "Confirmed + zip in [launching zips]") then build a segment-triggered flow using this template.');

  console.log('\nDone. Test by submitting the form at https://www.attic.it.com/#waitlist .');
}

main().catch((err) => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
