return (() => {
  'use strict';

  const MAX_TURNS = 200;
  const MAX_TEXT = 200000;
  const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n').trimEnd();
  const visible = element => {
    if (!element || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const visibleAll = selector => Array.from(document.querySelectorAll(selector)).filter(visible);
  const compactText = element => String(element?.innerText || element?.textContent || '')
    .trim().replace(/\s+/g, ' ');
  const boundedText = (element, preserveUserSource = false) => {
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, form, textarea, input, [contenteditable="true"], [aria-hidden="true"], [data-testid*="copy"], [data-testid*="action"]').forEach(node => node.remove());
    if (preserveUserSource) {
      clone.querySelectorAll('code.user-message-inline-code').forEach(node => {
        node.replaceWith(document.createTextNode(`\`${node.textContent || ''}\``));
      });
    }
    const text = normalize(clone.innerText || clone.textContent || '');
    return { text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
  };
  const nodePlainText = node => {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    if (node.tagName === 'BR') return '\n';
    return Array.from(node.childNodes).map(nodePlainText).join('');
  };
  const composerPlainText = element => {
    const blocks = Array.from(element.children);
    return normalize(blocks.length
      ? blocks.map(block => block.children.length === 1 && block.firstElementChild.tagName === 'BR'
        ? ''
        : nodePlainText(block)).join('\n')
      : nodePlainText(element));
  };
  const collectTurns = role => {
    const seen = new Set();
    const turns = [];
    for (const marker of document.querySelectorAll(`[data-message-author-role="${role}"]`)) {
      const container = marker.closest('article[data-testid^="conversation-turn-"]') || marker;
      if (seen.has(container)) continue;
      seen.add(container);
      const content = boundedText(container, role === 'user');
      if (!content.text) continue;
      turns.push({
        ordinal: turns.length,
        key: container.getAttribute('data-message-id') || container.getAttribute('data-testid') || `${role}-${turns.length}`,
        content: content.text,
        truncated: content.truncated,
      });
      if (turns.length > MAX_TURNS) break;
    }
    return turns;
  };

  const composers = visibleAll('#prompt-textarea').filter(element => !element.hasAttribute('disabled'));
  const sendButtons = visibleAll('button[data-testid="send-button"]').filter(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true');
  const stopButtons = visibleAll('button[data-testid="stop-button"], button[data-testid="stop-generating-button"]');
  const loginControls = visibleAll('a[data-testid="login-button"], button[data-testid="login-button"], form[action*="/auth/login"]');
  const challengeControls = visibleAll('input[type="password"], input[autocomplete="one-time-code"], iframe[src*="captcha" i], [data-testid*="captcha" i], [data-testid*="challenge" i]');
  const composerRect = composers.length === 1 ? composers[0].getBoundingClientRect() : null;
  const modeControls = composerRect
    ? visibleAll('button[aria-haspopup="menu"]').filter(element => {
      const rect = element.getBoundingClientRect();
      const text = compactText(element);
      const verticalGap = Math.max(composerRect.top - rect.bottom, rect.top - composerRect.bottom, 0);
      const horizontallyAdjacent = rect.right >= composerRect.left - 40 && rect.left <= composerRect.right + 40;
      return !element.closest('[role="menu"]') && (text === 'Pro' || text === '极高') &&
        horizontallyAdjacent && verticalGap <= 40;
    })
    : [];
  const selectedModeLabel = modeControls.length === 1 ? compactText(modeControls[0]) : '';
  const userTurns = collectTurns('user');
  const assistantTurns = collectTurns('assistant');
  const composerValue = composers.length === 1
    ? composerPlainText(composers[0])
    : '';

  return {
    schemaVersion: 1,
    origin: location.origin,
    url: location.href,
    composer: { count: composers.length, value: composerValue },
    send: { count: sendButtons.length },
    auth: {
      loginCount: loginControls.length,
      challengeCount: challengeControls.length,
      proIndicatorCount: selectedModeLabel === 'Pro' ? 1 : 0,
    },
    model: {
      controlCount: modeControls.length,
      selectedLabel: selectedModeLabel,
      proSelected: selectedModeLabel === 'Pro',
    },
    generating: stopButtons.length > 0,
    userTurns,
    assistantTurns,
    turnLimitExceeded: userTurns.length > MAX_TURNS || assistantTurns.length > MAX_TURNS,
  };
})();
