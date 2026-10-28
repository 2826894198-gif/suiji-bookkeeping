const echarts = require('./vendor/echarts.min');
const ledger = require('./ledger');
// Recent WeChat isolated contexts can expose a window while still using the
// native canvas adapter. Touch events are forwarded by ec-canvas; disable
// zrender's DOM event proxy, which expects addEventListener on an HTML canvas.
if (typeof wx !== 'undefined') {
  echarts.env.wxa = true;
  echarts.env.domSupported = false;
  echarts.env.node = true;
}
function daily(state, summary, lastSeven = false) {
  let start = ledger.localDate(summary.start);
  if (!summary.through) return [];
  const end = ledger.localDate(summary.through);
  if (lastSeven && (end - start) / 86400000 > 6) { start = new Date(end); start.setDate(end.getDate() - 6); }
  const result = [];
  for (let cursor = new Date(start); cursor <= end && result.length < 32; cursor.setDate(cursor.getDate() + 1)) {
    const key = ledger.dateKey(cursor);
    const amount = summary.rows.filter(e => e.date === key).reduce((n, e) => n + (e.type === 'expense' ? e.amount : e.type === 'refund' ? -e.amount : 0), 0);
    result.push({ date: key, label: String(cursor.getDate()), amount: amount / 100 });
  }
  return result;
}
function dailyScale(data) {
  const values = data.map(d => d.amount).filter(Number.isFinite);
  const lowest = Math.min(0, ...values), highest = Math.max(0, ...values);
  if (lowest === highest) return { min: 0, max: 1, interval: .5 };
  const padding = (highest - lowest) * .12;
  const lower = lowest < 0 ? lowest - padding : 0;
  const upper = highest > 0 ? highest + padding : 0;
  const rough = (upper - lower) / 3;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].find(n => n >= rough / magnitude) * magnitude;
  const round = n => Number(n.toFixed(8));
  return { min: round(Math.floor(lower / step) * step), max: round(Math.ceil(upper / step) * step), interval: round(step) };
}
function axisMoney(value) {
  if (Math.abs(value) >= 10000) return `${Number((value / 10000).toFixed(1))}万`;
  return String(Number(value.toFixed(2)));
}
function lineOption(data, selectedDate) {
  const found = data.findIndex(d => d.date === selectedDate);
  const selected = found >= 0 ? found : data.length - 1;
  const scale = dailyScale(data);
  return {
    animation: false, grid: { left: 7, right: 14, top: 16, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: data.map(d => d.date || d.label), boundaryGap: true,
      axisLine: { lineStyle: { color: '#e5e8e4' } }, axisTick: { lineStyle: { color: '#e2e6df' } },
      axisLabel: { color: '#6f7766', fontSize: 11, margin: 11, interval: Math.max(0, Math.ceil(data.length / 6) - 1),
        showMinLabel: true, showMaxLabel: true, hideOverlap: true,
        formatter: (value, index) => data[index] && data[index].date && (index === 0 || data[index].label === '1')
          ? `${Number(value.slice(5, 7))}/${data[index].label}` : data[index] ? data[index].label : value } },
    yAxis: { type: 'value', ...scale, axisLine: { show: false },
      axisTick: { show: false }, axisLabel: { color: '#6f7766', fontSize: 11, formatter: axisMoney },
      splitLine: { lineStyle: { color: '#e6e8e5', type: 'dashed' } } },
    series: [{ type: 'line', smooth: .35, data: data.map(d => d.amount), symbol: 'circle', symbolSize: 6,
      itemStyle: { color: '#101510', borderColor: '#fff', borderWidth: 1 },
      lineStyle: { color: '#151915', width: 1.8 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: 'rgba(163,185,95,.18)' }, { offset: 1, color: 'rgba(163,185,95,0)' }] } },
      markLine: { silent: true, symbol: 'none', label: { show: false },
        lineStyle: { color: '#a3af82', type: 'dashed', width: 1 },
        data: selected >= 0 ? [{ xAxis: selected }] : [] },
      markPoint: { symbol: 'circle', symbolSize: 8, silent: true,
        data: selected >= 0 ? [{ coord: [selected, data[selected].amount], value: data[selected].amount }] : [],
        itemStyle: { color: '#161c0f', borderColor: '#ddff58', borderWidth: 5 }, label: { show: false } }
    }]
  };
}
function donutOption(summary) {
  const colors = ['#7e922e', '#bd8c7e', '#d5dea7', '#888c80', '#b7beac', '#e4c9bc', '#9eaa77', '#e6e8de'];
  return {
    animation: false,
    series: [{ type: 'pie', radius: ['59%', '83%'], center: ['50%', '50%'],
      label: { show: false }, avoidLabelOverlap: true, padAngle: 3,
      itemStyle: { borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
      data: summary.byCategory.filter(c => c.used > 0).map((c, i) => ({ name: c.name, value: c.used, itemStyle: { color: colors[i % colors.length] } }))
    }],
    graphic: [
      { type: 'text', left: 'center', top: '40%', style: { text: summary.isCurrent ? '本期支出' : '所选周期', fill: '#868d7e', fontSize: 11, textAlign: 'center' } },
      { type: 'text', left: 'center', top: '51%', style: { text: `¥${ledger.money(summary.spent, false)}`, fill: '#191f13', fontSize: 25, fontWeight: 400, textAlign: 'center' } }
    ]
  };
}
function paint(page, selector, option, key = '_chart', onReady) {
  const component = page.selectComponent(selector);
  if (!component) return;
  if (page[key]) { page[key].setOption(option, true); return; }
  component.init((canvas, width, height, dpr) => {
    const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr || 1 });
    canvas.setChart(chart);
    chart.setOption(option);
    page[key] = chart;
    if (onReady) onReady(chart);
    return chart;
  });
}
function dispose(page, key = '_chart') { if (page[key]) { page[key].dispose(); page[key] = null; } }
module.exports = { daily, dailyScale, lineOption, donutOption, paint, dispose };
