// Validate shipped JavaScript, inline scripts and local asset references without a bundler.
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');

const root = path.join(__dirname, '..');
let checkedFiles = 0;

for (const dir of ['', 'public']) {
  const directory = path.join(root, dir);
  for (const file of fs.readdirSync(directory)) {
    if (!file.endsWith('.js')) continue;
    const filename = path.join(dir, file);
    new Script(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
    checkedFiles++;
  }
}

const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
let inlineScripts = 0;
for (const [, source] of html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)) {
  new Script(source, { filename: 'public/index.html:inline' });
  inlineScripts++;
}

let localAssets = 0;
for (const [, reference] of html.matchAll(/(?:src|href)="(\\/[^"#]+)"/g)) {
  const pathname = reference.split('?')[0];
  const assetPath = path.join(root, 'public', pathname.replace(/^\\//, ''));
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Missing local asset referenced by public/index.html: ${reference}`);
  }
  localAssets++;
}

console.log(`Build checks passed: ${checkedFiles} JavaScript files, ${inlineScripts} inline scripts and ${localAssets} local asset references.`);
