const icons = require('../../utils/icon-library');
const aliases = { 'credit-card': 'wallet', 'file-text': 'notebook-pen', 'user-round': 'wallet',
  'arrow-right-left': 'arrow-up-right', settings: 'sliders-horizontal', download: 'arrow-down-left',
  upload: 'arrow-up-right', 'chevron-up': 'chevron-down' };
Component({
  properties: { name: { type: String, value: 'ellipsis' }, size: { type: Number, value: 22 },
    color: { type: String, value: '#171b16' } },
  data: { src: '' },
  observers: { 'name,color': function () { this.render(); } },
  lifetimes: { attached() { this.render(); } },
  methods: { render() {
    const name = icons[this.data.name] ? this.data.name : aliases[this.data.name] || 'ellipsis';
    const color = /^#[\da-f]{3,8}$/i.test(this.data.color) ? this.data.color : '#171b16';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
    this.setData({ src: 'data:image/svg+xml,' + encodeURIComponent(svg) });
  } }
});
