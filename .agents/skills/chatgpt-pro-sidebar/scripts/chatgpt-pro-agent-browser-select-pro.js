return (() => {
  'use strict';

  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ');
  const visible = element => {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const visibleAll = selector => Array.from(document.querySelectorAll(selector)).filter(visible);
  const label = element => normalize(element?.innerText || element?.textContent || '');
  const clearTag = name => document.querySelectorAll(`[${name}]`).forEach(element => element.removeAttribute(name));

  clearTag('data-codex-gptpro-mode-control');
  clearTag('data-codex-gptpro-pro-option');
  const composers = visibleAll('#prompt-textarea').filter(element => !element.hasAttribute('disabled'));
  if (composers.length !== 1) return { schemaVersion: 1, ok: false, reason: 'composer-count', count: composers.length };
  const composerRect = composers[0].getBoundingClientRect();
  const controls = visibleAll('button[aria-haspopup="menu"]').filter(element => {
    const rect = element.getBoundingClientRect();
    return !element.closest('[role="menu"]') && label(element) &&
      Math.abs((rect.y + rect.height / 2) - (composerRect.y + composerRect.height / 2)) <= 80;
  });
  if (controls.length !== 1) return { schemaVersion: 1, ok: false, reason: 'mode-control-count', count: controls.length };

  const control = controls[0];
  const selectedLabel = label(control);
  if (selectedLabel === 'Pro') return { schemaVersion: 1, ok: true, phase: 'already-pro', selectedLabel };
  if (control.getAttribute('aria-expanded') !== 'true') {
    control.setAttribute('data-codex-gptpro-mode-control', 'true');
    return { schemaVersion: 1, ok: true, phase: 'open-menu', selectedLabel };
  }

  const proOptions = visibleAll('[role="menuitemradio"]').filter(element => label(element) === 'Pro');
  if (proOptions.length === 1) {
    proOptions[0].setAttribute('data-codex-gptpro-pro-option', 'true');
    return { schemaVersion: 1, ok: true, phase: 'select-pro', selectedLabel };
  }
  if (proOptions.length > 1) return { schemaVersion: 1, ok: false, reason: 'pro-option-count', count: proOptions.length };

  const submenuItems = visibleAll('[role="menuitem"][aria-haspopup="menu"]').filter(element => {
    const text = label(element);
    return text === selectedLabel || text.endsWith(` ${selectedLabel}`);
  });
  if (submenuItems.length !== 1) return { schemaVersion: 1, ok: false, reason: 'mode-submenu-count', count: submenuItems.length };
  const item = submenuItems[0];
  const rect = item.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    clientX: rect.right - 10,
    clientY: rect.y + rect.height / 2,
    pointerType: 'mouse',
    buttons: 0,
  };
  item.focus();
  item.dispatchEvent(new PointerEvent('pointermove', init));
  item.dispatchEvent(new PointerEvent('pointerover', init));
  item.dispatchEvent(new PointerEvent('pointerenter', init));
  item.dispatchEvent(new MouseEvent('mousemove', init));
  item.dispatchEvent(new MouseEvent('mouseover', init));
  item.dispatchEvent(new MouseEvent('mouseenter', init));
  return { schemaVersion: 1, ok: true, phase: 'open-submenu', selectedLabel };
})();
