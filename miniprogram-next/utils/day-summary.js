// Transfer and balance adjustments are not daily income or spending.
function daySummary(rows) {
  let expense = 0, income = 0, refund = 0;
  rows.forEach(row => {
    if (row.type === 'expense') expense += row.amount;
    else if (row.type === 'income') income += row.amount;
    else if (row.type === 'refund') refund += row.amount;
  });
  return { expense, income, refund, netExpense: expense - refund };
}
module.exports = { daySummary };
