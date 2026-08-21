#!/usr/bin/env node
/**
 * Standalone rate limit capture.
 *
 * Hits every endpoint OTTO knows about, reads the X-Rate-Limit-Limit response
 * header, and writes a baseline file in the shape src/shared/rate-limit-baselines.json
 * expects.
 *
 * More complete than the in-app deep probe: it finds a sample ID by listing each
 * collection directly, rather than depending on the resource-count phase, and it
 * can optionally create-then-delete a throwaway resource for types the org has
 * none of.
 *
 * Usage:
 *   export OKTA_ORG_URL="https://your-org.okta.com"
 *   export OKTA_API_TOKEN="00...."
 *   node scripts/capture-rate-limits.js [--create-samples] [--out FILE]
 *
 * The token is read from the environment only — never pass it as an argument,
 * or it lands in your shell history.
 *
 * The output contains labels, methods, and limits. No org URL, no token, no
 * resource IDs, no timestamps beyond the capture date. This repository is public.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ORG_URL = (process.env.OKTA_ORG_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.OKTA_API_TOKEN || '';
const CREATE_SAMPLES = process.argv.includes('--create-samples');
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : 'rate-limit-capture.json';
})();

/** Pause between requests. Okta's WAF drops bursts, and this is not a race. */
const DELAY_MS = 120;
const CONSTANTS = path.join(__dirname, '..', 'src', 'shared', 'constants.ts');

function fail(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
}

if (!ORG_URL) fail('Set OKTA_ORG_URL, e.g. export OKTA_ORG_URL="https://dev-123456.okta.com"');
if (!TOKEN) fail('Set OKTA_API_TOKEN. Do not pass the token as a CLI argument.');
if (!/^https:\/\//.test(ORG_URL)) fail(`OKTA_ORG_URL must start with https:// — got "${ORG_URL}"`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Endpoint definitions, read from the real source ────────────────────────
// Parsed rather than duplicated: a hand-copied list in this script would drift
// from constants.ts, and a stale capture is worse than no capture.

function sourceBlock(src, name) {
  const start = src.indexOf(`export const ${name}`);
  if (start === -1) fail(`Could not find ${name} in ${CONSTANTS}`);
  const end = src.indexOf('\n];', start);
  return src.slice(start, end);
}

function parseDefs() {
  const src = fs.readFileSync(CONSTANTS, 'utf8');

  const primary = [];
  for (const line of sourceBlock(src, 'PROBE_ENDPOINTS').split('\n')) {
    const ep = line.match(/endpoint: '([^']+)'/);
    const label = line.match(/label: '([^']+)'/);
    if (ep && label) primary.push({ endpoint: ep[1], label: label[1], method: 'GET' });
  }

  const sub = [];
  for (const line of sourceBlock(src, 'SUB_RESOURCE_ENDPOINTS').split('\n')) {
    const ep = line.match(/endpoint: '([^']+)'/);
    const label = line.match(/label: '([^']+)'/);
    const parent = line.match(/parentType: '([^']+)'/);
    if (ep && label && parent) {
      sub.push({
        endpoint: ep[1],
        label: label[1],
        parentType: parent[1],
        method: /method: 'POST'/.test(line) ? 'POST' : 'GET',
      });
    }
  }

  const listFor = {};
  for (const line of sourceBlock(src, 'RESOURCE_TYPES').split('\n')) {
    const type = line.match(/type: '([^']+)'/);
    const count = line.match(/countEndpoint: '([^']+)'/);
    if (type && count) listFor[type[1]] = count[1];
  }

  // Loud failure beats a quietly truncated capture.
  if (primary.length < 20) fail(`Parsed only ${primary.length} primary endpoints — constants.ts format may have changed.`);
  if (sub.length < 50) fail(`Parsed only ${sub.length} sub-resource endpoints — constants.ts format may have changed.`);

  return { primary, sub, listFor };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

let requestCount = 0;

async function call(method, endpoint, body) {
  requestCount++;
  const url = `${ORG_URL}${endpoint}`;
  const headers = {
    Authorization: `SSWS ${TOKEN}`,
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    return { error: err.message };
  }

  // Okta returns rate limit headers on 4xx too, which is the whole point — a 400
  // from an empty POST still reveals the write bucket.
  const limit = parseInt(res.headers.get('x-rate-limit-limit') || '0', 10);
  const remaining = parseInt(res.headers.get('x-rate-limit-remaining') || '-1', 10);

  let data = null;
  try { data = await res.json(); } catch { /* not all responses are JSON */ }

  if (res.status === 429) {
    console.log('    429 — backing off 60s');
    await sleep(60_000);
  }

  return { status: res.status, limit, remaining, data };
}

// ─── Capture ────────────────────────────────────────────────────────────────

const buckets = new Map(); // `${method}|${label}` -> limit  (lowest wins)
const skipped = [];
const notes = [];
const viaPlaceholder = [];

/**
 * Okta attributes a request to its rate limit bucket by path pattern before it
 * resolves the resource, so a bogus ID still returns the bucket's headers on the
 * 404. That makes a real sample ID an optimization rather than a requirement —
 * which matters because several resource types are impractical to create.
 */
const PLACEHOLDER_ID = '00000000000000000000';

function record(label, method, limit) {
  if (!limit || limit <= 0) return false;
  const key = `${method}|${label}`;
  const prev = buckets.get(key);
  // A baseline is a floor. If the same bucket reports twice, keep the lower value.
  if (prev === undefined || limit < prev) buckets.set(key, limit);
  return true;
}

async function probe(def, resolvedEndpoint) {
  const body = def.method === 'POST' ? {} : undefined;
  const res = await call(def.method, resolvedEndpoint, body);
  await sleep(DELAY_MS);

  if (res.error) {
    skipped.push(`${def.method} ${def.label} — request failed: ${res.error}`);
    return;
  }
  if (!record(def.label, def.method, res.limit)) {
    skipped.push(`${def.method} ${def.label} — HTTP ${res.status}, no rate limit header`);
  }
}

/**
 * Okta collections are not consistently shaped: some return a bare array, others
 * wrap it — /api/v1/domains returns { domains: [...] } and /api/v1/iam/roles
 * returns { roles: [...] }. Assuming an array reported orgs as empty when they
 * were not.
 */
function extractList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
  }
  return null;
}

/**
 * Find one resource ID per parent type by listing its collection.
 *
 * Best-effort only. A missing sample no longer blocks the probe — see
 * PLACEHOLDER_ID — so these messages are diagnostic, not fatal, and they
 * distinguish the actual failure rather than asserting the org is empty.
 */
async function findSampleIds(parentTypes, listFor) {
  const samples = {};
  for (const type of parentTypes) {
    const list = listFor[type];
    if (!list) { notes.push(`sample for ${type} — no list endpoint known`); continue; }

    const res = await call('GET', list);
    await sleep(DELAY_MS);

    if (res.error) {
      notes.push(`sample for ${type} — request failed: ${res.error}`);
      continue;
    }
    if (res.status >= 400) {
      notes.push(`sample for ${type} — HTTP ${res.status} listing ${list}`);
      continue;
    }

    const items = extractList(res.data);
    if (items === null) {
      notes.push(`sample for ${type} — unexpected response shape from ${list}`);
      continue;
    }
    if (items.length === 0) {
      notes.push(`sample for ${type} — collection is empty`);
      continue;
    }

    const id = items[0] && items[0].id;
    if (id) samples[type] = id;
    else notes.push(`sample for ${type} — first item had no id field`);
  }
  return samples;
}

/**
 * Throwaway resources for types the org has none of.
 *
 * Only types that can be created and deleted cleanly with no external dependency.
 * Log streams need a live AWS/Splunk target and push providers need real APNs or
 * FCM credentials, so both are deliberately absent — creation would just fail
 * validation.
 */
function sampleFactories(stamp) {
  return {
    customRoles: {
      create: () => call('POST', '/api/v1/iam/roles', {
        label: `otto-baseline-${stamp}`,
        description: 'Temporary role created by capture-rate-limits.js. Safe to delete.',
        permissions: ['okta.users.read'],
      }),
      remove: (id) => call('DELETE', `/api/v1/iam/roles/${id}`),
    },
    domains: {
      // Created unverified and deleted immediately — no DNS changes are made.
      create: () => call('POST', '/api/v1/domains', {
        domain: `otto-baseline-${stamp}.example.com`,
        certificateSourceType: 'MANUAL',
      }),
      remove: (id) => call('DELETE', `/api/v1/domains/${id}`),
    },
    idps: {
      create: () => call('POST', '/api/v1/idps', {
        type: 'OIDC',
        name: `otto-baseline-${stamp}`,
        protocol: {
          type: 'OIDC',
          scopes: ['openid'],
          issuer: { mode: 'DYNAMIC' },
          endpoints: {
            authorization: { url: 'https://example.com/authorize', binding: 'HTTP-REDIRECT' },
            token: { url: 'https://example.com/token', binding: 'HTTP-POST' },
          },
          credentials: { client: { client_id: 'otto-baseline', client_secret: 'otto-baseline-secret' } },
        },
        policy: {
          provisioning: {
            action: 'AUTO',
            profileMaster: true,
            groups: { action: 'NONE' },
            conditions: { deprovisioned: { action: 'NONE' }, suspended: { action: 'NONE' } },
          },
          accountLink: { action: 'AUTO', filter: null },
          subject: {
            userNameTemplate: { template: 'idpuser.email' },
            matchType: 'USERNAME',
          },
          maxClockSkew: 0,
        },
      }),
      remove: (id) => call('DELETE', `/api/v1/idps/${id}`),
    },
  };
}

async function main() {
  console.log(`\nRate limit capture — ${ORG_URL}`);
  console.log(`Create throwaway samples: ${CREATE_SAMPLES ? 'yes' : 'no (pass --create-samples to enable)'}\n`);

  const { primary, sub, listFor } = parseDefs();
  console.log(`Loaded ${primary.length} primary and ${sub.length} sub-resource endpoints from constants.ts\n`);

  console.log('1/4  Primary endpoints');
  for (const def of primary) await probe(def, def.endpoint);

  console.log('2/4  Collection write buckets (empty POST — creates nothing)');
  for (const def of sub.filter(d => d.method === 'POST' && !d.endpoint.includes('{id}'))) {
    await probe(def, def.endpoint);
  }

  console.log('3/4  Finding sample IDs');
  const parentTypes = [...new Set(sub.filter(d => d.endpoint.includes('{id}')).map(d => d.parentType))];
  const samples = await findSampleIds(parentTypes, listFor);
  console.log(`     found samples for ${Object.keys(samples).length} of ${parentTypes.length} parent types`);

  const created = [];
  if (CREATE_SAMPLES) {
    const stamp = Date.now();
    const factories = sampleFactories(stamp);
    for (const [type, factory] of Object.entries(factories)) {
      if (samples[type]) continue;
      console.log(`     creating throwaway ${type}`);
      const res = await factory.create();
      await sleep(DELAY_MS);
      const id = res && res.data && res.data.id;
      if (id) {
        samples[type] = id;
        created.push({ type, id, remove: factory.remove });
      } else {
        skipped.push(`throwaway ${type} — creation failed (HTTP ${res && res.status})`);
      }
    }
  }

  try {
    console.log('4/4  Sub-resource endpoints');
    for (const def of sub.filter(d => d.endpoint.includes('{id}'))) {
      const real = samples[def.parentType];
      // Fall back to a bogus ID rather than skipping. The response will be a 404
      // or 400, but the rate limit header on it belongs to the right bucket, so
      // the measurement is just as valid.
      const id = real || PLACEHOLDER_ID;
      if (!real) viaPlaceholder.push(`${def.method} ${def.label}`);
      await probe(def, def.endpoint.replace('{id}', id));
    }
  } finally {
    // Always clean up, even if the probe loop threw.
    for (const c of created.reverse()) {
      console.log(`     deleting throwaway ${c.type} ${c.id}`);
      const res = await c.remove(c.id);
      await sleep(DELAY_MS);
      if (res && res.status && res.status >= 400) {
        console.error(`     WARNING: could not delete ${c.type} ${c.id} (HTTP ${res.status}) — remove it manually`);
      }
    }
  }

  const out = {
    _comment: 'Standard-org rate limit defaults captured by scripts/capture-rate-limits.js. NOT published by Okta. Contains no org URL, token, or resource IDs.',
    capturedFrom: 'standard org, no multipliers',
    capturedAt: new Date().toISOString().slice(0, 10),
    buckets: [...buckets.entries()]
      .map(([key, limit]) => {
        const [method, label] = key.split('|');
        return { label, method, limit };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.method.localeCompare(b.method)),
  };

  const serialised = JSON.stringify(out, null, 2);
  // Belt and braces: never let the org or a credential reach the file.
  const host = ORG_URL.replace(/^https:\/\//, '');
  if (serialised.includes(host) || serialised.includes(TOKEN)) {
    fail('Refusing to write: output contains the org host or token. This is a bug — report it.');
  }

  fs.writeFileSync(OUT, serialised + '\n');

  console.log(`\nCaptured ${out.buckets.length} buckets in ${requestCount} requests → ${OUT}`);

  if (viaPlaceholder.length) {
    console.log(`\n${viaPlaceholder.length} measured with a placeholder ID (404/400 response — the bucket header is still authoritative):`);
    for (const s of viaPlaceholder) console.log(`  - ${s}`);
  }
  if (skipped.length) {
    console.log(`\n${skipped.length} genuinely not captured — no rate limit header came back:`);
    for (const s of skipped) console.log(`  - ${s}`);
  }
  if (notes.length) {
    console.log(`\nDiagnostics (did not prevent capture):`);
    for (const s of notes) console.log(`  - ${s}`);
  }
  console.log('\nReview the file before committing it to src/shared/rate-limit-baselines.json.\n');
}

main().catch(err => fail(`Unexpected failure: ${err && err.stack ? err.stack : err}`));
