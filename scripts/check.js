const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git', '.vercel']);
let checkedJs = 0;
let checkedEjs = 0;
let mutationForms = 0;

function checkTemplateRules(filePath, source) {
  const inlineHandler = /\son(?:click|change|submit|load|error)\s*=/i;
  if (inlineHandler.test(source)) throw new Error(`Inline event handler ditemukan pada ${filePath}.`);

  const formPattern = /<form\b[^>]*method=["'](?:post|put|patch|delete)["'][^>]*>([\s\S]*?)<\/form>/gi;
  for (const match of source.matchAll(formPattern)) {
    mutationForms += 1;
    if (!/name=["']_csrf["']/i.test(match[1])) {
      throw new Error(`Form mutasi tanpa token CSRF ditemukan pada ${filePath}.`);
    }
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.name.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
      checkedJs += 1;
    } else if (entry.name.endsWith('.ejs')) {
      const source = fs.readFileSync(fullPath, 'utf8');
      ejs.compile(source, { filename: fullPath });
      checkTemplateRules(fullPath, source);
      checkedEjs += 1;
    }
  }
}

function checkSecurityRules() {
  const indexSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  if (/scriptSrc\s*:\s*\[[^\]]*unsafe-inline/s.test(indexSource)) {
    throw new Error("CSP script-src tidak boleh menggunakan 'unsafe-inline'.");
  }

  const sourceFiles = [];
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.ejs')) sourceFiles.push(fullPath);
    }
  }
  collect(path.join(root, 'src'));
  collect(path.join(root, 'views'));
  for (const filePath of sourceFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    if (/session\.user\.avatarData|currentUser\.avatarData/.test(source)) {
      throw new Error(`Data avatar tidak boleh disimpan atau dibaca dari session: ${filePath}.`);
    }
  }

  assert(fs.existsSync(path.join(root, '.env.example')), '.env.example wajib tersedia.');
  assert(fs.existsSync(path.join(root, '.gitignore')), '.gitignore wajib tersedia.');
  assert(fs.existsSync(path.join(root, 'package-lock.json')), 'package-lock.json wajib tersedia.');
}

function checkPureUtilities() {
  process.env.SESSION_SECRET ||= 'x'.repeat(64);
  const { safeLocalPath } = require('../src/utils/redirect');
  const { normalizePaymentMethod } = require('../src/constants/paymentMethods');

  assert.strictEqual(safeLocalPath('/account/orders', '/'), '/account/orders');
  assert.strictEqual(safeLocalPath('//evil.example', '/safe'), '/safe');
  assert.strictEqual(safeLocalPath('/\\evil.example', '/safe'), '/safe');
  assert.strictEqual(safeLocalPath('https://evil.example', '/safe'), '/safe');
  assert.strictEqual(normalizePaymentMethod('qris'), 'qris');
  assert.strictEqual(normalizePaymentMethod('invalid'), 'qris');
}

walk(root);
checkSecurityRules();
checkPureUtilities();
console.log(`Pemeriksaan berhasil: ${checkedJs} file JavaScript, ${checkedEjs} template EJS, dan ${mutationForms} form mutasi.`);
