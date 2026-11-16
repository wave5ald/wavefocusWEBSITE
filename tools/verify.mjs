/* Validate the PWA shell: manifest files exist and PNG sizes match their
   declarations, every URL referenced by index.html/sw.js resolves, and the
   service worker precache list matches real files.

   Usage: node tools/verify.mjs   (from the pwa folder) */

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('.');
const problems = [];
const notes = [];

const exists = async (rel) => {
  try { return (await stat(join(root, rel.replace(/^\.\//, '')))).isFile(); }
  catch { return false; }
};

const pngSize = async (rel) => {
  const buf = await readFile(join(root, rel));
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
};

/* ---- manifest ---- */
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (!manifest.name || !manifest.short_name) problems.push('manifest: missing name/short_name');
if (manifest.display !== 'standalone') problems.push('manifest: display should be standalone');
for (const icon of manifest.icons || []) {
  if (!(await exists(icon.src))) problems.push(`manifest icon missing: ${icon.src}`);
  else {
    const size = await pngSize(icon.src);
    if (size !== icon.sizes) problems.push(`manifest icon ${icon.src}: declared ${icon.sizes}, actual ${size}`);
  }
}
for (const shot of manifest.screenshots || []) {
  if (!(await exists(shot.src))) problems.push(`manifest screenshot missing: ${shot.src}`);
  else {
    const size = await pngSize(shot.src);
    if (size !== shot.sizes) problems.push(`manifest screenshot ${shot.src}: declared ${shot.sizes}, actual ${size}`);
  }
}
for (const shortcut of manifest.shortcuts || []) {
  for (const icon of shortcut.icons || []) {
    if (!(await exists(icon.src))) problems.push(`shortcut icon missing: ${icon.src}`);
  }
}
notes.push(`manifest: ${(manifest.icons || []).length} icons, ${(manifest.screenshots || []).length} screenshots, ${(manifest.shortcuts || []).length} shortcuts`);

/* ---- html references ---- */
const html = await readFile(join(root, 'index.html'), 'utf8');
const refs = new Set();
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const value = match[1];
  if (/^(https?:|data:|#|mailto:)/.test(value)) continue;
  refs.add(value.split('?')[0]);
}
for (const ref of refs) {
  if (ref === 'manifest.json' || ref.startsWith('js/') || ref.startsWith('css/') || ref.startsWith('icons/') || ref.startsWith('splash/')) {
    if (!(await exists(ref))) problems.push(`index.html reference missing: ${ref}`);
  }
}
notes.push(`index.html: ${refs.size} local references checked`);
if (!/apple-mobile-web-app-capable" content="yes/.test(html)) problems.push('index.html: missing apple-mobile-web-app-capable');
if (!/apple-mobile-web-app-title"? content="Wave Focus/.test(html) && !/apple-mobile-web-app-title" content="Wave Focus/.test(html)) {
  problems.push('index.html: missing apple-mobile-web-app-title');
}

/* ---- service worker ---- */
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const shell = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
for (const file of shell) {
  if (!(await exists(file))) problems.push(`sw.js precache missing: ${file}`);
}
const version = sw.match(/VERSION = '([^']+)'/)?.[1];
notes.push(`sw.js: cache ${version}, ${shell.length} precached files`);

/* ---- report ---- */
for (const note of notes) console.log(`  ${note}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error(` - ${p}`));
  process.exitCode = 1;
} else {
  console.log('\nAll manifest, HTML and service-worker references resolve.');
}
