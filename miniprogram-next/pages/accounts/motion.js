const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function identity(group) {
  const name = String(group.name || '');
  if (/建设银行|建行|\bccb\b/i.test(name)) return { brand: 'ccb', brandRatio: 5, material: 'silver' };
  if (/中国银行|中行|\bboc\b/i.test(name)) return { brand: 'boc', brandRatio: 175 / 49, material: 'champagne' };
  if (/微信|wechat/i.test(name)) return { brand: 'wechat', brandRatio: 1, material: 'sage' };
  const key = String(group.id || group.name || group.kind || 'account');
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash * 31) + key.charCodeAt(i)) >>> 0;
  return { brand: '', brandRatio: 1, material: ['champagne', 'silver', 'sage'][hash % 3] };
}

function layout(windowWidth, windowHeight) {
  const width = Math.min(760, Math.max(280, Number(windowWidth) || 390));
  const compactLayout = Number(windowHeight) > 0 && Number(windowHeight) < 650;
  const cardWidth = compactLayout ? 142 : width <= 350 ? 170 : 176;
  const step = cardWidth + 24;
  return { cardWidth, cardHeight: compactLayout ? 224 : width <= 350 ? 270 : 280, compactLayout, step, margin: (width - step) / 2 };
}

function poses(count, position, reduced = false) {
  return Array.from({ length: count }, (_, index) => {
    const distance = index - position;
    const amount = Math.min(Math.abs(distance), 2);
    const angle = reduced ? 0 : clamp(-distance * 35, -68, 68);
    const z = reduced ? 0 : -amount * 36;
    return `transform:perspective(900px) translateZ(${z.toFixed(2)}px) rotateY(${angle.toFixed(2)}deg) scale(${(1 - amount * .07).toFixed(4)});`;
  });
}

// A swipe chooses one whole account. It never persists a free scroll offset.
// Vertical intent and taps keep their normal page/activation behavior.
function swipeTarget(start, end, index, count) {
  if (!start || !end || count < 2) return index;
  const dx = Number(end.clientX) - Number(start.clientX);
  const dy = Number(end.clientY) - Number(start.clientY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) return index;
  return clamp(index - Math.sign(dx), 0, count - 1);
}

module.exports = { identity, layout, poses, swipeTarget };
