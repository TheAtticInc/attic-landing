#!/usr/bin/env node
/**
 * scripts/setup-ff-klaviyo.mjs — one-shot provisioner for the Friends & Family
 * tester lists. Idempotent (find-or-create by name). Reads KLAVIYO_API_KEY
 * from .env.local. Prints the list IDs + the Vercel env vars to add.
 *
 *   F&F Testers   — Android testers who'll get a Play Store closed-test invite
 *   iOS Interest  — iPhone folks to notify when the iOS app is ready
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const REVISION = '2024-10-15';

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

const ff = await findOrCreateList('F&F Testers');
const ios = await findOrCreateList('iOS Interest');
console.log(`${ff.created ? '+ created' : '= exists '} list: F&F Testers  → ${ff.id}`);
console.log(`${ios.created ? '+ created' : '= exists '} list: iOS Interest → ${ios.id}`);
console.log('\n--- Add these in Vercel → attic-landing → Settings → Environment Variables (Production) ---\n');
console.log(`KLAVIYO_FF_LIST_ID=${ff.id}`);
console.log(`KLAVIYO_IOS_LIST_ID=${ios.id}`);
