import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['dist-mobile', path.join('ios', 'App', 'App', 'public')];
const requiredText = ['https://api.getbinflow.com'];
const forbiddenText = [
  'http://localhost:3001',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
  'STRIPE_SECRET',
  'sk_live_',
  'sk_test_',
  'APP_STORE_PRIVATE_KEY',
  'APPLE_SHARED_SECRET'
];
const forbiddenPaths = [
  `${path.sep}demo${path.sep}`,
  `${path.sep}design-concepts${path.sep}`,
  `${path.sep}landing-concept${path.sep}`,
  `${path.sep}og-tweaks${path.sep}`
];
const searchableExtensions = new Set(['.css', '.html', '.js', '.json', '.txt', '.xml']);

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(filePath));
    } else {
      files.push(filePath);
    }
  }

  return files;
}

const files = (await Promise.all(roots.map(listFiles))).flat();
const pathMatches = files.filter((file) => forbiddenPaths.some((segment) => file.includes(segment)));
const searchableFiles = files.filter((file) => searchableExtensions.has(path.extname(file)));
const contents = await Promise.all(searchableFiles.map(async (file) => ({
  file,
  text: await readFile(file, 'utf8')
})));

const failures = [];

for (const expected of requiredText) {
  if (!contents.some(({ text }) => text.includes(expected))) {
    failures.push(`Missing required production marker: ${expected}`);
  }
}

for (const forbidden of forbiddenText) {
  const hit = contents.find(({ text }) => text.includes(forbidden));

  if (hit) {
    failures.push(`Forbidden marker found in ${hit.file}: ${forbidden}`);
  }
}

if (pathMatches.length) {
  failures.push(`Mobile bundle includes non-app public folders: ${pathMatches.slice(0, 5).join(', ')}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Mobile bundle check passed across ${files.length} files.`);
