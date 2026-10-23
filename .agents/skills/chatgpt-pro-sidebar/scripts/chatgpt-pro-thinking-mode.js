return (() => {
  'use strict';
  // Only this finite integer is parameterized by the adapter; never prompt/user JS.
  const step = 0; // CCG_MODE_STEP
  const visible = e => {
    if (!e || e.hidden || e.closest('[hidden], [aria-hidden="true"]')) return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const text = e => String(e?.innerText || e?.textContent || '').trim().replace(/\s+/g, ' ');
  const fail = (reason, count = 0) => ({schemaVersion: 1, ok: false, reason, count});
  const safe = ':not([data-message-author-role], [data-message-author-role] *, article[data-testid^="conversation-turn-"] *)';
  const composers = Array.from(document.querySelectorAll('#prompt-textarea' + safe + ', :is(main, [role="main"]) form div.ProseMirror[role="textbox"][contenteditable="true"]' + safe)).filter(visible);
  if (composers.length !== 1) return fail('composer-count', composers.length);
  const composer = composers[0], form = composer.closest('form');
  if (!form) return fail('composer-form-missing');
  const r = composer.getBoundingClientRect();
  const controls = Array.from(form.querySelectorAll('button[aria-haspopup="menu"]')).filter(e => {
    const b = e.getBoundingClientRect();
    return visible(e) && e.closest('form') === form && e.form === form && !e.closest('[role="menu"]') &&
      /^(选择 ChatGPT 模型|(?:Choose|Select) ChatGPT model)$/i.test(String(e.getAttribute('aria-label') || '').trim()) &&
      b.right >= r.left - 40 && b.left <= r.right + 40 && Math.max(r.top - b.bottom, b.top - r.bottom, 0) <= 40;
  });
  if (controls.length !== 1) return fail('mode-control-count', controls.length);
  const control = controls[0];
  document.querySelectorAll('[data-codex-thinking-control], [data-codex-thinking-option], [data-codex-gptpro-mode-control]').forEach(e => {
    e.removeAttribute('data-codex-gptpro-mode-control'); e.removeAttribute('data-codex-thinking-control'); e.removeAttribute('data-codex-thinking-option');
  });
  control.setAttribute('data-codex-thinking-control', 'true');
  control.setAttribute('data-codex-gptpro-mode-control', 'true');
  const selectedLabel = text(control);
  if (control.getAttribute('aria-expanded') !== 'true') {
    if (step !== 0) return fail('menu-not-open');
    return {schemaVersion: 1, ok: true, phase: 'open-menu', selectedLabel};
  }
  const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(menu =>
    visible(menu) && ((menu.id && String(control.getAttribute('aria-controls') || '').split(/\s+/).includes(menu.id)) ||
      (control.id && String(menu.getAttribute('aria-labelledby') || '').split(/\s+/).includes(control.id))));
  if (menus.length !== 1) return fail('bound-menu-count', menus.length);
  const menu = menus[0];
  if (step === 2) {
    menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true, cancelable: true}));
    return {schemaVersion: 1, ok: true, phase: 'close-menu'};
  }
  const sliders = Array.from(menu.querySelectorAll('[data-reasoning-slider]')).filter(e => visible(e) && e.closest('[role="menu"]') === menu);
  const models = Array.from(menu.querySelectorAll('[data-model-selected][aria-checked="true"]')).slice(0, 4).map(text);
  if (sliders.length === 1) {
    if (models.length !== 1 || !models[0] || models[0].length > 64) return fail('selected-model-unproved', models.length);
    const statuses = Array.from(menu.querySelectorAll('[role="status"][aria-live]')).filter(e => visible(e) && e.closest('[role="menu"]') === menu);
    if (statuses.length !== 1) return fail('slider-status-count', statuses.length);
    const value = text(statuses[0]);
    let match = /^(.+?)[，,]\s*第\s*(\d+)\s*项[，,]\s*共\s*(\d+)\s*项[。.]*$/.exec(value);
    if (!match) match = /^(.+?),\s*(?:item\s*)?(\d+)\s*(?:of|\/)\s*(\d+)[.]*$/i.exec(value);
    if (!match) return fail('slider-position-unproved');
    const label = match[1].trim(), index = Number(match[2]), count = Number(match[3]);
    if (!label || label.length > 64 || count < 1 || count > 16 || index < 1 || index > count) return fail('slider-position-invalid');
    const slider = sliders[0];
    if (step !== 0) {
      if (step !== -1 && step !== 1) return fail('step-invalid');
      if (slider.getAttribute('aria-disabled') === 'true' || slider.closest('[aria-disabled="true"]')) return fail('slider-disabled');
      const keys = String(slider.getAttribute('aria-keyshortcuts') || '');
      if (!keys.includes('ArrowLeft') || !keys.includes('ArrowRight')) return fail('slider-shortcuts-unproved');
      if (index + step < 1 || index + step > count) return fail('slider-boundary');
      slider.focus();
      const key = step < 0 ? 'ArrowLeft' : 'ArrowRight';
      slider.dispatchEvent(new KeyboardEvent('keydown', {key, code: key, bubbles: true, cancelable: true}));
      slider.dispatchEvent(new KeyboardEvent('keyup', {key, code: key, bubbles: true, cancelable: true}));
    }
    return {schemaVersion: 1, ok: true, phase: step ? 'slider-step' : 'slider', currentLabel: label, index, count, selectedModelLabels: models};
  }
  if (sliders.length > 1) return fail('slider-count', sliders.length);
  return fail('thinking-slider-unavailable');
})();
