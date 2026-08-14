// Renders templates/*.html into dist/ as plain static HTML for Cloudflare Workers
// static assets, and copies static/ -> dist/static/.
//
// The only dynamic expression in any template is `static_v()` (app/__init__.py),
// which stamps a cache-busting token onto an asset URL. Flask uses the file's
// mtime; here we substitute a content hash instead, because mtime is not stable
// across git clones and would spuriously bust every cache on a fresh checkout.

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = join(ROOT, 'static');
const TEMPLATE_DIR = join(ROOT, 'templates');
const DIST_DIR = join(ROOT, 'dist');

// source template -> emitted filename. reset_password.html is emitted hyphenated
// because Flask serves it at /reset-password (app/auth.py), and Workers static
// asset html_handling maps /reset-password -> reset-password.html.
const PAGES = {
  'index.html': 'index.html',
  'login.html': 'login.html',
  'reset_password.html': 'reset-password.html',
};

// Tolerates both spacing variants present in the templates:
//   {{ static_v('app/core.js') }}  and  {{ static_v('app/settings.js')}}
const STATIC_V_RE = /\{\{\s*static_v\(\s*'([^']+)'\s*\)\s*\}\}/g;

const hashCache = new Map();

async function assetHash(relPath) {
  const key = relPath.replace(/^\/+/, '');
  if (!hashCache.has(key)) {
    const bytes = await readFile(join(STATIC_DIR, key));
    hashCache.set(key, createHash('sha256').update(bytes).digest('hex').slice(0, 8));
  }
  return hashCache.get(key);
}

async function render(source) {
  const raw = await readFile(join(TEMPLATE_DIR, source), 'utf8');

  // Hash every referenced asset first, so the async work happens outside replace().
  const refs = [...raw.matchAll(STATIC_V_RE)].map((m) => m[1]);
  await Promise.all([...new Set(refs)].map(assetHash));

  const out = raw.replace(STATIC_V_RE, (_, relPath) => hashCache.get(relPath.replace(/^\/+/, '')));

  // Guard: if anyone adds real Jinja to a template later, fail loudly here
  // rather than silently shipping a page with unrendered template syntax.
  const leftover = out.match(/\{\{|\{%/);
  if (leftover) {
    const line = out.slice(0, leftover.index).split('\n').length;
    throw new Error(
      `${source}:${line} still contains Jinja syntax (${leftover[0]}) after rendering. ` +
        `Only static_v() is supported by the static build — see CLAUDE.md §6b.`,
    );
  }
  return out;
}

async function main() {
  // static/tailwind.css is a gitignored build artifact; a dist/ built without it
  // would 404 the stylesheet on every page of the SPA.
  const staticFiles = await readdir(STATIC_DIR);
  if (!staticFiles.includes('tailwind.css')) {
    throw new Error('static/tailwind.css is missing — run `npm run build:css` first.');
  }

  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await cp(STATIC_DIR, join(DIST_DIR, 'static'), { recursive: true });

  for (const [source, target] of Object.entries(PAGES)) {
    await writeFile(join(DIST_DIR, target), await render(source), 'utf8');
    console.log(`rendered ${source} -> dist/${target}`);
  }
}

await main();
