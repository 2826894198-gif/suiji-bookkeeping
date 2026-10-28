// Integer cents and one atomic storage write keep balances and the ledger consistent.
const KEY = 'pearl_ledger_v1';
const SCHEMA = 2;
let current = null;
let adapter = null;
let clock = () => new Date();
let checkpointDay = '';
let epoch = 0;
const listeners = new Set();
const clone = value => JSON.parse(JSON.stringify(value));
const pad = value => String(value).padStart(2, '0');
function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function localDate(value) {
  const parts = String(value).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], 12);
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && dateKey(localDate(value)) === value;
}
function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || ''); }
function today(state = load()) { return state.demo ? state.demoDate : dateKey(clock()); }
function entryMoment(state = load()) {
  const now = clock();
  return { date: state.demo ? state.demoDate : dateKey(now), time: state.demo ? '12:00' : `${pad(now.getHours())}:${pad(now.getMinutes())}` };
}
function timestamp() { return clock().toISOString(); }
function money(value, decimals = true) {
  const n = Number(value || 0) / 100;
  const parts = Math.abs(n).toFixed(decimals ? 2 : 0).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '−' : ''}${parts.join('.')}`;
}
function cents(value, allowZero = false) {
  const text = String(value).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new Error('请输入正确金额，最多保留两位小数');
  const result = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(result) || (allowZero ? result < 0 : result <= 0)) throw new Error('金额必须大于 0');
  return result;
}
function period(date, day = 15) {
  const d = localDate(date);
  const start = new Date(d.getFullYear(), d.getMonth() - (d.getDate() < day ? 1 : 0), day, 12);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, day - 1, 12);
  return {
    start: dateKey(start), end: dateKey(end),
    label: `${pad(start.getMonth() + 1)}.${pad(start.getDate())} — ${pad(end.getMonth() + 1)}.${pad(end.getDate())}`,
    fullLabel: `${dateKey(start)} 至 ${dateKey(end)}`
  };
}
function categories() {
  return [
    { id: 'food', name: '餐饮', icon: 'utensils', type: 'expense', children: ['早餐', '午餐', '晚餐', '咖啡茶饮'] },
    { id: 'daily', name: '日用', icon: 'shopping-bag', type: 'expense', children: ['生活用品', '超市采购', '个人护理'] },
    { id: 'transport', name: '出行', icon: 'train-front', type: 'expense', children: ['公交地铁', '打车', '加油'] },
    { id: 'shopping', name: '购物', icon: 'shirt', type: 'expense', children: ['服饰', '数码', '其他购物'] },
    { id: 'home', name: '居家', icon: 'house', type: 'expense', children: ['房租', '水电', '家居'] },
    { id: 'play', name: '娱乐', icon: 'gamepad-2', type: 'expense', children: ['电影', '游戏', '旅行'] },
    { id: 'health', name: 'heart-pulse', icon: 'heart-pulse', type: 'expense', children: ['药品', '诊疗', '运动'] },
    { id: 'other', name: '其他', icon: 'ellipsis', type: 'expense', children: ['未分类'] },
    { id: 'salary', name: '工资', icon: 'briefcase-business', type: 'income', children: ['月薪', '奖金'] },
    { id: 'side', name: '其他收入', icon: 'banknote', type: 'income', children: ['兼职', '其他收入'] }
  ].map(c => c.id === 'health' ? { ...c, name: '健康' } : c);
}
// Synthetic fixture rows below are authored in code, not imported personal records.
function seed(demo = true) {
  const state = {
    schema: SCHEMA, bookId: uid('book'), demo, demoDate: '2026-10-20', cycleDay: 15, createdAt: timestamp(),
    accounts: [], categories: categories(), entries: [], budgets: {}, updatedAt: null
  };
  if (!demo) return state;
  state.accounts = [
    { id: 'bank', name: '演示银行', kind: 'bank', children: [
      { id: 'bank-current', name: '活期', opening: 1200000 },
      { id: 'bank-invest', name: '理财', opening: 600000 }
    ] },
    { id: 'wechat', name: '微信', kind: 'wallet', children: [{ id: 'wx-change', name: '零钱', opening: 165000 }] },
    { id: 'alipay', name: '支付宝', kind: 'wallet', children: [
      { id: 'ali-balance', name: '余额', opening: 240000 },
      { id: 'ali-fund', name: '余额宝', opening: 600000 }
    ] },
    { id: 'cash', name: '现金', kind: 'cash', children: [{ id: 'cash-wallet', name: '随身现金', opening: 60000 }] }
  ];
  const rows = [
    ['15', 320, 'food', '晚餐', 'wx-change', '朋友聚餐', '19:30'],
    ['16', 90, 'transport', '打车', 'ali-balance', '往返通勤', '09:15'],
    ['16', 360, 'daily', '超市采购', 'ali-balance', '一周采购', '18:20'],
    ['17', 280, 'food', '晚餐', 'wx-change', '周末聚餐', '19:00'],
    ['18', 620, 'shopping', '服饰', 'bank-current', '秋季衣物', '15:10'],
    ['18', 140, 'food', '午餐', 'wx-change', '午餐', '12:35'],
    ['19', 790, 'home', '家居', 'bank-current', '添置家居', '16:20'],
    ['19', 180, 'food', '晚餐', 'wx-change', '晚餐', '18:30'],
    ['20', 68, 'food', '午餐', 'wx-change', '', '12:30'],
    ['20', 412, 'daily', '生活用品', 'ali-balance', '', '10:18']
  ];
  state.entries = rows.map((r, index) => ({
    id: `demo-${index}`, type: 'expense', amount: r[1] * 100, categoryId: r[2],
    subcategory: r[3], accountId: r[4], note: r[5], date: `2026-10-${r[0]}`, time: r[6]
  }));
  state.entries.push({ id: 'demo-income', type: 'income', amount: 880000, categoryId: 'salary',
    subcategory: '月薪', accountId: 'bank-current', note: '十月工资', date: '2026-10-15', time: '09:00' });
  // Demo account amounts are the closing balances shown in the selected visual.
  const flat = state.accounts.flatMap(a => a.children);
  state.entries.forEach(e => { flat.find(a => a.id === e.accountId).opening += e.type === 'expense' ? e.amount : -e.amount; });
  state.budgets['2026-10-15'] = { total: 800000, categories: { food: 180000, daily: 120000, transport: 80000, shopping: 160000, home: 200000, other: 60000 } };
  return state;
}
function storage() {
  return adapter || {
    get: () => wx.getStorageSync(KEY), set: value => wx.setStorageSync(KEY, value),
    remove: () => wx.removeStorageSync(KEY),
    checkpoint: (raw, reason) => require('./backup-files').save(serializeRaw(raw), reason)
  };
}
function validate(state, schema = SCHEMA) {
  if (!state || state.schema !== schema || typeof state.demo !== 'boolean' ||
      (schema === 1 ? !validDate(state.anchor) : typeof state.bookId !== 'string' || !state.bookId || !validDate(state.demoDate)) ||
      !Array.isArray(state.entries) || !Array.isArray(state.accounts) ||
      !Array.isArray(state.categories) || !Number.isInteger(state.cycleDay) ||
      state.cycleDay < 1 || state.cycleDay > 28 || !state.budgets || typeof state.budgets !== 'object' || Array.isArray(state.budgets)) {
    throw new Error('账本文件格式不正确，原数据未改变');
  }
  const accountIds = new Set();
  const groupIds = new Set();
  state.accounts.forEach(group => {
    if (typeof group.id !== 'string' || !group.id || groupIds.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.children)) throw new Error('账户数据不完整');
    groupIds.add(group.id);
    group.children.forEach(child => {
      if (typeof child.id !== 'string' || !child.id || typeof child.name !== 'string' || !child.name.trim() || !Number.isSafeInteger(child.opening) || accountIds.has(child.id)) throw new Error('子账户数据不正确');
      accountIds.add(child.id);
    });
  });
  const categoryIds = new Set();
  state.categories.forEach(c => {
    if (typeof c.id !== 'string' || !c.id || typeof c.name !== 'string' || !c.name.trim() || categoryIds.has(c.id) || !['income', 'expense'].includes(c.type) || !Array.isArray(c.children) || c.children.some(name => typeof name !== 'string' || !name.trim())) throw new Error('分类数据不正确');
    categoryIds.add(c.id);
  });
  const ids = new Set();
  state.entries.forEach(e => {
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id) || !['income', 'expense', 'transfer', 'adjustment', 'refund'].includes(e.type) ||
        !Number.isSafeInteger(e.amount) || e.amount === 0 || !validDate(e.date) || !accountIds.has(e.accountId) ||
        (e.type !== 'adjustment' && e.amount < 0) || (e.time !== undefined && !validTime(e.time))) throw new Error('账目数据不正确');
    if (['income', 'expense'].includes(e.type) && !state.categories.some(c => c.id === e.categoryId && c.type === e.type)) throw new Error('账目分类缺失或类型不匹配');
    if (e.type === 'transfer' && (!accountIds.has(e.toAccountId) || e.toAccountId === e.accountId)) throw new Error('转账账户不正确');
    ids.add(e.id);
  });
  state.entries.filter(e => e.type === 'refund').forEach(e => {
    const original = state.entries.find(row => row.id === e.originalId);
    if (!original || original.type !== 'expense' || original.accountId !== e.accountId || original.categoryId !== e.categoryId || e.date < original.date) throw new Error('退款对应的支出或账户不正确');
    if (period(e.date, state.cycleDay).start !== period(original.date, state.cycleDay).start) throw new Error('备份包含尚不支持的跨周期回款');
    const refunded = state.entries.filter(row => row.originalId === original.id).reduce((sum, row) => sum + row.amount, 0);
    if (!Number.isSafeInteger(refunded) || refunded > original.amount) throw new Error('回款合计超过原支出');
  });
  Object.keys(state.budgets).forEach(key => {
    const b = state.budgets[key];
    // Earlier versions allowed changing cycleDay after budgets were created.
    // Keep those older dated budgets intact instead of rejecting the whole book.
    if (!validDate(key) || !b || !Number.isSafeInteger(b.total) || b.total < 0 || !b.categories || typeof b.categories !== 'object' || Array.isArray(b.categories) ||
        Object.keys(b.categories).some(id => !state.categories.some(c => c.id === id && c.type === 'expense')) ||
        Object.values(b.categories).some(n => !Number.isSafeInteger(n) || n < 0) ||
        Object.values(b.categories).reduce((sum, n) => sum + n, 0) > b.total) throw new Error('预算数据不正确');
  });
  const balances = allAccounts(state);
  if (balances.some(a => !Number.isSafeInteger(a.balance)) || !Number.isSafeInteger(balances.reduce((sum, a) => sum + a.balance, 0))) throw new Error('余额超过可安全计算的范围');
  return state;
}
function migrate(raw) {
  const state = clone(typeof raw === 'string' ? JSON.parse(raw) : raw);
  if (state && state.schema > SCHEMA) throw new Error('这个账本来自更新的版本，请先更新小程序');
  if (state && state.schema === 1) {
    validate(state, 1);
    state.schema = SCHEMA;
    state.bookId = uid('book');
    state.demoDate = '2026-10-20';
    delete state.anchor;
  }
  return validate(state);
}
function serialize(state) {
  return JSON.stringify({ format: 'pearl-ledger-backup', version: state.schema === 1 ? 1 : 2, exportedAt: timestamp(), data: state }, null, 2);
}
function serializeRaw(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    validate(value, value.schema);
    return serialize(value);
  } catch (_) {
    return JSON.stringify({ format: 'pearl-ledger-raw-recovery', exportedAt: timestamp(), raw }, null, 2);
  }
}
function checkpoint(raw, reason) {
  if (raw === undefined || raw === null || raw === '') return;
  if (storage().checkpoint) storage().checkpoint(clone(raw), reason);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function sameStored(raw, value) {
  const decoded = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return JSON.stringify(canonical(decoded)) === JSON.stringify(canonical(value));
}
function persist(next, previous, reason = 'change') {
  const target = storage();
  try {
    target.set(clone(next));
    if (!sameStored(target.get(), next)) throw new Error('保存后的数据校验不一致');
  } catch (error) {
    let restored = false;
    try {
      const existing = target.get();
      restored = JSON.stringify(existing) === JSON.stringify(previous);
      if (!restored && previous !== undefined && previous !== null && previous !== '') {
        target.set(clone(previous));
        restored = JSON.stringify(target.get()) === JSON.stringify(previous);
      } else if (!restored && target.remove && (previous === undefined || previous === null || previous === '')) {
        target.remove(); restored = !target.get();
      }
    } catch (_) {}
    if (!restored) current = null;
    throw new Error(restored ? `保存失败，原账本已保留：${error.message || error.errMsg}` : '无法确认保存结果，请重试读取或到设置选择本机恢复点');
  }
  current = next;
  listeners.forEach(listener => { try { listener({ reason }); } catch (_) {} });
  return current;
}
function load() {
  if (current) return current;
  const raw = storage().get();
  if (raw === undefined || raw === null || raw === '') {
    persist(seed(false), raw, 'initial');
  } else {
    const decoded = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const next = migrate(decoded);
    if (decoded.schema !== SCHEMA) { checkpoint(raw, 'migration'); persist(next, raw, 'migration'); }
    else current = next;
  }
  return current;
}
function commit(fn) {
  const next = clone(load());
  fn(next);
  next.updatedAt = timestamp();
  validate(next);
  const day = `${current.bookId}:${dateKey(clock())}`;
  if (checkpointDay !== day) { checkpoint(current, 'auto'); checkpointDay = day; }
  return persist(next, storage().get());
}
function allAccounts(state = load()) {
  const list = state.accounts.flatMap(group => group.children.map(child => ({
    ...child, groupId: group.id, groupName: group.name, kind: group.kind,
    label: `${group.name} · ${child.name}`, balance: child.opening
  })));
  const byId = Object.fromEntries(list.map(a => [a.id, a]));
  state.entries.forEach(e => {
    if (!byId[e.accountId]) return;
    byId[e.accountId].balance += ['expense', 'transfer'].includes(e.type) ? -e.amount : e.amount;
    if (e.type === 'transfer' && byId[e.toAccountId]) byId[e.toAccountId].balance += e.amount;
  });
  return list;
}
function summary(state = load(), anchor = today(state)) {
  const range = period(anchor, state.cycleDay);
  const rows = state.entries.filter(e => e.date >= range.start && e.date <= range.end);
  const spent = rows.reduce((sum, e) => sum + (e.type === 'expense' ? e.amount : e.type === 'refund' ? -e.amount : 0), 0);
  const income = rows.reduce((sum, e) => sum + (e.type === 'income' ? e.amount : 0), 0);
  const budget = state.budgets[range.start] || { total: 0, categories: {} };
  const accounts = allAccounts(state);
  const assets = accounts.reduce((sum, a) => sum + a.balance, 0);
  const byCategory = state.categories.filter(c => c.type === 'expense').map(c => {
    const used = rows.reduce((sum, e) => {
      const cat = e.type === 'refund' ? (state.entries.find(x => x.id === e.originalId) || {}).categoryId : e.categoryId;
      return sum + (cat === c.id ? (e.type === 'expense' ? e.amount : e.type === 'refund' ? -e.amount : 0) : 0);
    }, 0);
    const limit = budget.categories[c.id] || 0;
    return { ...c, used, limit, left: limit - used, percent: limit ? Math.min(100, used / limit * 100) : 0 };
  });
  const currentDate = today(state);
  const through = currentDate < range.start ? null : currentDate < range.end ? currentDate : range.end;
  const days = through ? Math.round((localDate(through) - localDate(range.start)) / 86400000) + 1 : 0;
  return { ...range, anchor, through, days, isCurrent: period(currentDate, state.cycleDay).start === range.start, spent, income, assets, budget, remaining: budget.total - spent,
    usedPercent: budget.total ? Math.max(0, spent / budget.total * 100) : 0,
    accountCount: state.accounts.length, byCategory, rows };
}
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function saveEntry(input, editId) {
  const amount = cents(input.amount);
  const state = load();
  const type = input.type;
  if (!['expense', 'income', 'transfer'].includes(type)) throw new Error('请选择账目类型');
  const accounts = allAccounts(state);
  if (!accounts.some(a => a.id === input.accountId)) throw new Error('请选择付款或收款账户');
  if (!validDate(input.date)) throw new Error('请选择正确的日期');
  if (input.date > today(state)) throw new Error('发生日期不能晚于今天');
  if (!validTime(input.time || entryMoment(state).time)) throw new Error('请选择正确的时间');
  if (type === 'transfer' && (!accounts.some(a => a.id === input.toAccountId) || input.accountId === input.toAccountId)) throw new Error('请选择不同的转入账户');
  if (type !== 'transfer' && !state.categories.some(c => c.id === input.categoryId && c.type === type)) throw new Error('请选择正确分类');
  if (editId && !state.entries.some(e => e.id === editId)) throw new Error('该账目已不存在');
  return commit(next => {
    const row = { id: editId || uid('entry'), type, amount, categoryId: input.categoryId || '',
      subcategory: input.subcategory || '', accountId: input.accountId,
      toAccountId: type === 'transfer' ? input.toAccountId : '', date: input.date,
      time: input.time || entryMoment(state).time, note: String(input.note || '').trim().slice(0, 160) };
    if (editId) {
      if (!['expense', 'income', 'transfer'].includes(next.entries.find(e => e.id === editId).type)) throw new Error('回款和余额调整不能改为普通账目');
      if (next.entries.some(e => e.originalId === editId)) throw new Error('这笔支出有关联回款，请先保留原始记录');
      next.entries[next.entries.findIndex(e => e.id === editId)] = row;
    } else next.entries.push(row);
  });
}
function removeEntry(id) {
  return commit(state => {
    if (state.entries.some(e => e.originalId === id)) throw new Error('请先处理关联回款，再删除原支出');
    state.entries = state.entries.filter(e => e.id !== id);
  });
}
function saveBudget(total, limits, day, anchor = today()) {
  const amount = cents(total, true);
  const converted = {};
  Object.keys(limits || {}).forEach(id => { converted[id] = cents(limits[id] || '0', true); });
  if (Object.values(converted).reduce((a, b) => a + b, 0) > amount) throw new Error('分类预算合计不能超过总预算');
  return commit(state => {
    if (!validDate(anchor)) throw new Error('预算日期不正确');
    if (day !== undefined && (!Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 28)) throw new Error('起始日需为每月 1 至 28 日');
    if (day !== undefined && Number(day) !== state.cycleDay) {
      if (state.entries.length || Object.keys(state.budgets).length) throw new Error('已有账目或预算时暂不支持更改起始日，以保留历史统计口径');
      state.cycleDay = Number(day);
    }
    state.budgets[period(anchor, state.cycleDay).start] = { total: amount, categories: converted };
  });
}
function saveAccount(input) {
  const name = String(input.name || '').trim();
  const childName = String(input.childName || '余额').trim();
  if (!name || !childName) throw new Error('请填写账户名称');
  const opening = cents(input.balance || '0', true);
  return commit(state => {
    if (input.groupId) {
      const group = state.accounts.find(a => a.id === input.groupId);
      if (!group) throw new Error('父账户已不存在');
      if (group.children.some(c => c.name === childName)) throw new Error('该子账户名称已存在');
      group.children.push({ id: uid('account'), name: childName.slice(0, 20), opening });
    } else {
      if (state.accounts.some(g => g.name === name)) throw new Error('该账户已存在，可在账户详情中添加子账户');
      state.accounts.push({ id: uid('group'), name: name.slice(0, 20), kind: input.kind || 'wallet',
        children: [{ id: uid('account'), name: childName.slice(0, 20), opening }] });
    }
  });
}
function adjustBalance(id, value, note) {
  const amount = cents(value, true);
  const account = allAccounts().find(a => a.id === id);
  if (!account) throw new Error('账户已不存在');
  const difference = amount - account.balance;
  if (!difference) return load();
  return commit(state => state.entries.push({ id: uid('adjust'), type: 'adjustment', amount: difference,
    accountId: id, ...entryMoment(state), note: note || '手动更新账户余额' }));
}
function refund(id, value, date, label) {
  const amount = cents(value);
  return commit(state => {
    const original = state.entries.find(e => e.id === id && e.type === 'expense');
    if (!original) throw new Error('原支出不存在');
    if (!validDate(date)) throw new Error('回款日期不正确');
    if (date < original.date || date > today(state)) throw new Error('回款日期需在原支出日期与今天之间');
    if (period(date, state.cycleDay).start !== period(original.date, state.cycleDay).start) {
      throw new Error('跨预算周期回款的归属规则尚未确定，请先保留原账目');
    }
    const refunded = state.entries.filter(e => e.originalId === id).reduce((n, e) => n + e.amount, 0);
    if (amount + refunded > original.amount) throw new Error('回款金额不能超过原支出的剩余金额');
    state.entries.push({ id: uid('refund'), type: 'refund', amount, originalId: id, accountId: original.accountId,
      categoryId: original.categoryId, date, time: entryMoment(state).time, note: label || '退款', subcategory: original.subcategory });
  });
}
function saveCategory(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('请填写分类名称');
  return commit(state => {
    if (state.categories.some(c => c.name === name && c.type === input.type && c.id !== input.id)) throw new Error('该分类名称已存在');
    // Ordered arrays preserve names containing commas; legacy text imports stay compatible.
    // Removing an option never rewrites an existing entry's subcategory text.
    let children;
    if (Array.isArray(input.children)) {
      if (input.children.some(v => typeof v !== 'string' || !v.trim())) throw new Error('请填写子分类名称，或删除空白项');
      children = input.children.map(v => v.trim());
      if (new Set(children).size !== children.length) throw new Error('子分类名称不能重复');
    } else {
      children = String(input.children || '未分类').split(/[，,、\n]/).map(v => v.trim()).filter(Boolean);
    }
    const data = { id: input.id || uid('category'), name: name.slice(0, 12), type: input.type || 'expense',
      icon: input.icon || 'ellipsis', children: [...new Set(children)] };
    const index = state.categories.findIndex(c => c.id === input.id);
    if (index >= 0) state.categories[index] = data;
    else state.categories.push(data);
  });
}
function backup() {
  return serialize(load());
}
function parseBackup(text) {
  const file = JSON.parse(text);
  if (!file || file.format !== 'pearl-ledger-backup' || ![1, 2].includes(file.version) || !file.data || file.version !== file.data.schema) throw new Error('请选择当前或旧版应用导出的 JSON 备份');
  return migrate(file.data);
}
function restore(text) {
  const next = clone(parseBackup(text));
  const previous = storage().get();
  checkpoint(previous, 'restore');
  persist(next, previous, 'restore'); epoch++; checkpointDay = '';
  return current;
}
function applyCloud(state) {
  const next = migrate(state), previous = storage().get();
  checkpoint(previous, 'restore');
  persist(next, previous, 'cloud'); epoch++; checkpointDay = '';
  return current;
}
function reset(demo) {
  const next = seed(demo);
  const previous = storage().get();
  checkpoint(previous, 'reset');
  persist(next, previous, 'reset'); epoch++; checkpointDay = '';
  return current;
}
module.exports = { load, money, cents, dateKey, localDate, period, summary, allAccounts, saveEntry,
  removeEntry, saveBudget, saveAccount, adjustBalance, refund, saveCategory, backup, parseBackup,
  restore, reset, seed, validate, commit, validDate, validTime, today, entryMoment, migrate, serialize, applyCloud,
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  createRecovery(reason = 'manual') { load(); checkpoint(storage().get(), reason); },
  generation() { return epoch; },
  setClock(value) { clock = value || (() => new Date()); },
  setAdapter(value) { adapter = value; current = null; checkpointDay = ''; epoch++; },
  reload() { current = null; return load(); }
};
