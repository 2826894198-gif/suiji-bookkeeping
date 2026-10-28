const ledger = require('../../utils/ledger');
const { base, toast } = require('../../utils/page');
const common = base();
let childSequence = 0;
const childRow = name => ({ key: `child-${++childSequence}`, name });
function touchY(event) {
  const touch = event.touches && event.touches[0];
  return touch && Number.isFinite(touch.clientY) ? touch.clientY : event.detail && Number.isFinite(event.detail.y) ? event.detail.y : null;
}
Page({
  ...common,
  data: { ...common.data, type: 'expense', rows: [], form: {}, childRows: [], selectedChild: -1,
    canMoveUp: false, canMoveDown: false, newChild: '', deletedChildren: [], undoLabel: '', draggingKey: '', dragOffset: 0,
    saveStatus: '', saveState: 'saved',
    iconOptions: ['utensils', 'shopping-bag', 'train-front', 'shirt', 'house', 'gamepad-2', 'heart-pulse', 'coffee', 'plane', 'banknote', 'gift', 'ellipsis'] },
  loadPage(state) {
    this.setData({ rows: state.categories.filter(c => c.type === this.data.type).map(c => ({ ...c, childrenText: c.children.join(' / ') })), categoryCount: state.categories.length });
  },
  setType(e) { this.setData({ type: e.currentTarget.dataset.type }); this.refresh(); },
  setChildren(rows, index, extra = {}) {
    const selected = rows.length ? Math.max(0, Math.min(index, rows.length - 1)) : -1;
    this.setData({ childRows: rows, selectedChild: selected, canMoveUp: selected > 0,
      canMoveDown: selected >= 0 && selected < rows.length - 1, formError: '', ...extra });
  },
  create() { this.openEditor({ name: '', type: this.data.type, icon: 'ellipsis', children: [] }); },
  edit(e) {
    const category = ledger.load().categories.find(c => c.id === e.currentTarget.dataset.id);
    if (category) this.openEditor(category);
  },
  openEditor(category) {
    clearTimeout(this._saveTimer);
    this._drag = null;
    this.setData({ sheet: 'category', formError: '', form: { id: category.id || '', name: category.name, type: category.type, icon: category.icon },
      newChild: '', deletedChildren: [], undoLabel: '', draggingKey: '', dragOffset: 0,
      saveState: 'saved', saveStatus: category.id ? '已自动保存' : '填写名称后自动保存' });
    this.setChildren(category.children.map(childRow), 0);
    this._savedDraft = category.id ? this.draftSignature() : '';
  },
  onHide() { this.flushBeforeLeave(); common.onHide.call(this); },
  onUnload() { this.flushBeforeLeave(); clearTimeout(this._saveTimer); common.onUnload.call(this); },
  flushBeforeLeave() {
    if (this.data.sheet === 'category' && (this.data.form.id || this.data.form.name.trim())) this.persistDraft({ includePending: true });
  },
  dismissEditor() {
    clearTimeout(this._saveTimer);
    this._drag = null;
    common.closeSheet.call(this);
    this.setData({ draggingKey: '', dragOffset: 0 });
  },
  closeSheet() {
    if (this.data.sheet !== 'category') return this.dismissEditor();
    const empty = !this.data.form.id && !this.data.form.name.trim() && !this.data.childRows.length && !this.data.newChild.trim();
    if (empty || this.persistDraft({ includePending: true, required: true })) this.dismissEditor();
  },
  formInput(e) { this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value, formError: '' }); this.scheduleSave(); },
  iconSelect(e) { this.setData({ 'form.icon': e.currentTarget.dataset.icon }); this.persistDraft(); },
  childIndex(e) {
    const { key, index } = e.currentTarget.dataset;
    return key ? this.data.childRows.findIndex(row => row.key === key) : Number(index);
  },
  selectChild(e) {
    const index = this.childIndex(e);
    if (this.data.childRows[index]) this.setChildren(this.data.childRows, index);
  },
  childInput(e) {
    const index = this.childIndex(e);
    if (!this.data.childRows[index]) return;
    this.setData({ [`childRows[${index}].name`]: e.detail.value, formError: '' });
    this.scheduleSave();
  },
  inputBlur() { if (this.data.sheet === 'category') this.persistDraft(); },
  newChildInput(e) {
    const pending = this.draftSignature() !== this._savedDraft;
    this.setData({ newChild: e.detail.value, formError: '', saveState: e.detail.value.trim() || pending ? 'pending' : 'saved',
      saveStatus: e.detail.value.trim() ? '点＋添加，或点完成一起保存' : pending ? '尚未保存，请点完成保存' : '已自动保存' });
  },
  appendPendingChild(required = false) {
    const name = this.data.newChild.trim();
    if (!name) {
      if (required) this.setData({ formError: '请先填写新子分类的名称' });
      return !required;
    }
    if (this.data.childRows.some(c => c.name.trim() === name)) {
      this.setData({ formError: '已有同名子分类，请换一个名称', saveState: 'error', saveStatus: '未保存，请修改名称' });
      return false;
    }
    const next = [...this.data.childRows, childRow(name)];
    this.setChildren(next, next.length - 1, { newChild: '' });
    return true;
  },
  addChild() {
    if (this.appendPendingChild(true)) this.persistDraft();
  },
  moveChild(e) {
    const index = this.data.selectedChild;
    const target = index + Number(e.currentTarget.dataset.step);
    if (index < 0 || target < 0 || target >= this.data.childRows.length) return;
    const next = this.data.childRows.slice();
    const [child] = next.splice(index, 1); next.splice(target, 0, child);
    this.setChildren(next, target);
    this.persistDraft();
  },
  removeChild(e) {
    this.endChildDrag();
    const index = this.childIndex(e), next = this.data.childRows.slice();
    if (!next[index]) return;
    const [child] = next.splice(index, 1);
    const deleted = [...this.data.deletedChildren, { index, child }];
    this.setChildren(next, Math.min(index, next.length - 1), { deletedChildren: deleted, undoLabel: child.name || '空白项' });
    this.persistDraft();
  },
  undoRemoveChild() {
    const deleted = this.data.deletedChildren.slice(), removed = deleted.pop();
    if (!removed) return;
    const next = this.data.childRows.slice();
    let index = next.findIndex(c => c.name.trim() === removed.child.name.trim());
    if (index < 0) { index = Math.min(removed.index, next.length); next.splice(index, 0, removed.child); }
    this.setChildren(next, index, { deletedChildren: deleted, undoLabel: deleted.length ? deleted[deleted.length - 1].child.name || '空白项' : '' });
    this.persistDraft();
  },
  startChildDrag(e) {
    const index = this.childIndex(e), y = touchY(e);
    if (!this.data.childRows[index] || y === null) return;
    this._drag = { key: this.data.childRows[index].key, index, y };
    this.setChildren(this.data.childRows, index, { draggingKey: this._drag.key, dragOffset: 0 });
  },
  moveChildDrag(e) {
    if (!this._drag) return;
    const y = touchY(e); if (y === null) return;
    const next = this.data.childRows.slice();
    const delta = Math.max(-this._drag.index * 64, Math.min((next.length - 1 - this._drag.index) * 64, y - this._drag.y));
    const current = next.findIndex(c => c.key === this._drag.key);
    if (current < 0) return this.endChildDrag();
    // Rows have a fixed 56px height and an 8px gap; the handle owns this gesture.
    const target = Math.max(0, Math.min(next.length - 1, this._drag.index + Math.round(delta / 64)));
    if (target !== current) { const [child] = next.splice(current, 1); next.splice(target, 0, child); }
    this.setChildren(next, target, { draggingKey: this._drag.key, dragOffset: delta - (target - this._drag.index) * 64 });
  },
  endChildDrag() {
    const wasDragging = !!this._drag;
    this._drag = null; this.setData({ draggingKey: '', dragOffset: 0 });
    if (wasDragging) this.persistDraft();
  },
  draftSignature() {
    return JSON.stringify({ ...this.data.form, name: this.data.form.name.trim(), children: this.data.childRows.map(c => c.name.trim()) });
  },
  scheduleSave() {
    clearTimeout(this._saveTimer);
    this.setData({ saveState: 'pending', saveStatus: '等待自动保存…' });
    this._saveTimer = setTimeout(() => this.persistDraft(), 600);
  },
  persistDraft({ includePending = false, required = false } = {}) {
    clearTimeout(this._saveTimer);
    if (this.data.sheet !== 'category') return true;
    if (includePending && !this.appendPendingChild()) return false;
    const names = this.data.childRows.map(c => c.name.trim());
    let error = '';
    if (!this.data.form.name.trim()) error = '请填写主分类名称';
    else if (names.some(name => !name)) error = '请填写子分类名称，或用右侧删除按钮移除空白项';
    else if (new Set(names).size !== names.length) error = '子分类名称不能重复，请修改后保存';
    if (error) {
      this.setData({ formError: required || this.data.form.id || this.data.form.name.trim() ? error : '',
        saveState: 'pending', saveStatus: '尚未保存，请补全名称' });
      return false;
    }
    if (this.draftSignature() === this._savedDraft) {
      this.setData({ formError: '', saveState: this.data.newChild.trim() ? 'pending' : 'saved',
        saveStatus: this.data.newChild.trim() ? '点＋添加，或点完成一起保存' : '已自动保存' });
      return true;
    }
    this.setData({ busy: true, formError: '', saveState: 'saving', saveStatus: '正在保存…' });
    try {
      const state = ledger.saveCategory({ ...this.data.form, children: names });
      const saved = state.categories.find(c => c.id === this.data.form.id || !this.data.form.id && c.type === this.data.form.type && c.name === this.data.form.name.trim().slice(0, 12));
      if (!saved) throw new Error('未能确认保存结果，请重试');
      this.setData({ 'form.id': saved.id, saveState: this.data.newChild.trim() ? 'pending' : 'saved', saveStatus: this.data.newChild.trim() ? '点＋添加，或点完成一起保存' : '已自动保存' });
      this._savedDraft = this.draftSignature();
      this.refresh();
      return true;
    }
    catch (e) { this.setData({ formError: e.message, saveState: 'error', saveStatus: '保存失败，请点完成重试' }); return false; }
    finally { this.setData({ busy: false }); }
  },
  save() {
    if (this.data.busy) return;
    this.endChildDrag();
    if (this.persistDraft({ includePending: true, required: true })) { this.dismissEditor(); toast('分类和顺序已保存'); }
  }
});
