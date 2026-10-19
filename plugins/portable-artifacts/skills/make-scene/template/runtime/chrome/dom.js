// Tiny element builder for the chrome. Text only ever goes in through textContent / text nodes,
// so a label from the spec can never become markup.

/** h('button', { class: 'sc-btn', type: 'button', text: 'Explore' }, [child, ...]) -> HTMLElement */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'text') el.textContent = String(value);
    else if (name === 'class') el.className = value;
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) el.append(child);
  return el;
}

/** Keys that belong to a control the viewer is typing in or activating: the page-wide shortcuts leave them alone. */
export function isTypingTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/** Space and Enter act on the focused control: the Space shortcut must not steal them. */
export function isActivatable(target) {
  return Boolean(target?.closest?.('button, a[href], summary, [role="button"]'));
}
