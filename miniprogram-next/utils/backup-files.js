// Backup files are written to a temporary file, read back, then renamed.
let adapter;
const LABELS = { manual: '手动备份', auto: '自动恢复点', restore: '恢复前备份', reset: '建立个人账本前', migration: '升级前备份', upgrade: '更新前备份' };
function runtime() {
  return adapter || { fs: wx.getFileSystemManager(), root: `${wx.env.USER_DATA_PATH}/pearl-backups` };
}
function directory() {
  const { fs, root } = runtime();
  try { fs.accessSync(root); } catch (_) { fs.mkdirSync(root, true); }
  return { fs, root };
}
function validName(name) { return /^(manual|auto|restore|reset|migration|upgrade)-\d+-[a-z0-9]+\.json$/.test(name); }
function read(name) {
  if (!validName(name)) throw new Error('备份文件名称不正确');
  const { fs, root } = directory();
  return fs.readFileSync(`${root}/${name}`, 'utf8');
}
function list() {
  const { fs, root } = directory();
  return fs.readdirSync(root).filter(validName).map(name => {
    const [reason, stamp] = name.split('-');
    return { name, reason, label: LABELS[reason], savedAt: Number(stamp), path: `${root}/${name}` };
  }).sort((a, b) => b.savedAt - a.savedAt);
}
function save(text, reason = 'manual') {
  if (!LABELS[reason]) throw new Error('备份类型不正确');
  JSON.parse(text);
  const { fs, root } = directory();
  const name = `${reason}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`;
  const path = `${root}/${name}`, temporary = `${path}.tmp`;
  try {
    fs.writeFileSync(temporary, text, 'utf8');
    if (fs.readFileSync(temporary, 'utf8') !== text) throw new Error('备份写入校验未通过');
    fs.renameSync(temporary, path);
    if (fs.readFileSync(path, 'utf8') !== text) throw new Error('备份文件校验未通过');
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) {}
    try { fs.unlinkSync(path); } catch (_) {}
    throw new Error(`无法生成安全备份：${error.message || error.errMsg || '存储不可用'}。请检查可用空间后重试`);
  }
  // Only rotate automatic recovery points. User exports and pre-restore copies remain.
  if (reason === 'auto') {
    try { list().filter(item => item.reason === 'auto').slice(7).forEach(item => fs.unlinkSync(item.path)); } catch (_) {}
  }
  return { name, path, label: LABELS[reason], savedAt: Number(name.split('-')[1]) };
}
module.exports = { save, read, list, setAdapter(value) { adapter = value; } };
