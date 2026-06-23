#!/usr/bin/env node
/**
 * scripts/setup-ff-klaviyo.mjs — provisioner for the Friends & Family tester
 * lists + their confirmation-email flows. Idempotent (find-or-create lists +
 * templates; wipe-and-recreate the 2 flows by name). Reads KLAVIYO_API_KEY from
 * .env.local. Safe to re-run.
 *
 *   F&F Testers   — Android testers → Play Store closed-test invite later.
 *   iOS Interest  — iPhone folks to notify when iOS is ready.
 *
 * Each list gets a flow: "added to list → send a branded confirmation email"
 * that tells them they're on the list + to watch their inbox/spam for the
 * real invite. Mirrors the waitlist flows in setup-klaviyo.mjs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const REVISION = '2025-10-15'; // POST /flows/ needs 2025-10-15+
const FROM_EMAIL = 'hello@attic.it.com';
const FROM_LABEL = 'Attic';

function loadDotEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* fine */ }
}
loadDotEnv(join(repoRoot, '.env.local'));
const KEY = process.env.KLAVIYO_API_KEY;
if (!KEY) { console.error('Missing KLAVIYO_API_KEY in .env.local'); process.exit(1); }

async function klaviyo(path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Klaviyo-API-Key ${KEY}`, revision: REVISION, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`https://a.klaviyo.com/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const text = await res.text();
  let parsed = null;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  if (!res.ok) throw new Error(`Klaviyo ${method} ${path} → ${res.status}: ${parsed?.errors?.[0]?.detail ?? JSON.stringify(parsed)}`);
  return parsed;
}

async function findOrCreateList(name) {
  const filter = encodeURIComponent(`equals(name,"${name.replace(/"/g, '\\"')}")`);
  const existing = await klaviyo(`/lists/?filter=${filter}`);
  if (existing?.data?.[0]?.id) return { id: existing.data[0].id, created: false };
  const created = await klaviyo('/lists/', { method: 'POST', body: { data: { type: 'list', attributes: { name } } } });
  return { id: created.data.id, created: true };
}

async function findOrCreateTemplate(name, html) {
  const filter = encodeURIComponent(`equals(name,"${name.replace(/"/g, '\\"')}")`);
  const existing = await klaviyo(`/templates/?filter=${filter}`);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (existing?.data?.[0]?.id) {
    const id = existing.data[0].id;
    await klaviyo(`/templates/${id}/`, { method: 'PATCH', body: { data: { type: 'template', id, attributes: { html, text } } } });
    return id;
  }
  const created = await klaviyo('/templates/', { method: 'POST', body: { data: { type: 'template', attributes: { name, editor_type: 'CODE', html, text } } } });
  return created.data.id;
}

async function wipeFlowsByName(names) {
  const wanted = new Set(names);
  const all = [];
  let next = '/flows/?page[size]=50';
  while (next) {
    const page = await klaviyo(next);
    all.push(...(page.data || []));
    const n = page.links?.next;
    if (!n) break;
    next = n.replace(/^https?:\/\/[^/]+\/api/, '');
  }
  for (const f of all.filter((x) => wanted.has(x.attributes?.name ?? ''))) {
    if (f.attributes?.status === 'live') {
      try { await klaviyo(`/flows/${f.id}/`, { method: 'PATCH', body: { data: { type: 'flow', id: f.id, attributes: { status: 'draft' } } } }); } catch {}
    }
    try { await klaviyo(`/flows/${f.id}/`, { method: 'DELETE' }); console.log(`- wiped flow: ${f.attributes?.name}`); } catch (e) { console.warn(`  (couldn't delete ${f.id}: ${e.message})`); }
  }
}

async function createFlow({ name, triggerListId, templateId, subject, previewText }) {
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
            entry_action_id: 'email',
            actions: [{
              temporary_id: 'email',
              type: 'send-email',
              data: {
                status: 'live',
                message: {
                  from_email: FROM_EMAIL, from_label: FROM_LABEL,
                  subject_line: subject, preview_text: previewText || '',
                  template_id: templateId, smart_sending_enabled: true,
                  transactional: false, name: 'Email #1',
                },
              },
              links: { next: null },
            }],
          },
        },
      },
    },
  });
  const id = created.data.id;
  let activated = false, err = null;
  try { await klaviyo(`/flows/${id}/`, { method: 'PATCH', body: { data: { type: 'flow', id, attributes: { status: 'live' } } } }); activated = true; }
  catch (e) { err = e.message; }
  return { id, activated, err };
}

// --- Email templates -------------------------------------------------------
const CSS = `body{margin:0;padding:0;background:#FFF8EE;color:#23180F;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}.wrap{max-width:560px;margin:0 auto;padding:32px 24px}h1{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:30px;line-height:1.15;margin:0 0 18px;color:#23180F;letter-spacing:-0.01em}h1 em{font-style:italic;color:#C65D3C}p{font-size:16px;line-height:1.55;color:#5A4A3C;margin:0 0 16px}p strong{color:#23180F}.eyebrow{font-size:12px;color:#C65D3C;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;margin-bottom:14px}.fine{font-size:13px;color:#8C7A68;margin-top:28px}hr{border:none;border-top:1px solid #E4DCC9;margin:28px 0}.callout{background:#FBF1E2;border:1px solid #E4DCC9;border-radius:12px;padding:14px 16px;font-size:14px;color:#5A4A3C;margin:0 0 16px}`;
const wrap = (inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body><div class="wrap">${inner}</div></body></html>`;

const FF_HTML = wrap(`
  <p class="eyebrow">Attic — Friends &amp; Family</p>
  <h1>You're <em>in</em>.</h1>
  <p>Hi {{ first_name|default:'there' }}, thanks for signing up to help test the Attic app — you're officially on the Friends &amp; Family list.</p>
  <p><strong>What happens next:</strong> once we've gathered everyone, you'll get a separate email from <strong>Google Play</strong> with your invite to the test. That's the email that gets you into the app.</p>
  <div class="callout"><strong>Important — find this email &amp; mark it safe.</strong> If it landed in your <strong>spam or promotions</strong> folder, mark it <strong>"Not spam"</strong> and drag it to your inbox. That tells your email Attic is safe — so the Google Play invite (the one that gets you into the app) lands where you'll actually see it.</div>
  <p>As a thank-you for testing, you'll get a <strong>$50 Attic storage credit</strong> when we officially launch.</p>
  <hr>
  <p class="fine">Questions, or hit a snag? Just reply to this email — it comes to a real person.</p>
`);

const IOS_HTML = wrap(`
  <p class="eyebrow">Attic — iOS</p>
  <h1>You're on the <em>list</em>.</h1>
  <p>Hi {{ first_name|default:'there' }}, thanks! The Attic app is Android-only for this first round of testing — but you're on the iOS list.</p>
  <p>We'll email you the moment the iPhone version is ready to test, and you'll be among the first to know.</p>
  <hr>
  <p class="fine">Questions? Just reply — it comes to a real person.</p>
`);

// --- Main ------------------------------------------------------------------
const ff = await findOrCreateList('F&F Testers');
const ios = await findOrCreateList('iOS Interest');
console.log(`${ff.created ? '+ created' : '= exists '} list: F&F Testers  → ${ff.id}`);
console.log(`${ios.created ? '+ created' : '= exists '} list: iOS Interest → ${ios.id}`);

const ffTpl = await findOrCreateTemplate('Attic F&F — You’re on the list', FF_HTML);
const iosTpl = await findOrCreateTemplate('Attic iOS — You’re on the list', IOS_HTML);
console.log(`= template: F&F welcome  → ${ffTpl}`);
console.log(`= template: iOS welcome  → ${iosTpl}`);

const FF_FLOW = 'Attic F&F · Welcome';
const IOS_FLOW = 'Attic iOS · Welcome';
await wipeFlowsByName([FF_FLOW, IOS_FLOW]);

const f1 = await createFlow({ name: FF_FLOW, triggerListId: ff.id, templateId: ffTpl, subject: 'You’re on the Attic Friends & Family list 🎉', previewText: 'Your Google Play invite is coming — watch your inbox.' });
const f2 = await createFlow({ name: IOS_FLOW, triggerListId: ios.id, templateId: iosTpl, subject: 'You’re on the Attic iOS list 👍', previewText: 'We’ll tell you when the iPhone version is ready.' });
console.log(`+ flow: ${FF_FLOW}  → ${f1.id}  [${f1.activated ? 'LIVE' : 'draft: ' + f1.err}]`);
console.log(`+ flow: ${IOS_FLOW} → ${f2.id}  [${f2.activated ? 'LIVE' : 'draft: ' + f2.err}]`);

console.log('\n--- Vercel env (already added) ---');
console.log(`KLAVIYO_FF_LIST_ID=${ff.id}`);
console.log(`KLAVIYO_IOS_LIST_ID=${ios.id}`);
