const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'cloudfunctions/pearlLedgerSync/shared');
const files = ['ledger.js', 'cloud-protocol.js', 'vendor/sha256.js', 'vendor/sha256-LICENSE'];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, 'utils', file));
  const destination = path.join(target, file);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(source)) throw new Error(`Cloud shared source is stale: ${file}`);
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, source);
  }
}
console.log(process.argv.includes('--check') ? 'Cloud shared sources match client model' : 'Cloud shared sources prepared');
