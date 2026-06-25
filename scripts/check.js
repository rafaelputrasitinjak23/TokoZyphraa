const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ejs = require('ejs');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['node_modules', '.git', '.vercel']);
let checkedJs = 0;
let checkedEjs = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
      checkedJs += 1;
    } else if (entry.name.endsWith('.ejs')) {
      ejs.compile(fs.readFileSync(fullPath, 'utf8'), { filename: fullPath });
      checkedEjs += 1;
    }
  }
}

walk(root);
console.log(`Pemeriksaan berhasil: ${checkedJs} file JavaScript dan ${checkedEjs} template EJS.`);
