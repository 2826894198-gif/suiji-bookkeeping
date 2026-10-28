Component({
  properties: { rows: { type: Array, value: [] }, compact: { type: Boolean, value: false } },
  methods: { open(e) { this.triggerEvent('open', { id: e.currentTarget.dataset.id }); } }
});
