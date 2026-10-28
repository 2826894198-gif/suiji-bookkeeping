const sha256 = require('./vendor/sha256');
const PROTOCOL = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const CHUNK_CHARS = 64 * 1024;
const MAX_CHUNKS = 128;
const HISTORY_LIMIT = 30;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function encode(state) { return JSON.stringify(canonical(state)); }
function digest(text) { return sha256(text); }
function byteLength(text) {
  let size = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    size += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return size;
}
function split(text) {
  if (byteLength(text) > MAX_BYTES) throw new Error('账本超过当前 8 MB 同步上限，请先导出完整备份');
  const parts = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CHUNK_CHARS, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
function pristine(state) {
  return !state.demo && !state.updatedAt && !state.entries.length && !state.accounts.length && !Object.keys(state.budgets).length;
}
module.exports = { PROTOCOL, MAX_BYTES, CHUNK_CHARS, MAX_CHUNKS, HISTORY_LIMIT, encode, digest, byteLength, split, pristine };
