const ledger = require('./ledger');
let selected = null;
let bookId = '';
function anchor(state = ledger.load()) {
  if (bookId !== state.bookId) { bookId = state.bookId; selected = null; }
  return selected || ledger.today(state);
}
function select(date, state = ledger.load()) {
  if (!ledger.validDate(date)) throw new Error('查看日期不正确');
  bookId = state.bookId;
  selected = ledger.period(date, state.cycleDay).start === ledger.period(ledger.today(state), state.cycleDay).start ? null : date;
}
function move(offset, state = ledger.load()) {
  const start = ledger.localDate(ledger.period(anchor(state), state.cycleDay).start);
  start.setMonth(start.getMonth() + offset);
  select(ledger.dateKey(start), state);
}
function reset() { selected = null; bookId = ''; }
module.exports = { anchor, select, move, reset };
