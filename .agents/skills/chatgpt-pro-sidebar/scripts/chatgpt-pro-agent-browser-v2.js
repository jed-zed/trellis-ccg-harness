return (() => {
  'use strict';

  const COMPOSER_FALLBACK_SELECTOR = ":is(main, [role=\"main\"]) form div.ProseMirror[role=\"textbox\"][contenteditable=\"true\"]:not([data-message-author-role], [data-message-author-role] *, article[data-testid^=\"conversation-turn-\"] *)";

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
    const text = normalize(nodePlainText(clone));
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
      ? blocks.map(block => block.children.length === 1 && block.childNodes.length === 1 && block.firstElementChild.tagName === 'BR'
        ? ''
        : nodePlainText(block)).join('\n')
      : nodePlainText(element));
  };
  let turnExtractionIssue = '';
  const newAssistantContexts = new Set();
  const newAssistantBodies = new Map();
  const newAssistantMessageIds = new Map();
  const transcriptBodies = [];
  const newTurnCounts = { user: 0, assistant: 0 };
  const NEW_USER_SELECTOR = ':is(main, [role="main"]) [data-user-message-bubble]';
  const NEW_ASSISTANT_SELECTOR = ':is(main, [role="main"]) [data-markdown-text-style="assistant-message"][data-selected-text-overlay-target]';
  const safeTranscriptNode = element => visible(element) &&
    !element.closest('form, nav, aside, header, [role="banner"], [hidden], [aria-hidden="true"]');
  const failTurn = issue => { if (!turnExtractionIssue) turnExtractionIssue = issue; };
  const collectTurns = role => {
    const seen = new Set();
    const turns = [];
    const legacySelector = `[data-message-author-role="${role}"]`;
    const newSelector = role === 'user' ? NEW_USER_SELECTOR : NEW_ASSISTANT_SELECTOR;
    for (const marker of document.querySelectorAll(`${legacySelector}, ${newSelector}`)) {
      let container;
      let body;
      let key = '';
      const legacy = marker.closest(legacySelector);
      const oppositeLegacySelector = `[data-message-author-role="${role === 'user' ? 'assistant' : 'user'}"]`;
      if (!marker.matches(legacySelector) && marker.closest(oppositeLegacySelector)) {
        failTurn('MessageRoleConflict'); continue;
      }
      if (legacy) {
        container = legacy.closest('article[data-testid^="conversation-turn-"]') || legacy;
        body = container;
      } else {
        if (!safeTranscriptNode(marker)) continue;
        if (role === 'user') {
          if (marker.closest('[data-markdown-text-style="assistant-message"], [data-chatgpt-selection-message-id]')) {
            failTurn('MessageRoleConflict'); continue;
          }
          if (Array.from(marker.querySelectorAll('[data-user-message-bubble]')).some(safeTranscriptNode)) {
            failTurn('NestedUserMessage'); continue;
          }
          container = marker;
          body = marker;
        } else {
          if (marker.closest('[data-user-message-bubble]')) { failTurn('MessageRoleConflict'); continue; }
          container = marker.closest('[data-chatgpt-selection-conversation-id][data-chatgpt-selection-message-id]');
          if (!container || !safeTranscriptNode(container)) { failTurn('AssistantOwnerMissing'); continue; }
          if (Array.from(container.querySelectorAll('[data-user-message-bubble]')).some(safeTranscriptNode)) {
            failTurn('MessageRoleConflict'); continue;
          }
          key = String(container.getAttribute('data-chatgpt-selection-message-id') || '');
          const context = String(container.getAttribute('data-chatgpt-selection-conversation-id') || '');
          if (!/^[A-Za-z0-9:_-]{1,128}$/.test(key) || !/^[A-Za-z0-9:_-]{1,128}$/.test(context)) {
            failTurn('AssistantOwnerInvalid'); continue;
          }
          newAssistantContexts.add(context);
          if (newAssistantContexts.size > 1) { failTurn('AssistantContextAmbiguous'); }
          if (newAssistantBodies.has(container) && newAssistantBodies.get(container) !== marker) {
            failTurn('AssistantBodyAmbiguous'); continue;
          }
          if (newAssistantMessageIds.has(key) && newAssistantMessageIds.get(key) !== container) {
            failTurn('AssistantMessageIdAmbiguous'); continue;
          }
          newAssistantBodies.set(container, marker);
          newAssistantMessageIds.set(key, container);
          body = marker;
        }
        newTurnCounts[role]++;
      }
      if (seen.has(container)) continue;
      seen.add(container);
      transcriptBodies.push(body);
      const content = boundedText(body, role === 'user');
      if (!content.text) {
        if (!legacy && role === 'user') failTurn('UserMessageContentMissing');
        continue;
      }
      turns.push({
        ordinal: turns.length,
        key: key || container.getAttribute('data-message-id') || container.getAttribute('data-testid') || `${role}-${turns.length}`,
        content: content.text,
        truncated: content.truncated,
      });
      if (turns.length > MAX_TURNS) break;
    }
    return turns;
  };

  const composers = visibleAll(`#prompt-textarea, ${COMPOSER_FALLBACK_SELECTOR}`).filter(element =>
    !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true' &&
    !element.closest('[hidden], [aria-hidden="true"]')
  );
  const childPath = (element, ancestor) => {
    const path = [];
    let node = element;
    while (node && node !== ancestor && path.length < 32) {
      const parent = node.parentElement;
      if (!parent) return null;
      const index = Array.from(parent.children).indexOf(node) + 1;
      if (index < 1 || index > 9999) return null;
      path.unshift(`:nth-child(${index})`);
      node = parent;
    }
    return node === ancestor && path.length ? path : null;
  };
  let composerSelector = composers.length === 1
    ? (composers[0].id === 'prompt-textarea' ? '#prompt-textarea' : COMPOSER_FALLBACK_SELECTOR)
    : '';
  if (composerSelector && document.querySelectorAll(composerSelector).length > 1) {
    // ponytail: narrow the proved visible node with the existing bounded child-path pattern.
    const path = childPath(composers[0], document.documentElement);
    if (path) composerSelector += `:is(:root > ${path.join(' > ')})`;
  }
  const composerSelectorMatchCount = composerSelector ? document.querySelectorAll(composerSelector).length : 0;
  const SEND_LEGACY_SELECTOR = 'button[data-testid="send-button"]';
  const SEND_FALLBACK_SELECTOR = 'button[type="submit"][aria-label="发送"]';
  const SEND_ENABLED_SUFFIX = ':not(:disabled, [aria-disabled="true"], [hidden], [aria-hidden="true"])';
  const composerForm = composers.length === 1 ? composers[0].closest('form') : null;
  const sendCandidateSelector = `${SEND_LEGACY_SELECTOR}, ${SEND_FALLBACK_SELECTOR}`;
  const sendCandidates = composerForm ? Array.from(composerForm.querySelectorAll(sendCandidateSelector)) : [];
  const eligibleSend = element => visible(element) && !element.disabled && !element.matches(':disabled') &&
    element.getAttribute('aria-disabled') !== 'true' &&
    !element.closest('[hidden], [aria-hidden="true"], [data-message-author-role], article[data-testid^="conversation-turn-"]') &&
    element.closest('form') === composerForm && element.form === composerForm;
  const sendButtons = sendCandidates.filter(eligibleSend);
  const sendFormScope = composers.length === 1 && composerForm
    ? (composers[0].id === 'prompt-textarea'
      ? `form:has(${composerSelector})`
      : `:is(main, [role="main"]) form:has(${composerSelector.replace(':is(main, [role="main"]) form ', '')})`)
    : '';
  const selectedSendSelector = element => {
    const path = childPath(element, composerForm);
    if (!path) return '';
    const semantic = element.getAttribute('data-testid') === 'send-button' ? SEND_LEGACY_SELECTOR : SEND_FALLBACK_SELECTOR;
    path[path.length - 1] = semantic + path[path.length - 1] + SEND_ENABLED_SUFFIX;
    return sendFormScope + ' > ' + path.join(' > ');
  };
  const sendSelector = sendButtons.length === 1 ? selectedSendSelector(sendButtons[0]) : '';
  const sendSelectorMatchCount = sendSelector ? document.querySelectorAll(sendSelector).length : 0;
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
      return !element.closest('[role="menu"]') && (text === 'Pro' || text === '极高' ||
        ((text === 'Medium' || (text === '思考强度' && element.getAttribute('aria-expanded') === 'true')) &&
          composerForm && element.closest('form') === composerForm && element.form === composerForm &&
          element.getAttribute('aria-label') === '选择 ChatGPT 模型')) &&
        horizontallyAdjacent && verticalGap <= 40;
    })
    : [];
  const selectedModeLabel = modeControls.length === 1 ? compactText(modeControls[0]) : '';
  // Read-only bounded structural evidence for rejected assistant ownership. No text is read here.
  const ownershipInspection = (() => {
    const nodeMeta = e => e ? {
      tag: String(e.tagName || '').toLowerCase(), id: String(e.getAttribute('id') || '').slice(0,100),
      testId: String(e.getAttribute('data-testid') || '').slice(0,100), role: String(e.getAttribute('role') || '').slice(0,40),
      className: String(e.getAttribute('class') || '').slice(0,220), authorRole: String(e.getAttribute('data-message-author-role') || '').slice(0,30),
      markdownStyle: String(e.getAttribute('data-markdown-text-style') || '').slice(0,60), overlayTarget: e.hasAttribute('data-selected-text-overlay-target'),
      selectionConversationId: String(e.getAttribute('data-chatgpt-selection-conversation-id') || '').slice(0,128),
      selectionMessageId: String(e.getAttribute('data-chatgpt-selection-message-id') || '').slice(0,128),
      dataTurn: String(e.getAttribute('data-turn') || '').slice(0,100),
      inMain: Boolean(e.closest('main, [role="main"]')), visible: visible(e) && !e.closest('[hidden], [aria-hidden="true"]'),
      safeTranscript: safeTranscriptNode(e), attributeNames: Array.from(e.attributes || []).slice(0,20).map(a => String(a.name).slice(0,80)),
    } : null;
    const markers = Array.from(document.querySelectorAll(NEW_ASSISTANT_SELECTOR));
    const owners = markers.map(marker => marker.closest('[data-chatgpt-selection-conversation-id][data-chatgpt-selection-message-id]'));
    const selectedMarkers = markers.length > 8 ? [...markers.slice(0,4), ...markers.slice(-4)] : markers.slice(0,8);
    const records = selectedMarkers.map(marker => {
      const owner = marker.closest('[data-chatgpt-selection-conversation-id][data-chatgpt-selection-message-id]');
      const ancestryNodes = []; let node = marker;
      for (let i=0; node && i<8; i++,node=node.parentElement) ancestryNodes.push(node);
      for (const contextNode of [marker.closest('[class~="group/agent-activity"]'), marker.closest('[data-testid]')]) {
        if (contextNode && !ancestryNodes.includes(contextNode) && ancestryNodes.length < 10) ancestryNodes.push(contextNode);
      }
      const ancestry = ancestryNodes.map(nodeMeta);
      return {marker: nodeMeta(marker), requiredOwnerPresent: Boolean(owner), requiredOwnerSafe: Boolean(owner && safeTranscriptNode(owner)),
        requiredOwner: nodeMeta(owner), closestArticle: nodeMeta(marker.closest('article, [role="article"]')),
        closestAuthor: nodeMeta(marker.closest('[data-message-author-role]')),
        conversationOnlyAncestor: nodeMeta(marker.closest('[data-chatgpt-selection-conversation-id]')),
        messageOnlyAncestor: nodeMeta(marker.closest('[data-chatgpt-selection-message-id]')),
        ancestry, ancestryTruncated: Boolean(node)};
    });
    return {mainCount: document.querySelectorAll('main, [role="main"]').length,
      legacyUserMarkerCount: document.querySelectorAll('[data-message-author-role="user"]').length,
      legacyAssistantMarkerCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
      newUserMarkerCount: document.querySelectorAll(NEW_USER_SELECTOR).length, assistantMarkerCount: markers.length,
      assistantSafeMarkerCount: markers.filter(safeTranscriptNode).length, assistantOwnerPresentCount: owners.filter(Boolean).length, assistantOwnerSafeCount: owners.filter(owner => owner && safeTranscriptNode(owner)).length, recordsTruncated: markers.length > 8, assistantMarkers: records};
  })();
  const userTurns = collectTurns('user');
  const assistantTurns = collectTurns('assistant');
  const streamingSelector = '[aria-busy="true"], [data-streaming="true"], [data-is-streaming="true"]';
  const messageStreaming = transcriptBodies.some(body =>
    Boolean(body.closest(streamingSelector)) || Array.from(body.querySelectorAll(streamingSelector)).some(visible));
  const composerStopping = composerForm ? Array.from(composerForm.querySelectorAll('button')).some(button =>
    visible(button) && !button.closest('[hidden], [aria-hidden="true"]') &&
    /^(Stop|Stop generating|停止|停止生成|停止流式传输)$/i.test(String(button.getAttribute('aria-label') || '').trim())) : false;
  const composerBusy = composerForm ? (composerForm.matches(streamingSelector) || Array.from(composerForm.querySelectorAll(streamingSelector)).some(visible)) : false;
  const emptyAssistantPending = Array.from(newAssistantBodies.values()).some(body => !boundedText(body).text);
  const transcriptGenerating = messageStreaming || composerStopping || composerBusy || emptyAssistantPending;

  const composerValue = composers.length === 1
    ? composerPlainText(composers[0])
    : '';

  const buttonMetadata = element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      tag: String(element.tagName || '').toLowerCase(),
      id: String(element.id || '').slice(0, 80),
      testId: String(element.getAttribute('data-testid') || '').slice(0, 80),
      role: String(element.getAttribute('role') || '').slice(0, 40),
      type: String(element.getAttribute('type') || '').slice(0, 30),
      ariaLabel: String(element.getAttribute('aria-label') || '').slice(0, 100),
      disabled: Boolean(element.disabled || element.hasAttribute('disabled')),
      ariaDisabled: element.getAttribute('aria-disabled') === 'true',
      ariaHidden: element.getAttribute('aria-hidden') === 'true',
      visible: visible(element) && !element.closest('[hidden], [aria-hidden="true"]'),
      display: String(style.display || '').slice(0, 30),
      visibility: String(style.visibility || '').slice(0, 30),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
  };
  const publicModelLabel = (element, allowBoundMenuText = false) => {
    const value = compactText(element);
    if (allowBoundMenuText === true) return value.slice(0, 100);
    return ['Pro', '极高', 'Medium', '思考强度'].includes(value) ? value : '';
  };
  const modelControlCandidates = composerForm ? Array.from(composerForm.querySelectorAll('button[aria-haspopup="menu"]')).filter(element =>
    element.closest('form') === composerForm && element.form === composerForm &&
    element.getAttribute('aria-label') === '选择 ChatGPT 模型') : [];
  const linkedModelMenus = Array.from(document.querySelectorAll('[role="menu"]')).filter(menu => modelControlCandidates.some(control =>
    (menu.id && String(control.getAttribute('aria-controls') || '').split(/\s+/).includes(menu.id)) ||
    (control.id && String(menu.getAttribute('aria-labelledby') || '').split(/\s+/).includes(control.id))));
  const modelPublicMetadata = (element, allowBoundMenuText = false) => ({
    ...buttonMetadata(element), publicLabel: publicModelLabel(element, allowBoundMenuText),
    ariaChecked: ['true', 'false', 'mixed'].includes(element.getAttribute('aria-checked')) ? element.getAttribute('aria-checked') : '',
    ariaExpanded: element.getAttribute('aria-expanded') === 'true',
    hasPopup: String(element.getAttribute('aria-haspopup') || '').slice(0, 30),
    checked: Boolean(element.checked),
    dataState: String(element.getAttribute('data-state') || '').slice(0, 40),
    sameComposerForm: Boolean(composerForm && element.closest('form') === composerForm && element.form === composerForm),
  });
  const modelMenuTextAllowed = modelControlCandidates.length === 1 && linkedModelMenus.length === 1;
  const modelMenuPublicText = menu => {
    if (!modelMenuTextAllowed) return '';
    const clone = menu.cloneNode(true);
    clone.querySelectorAll('[role="menu"], form, nav, aside, header, [role="banner"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]').forEach(node => node.remove());
    return compactText(clone).slice(0, 1200);
  };
  const modelMenuPublicControls = menu => modelMenuTextAllowed ? Array.from(menu.querySelectorAll('button, [role="button"], input[type="radio"]')).filter(element =>
    element.closest('[role="menu"]') === menu && visible(element) &&
    !element.closest('[hidden], [aria-hidden="true"], form, nav, aside, header, [role="banner"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]')) : [];
  const inspection = {
    modelInspection: {
      candidateCount: modelControlCandidates.length,
      controls: modelControlCandidates.slice(0, 8).map(modelPublicMetadata),
      controlsTruncated: modelControlCandidates.length > 8,
      boundMenuCount: linkedModelMenus.length,
      menus: linkedModelMenus.slice(0, 4).map(menu => ({
        id: String(menu.id || '').slice(0, 80), role: 'menu', visible: visible(menu),
        publicText: modelMenuPublicText(menu),
        publicControlCount: modelMenuPublicControls(menu).length,
        publicControls: modelMenuPublicControls(menu).slice(0, 20).map(element => modelPublicMetadata(element, true)),
        publicControlsTruncated: modelMenuPublicControls(menu).length > 20,
        itemCount: menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]').length,
        items: Array.from(menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')).slice(0, 12).map(element => modelPublicMetadata(element,
          modelControlCandidates.length === 1 && linkedModelMenus.length === 1 && element.closest('[role="menu"]') === menu)),
      })),
      menusTruncated: linkedModelMenus.length > 4,
    },
    sendRawCandidateCount: sendCandidates.length,
    sendEligibleCount: sendButtons.length,
    sendSelectorMatchCount,
    sendFormScope,
    uploadInspection: {
      fileInputCount: document.querySelectorAll('input[type="file"]').length,
      fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).slice(0, 8).map(input => ({
        id: String(input.id || '').slice(0,80), testId: String(input.getAttribute('data-testid') || '').slice(0,80),
        accept: String(input.accept || '').slice(0,300), multiple: Boolean(input.multiple), disabled: Boolean(input.disabled),
        insideComposerForm: Boolean(composerForm && (input.closest('form') === composerForm || input.form === composerForm)),
        insideMessage: Boolean(input.closest('[data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]')),
        selectedFileCount: input.files ? input.files.length : 0,
      })),
      composerButtons: composerForm ? Array.from(composerForm.querySelectorAll('button')).slice(0,16).map(button => ({
        ...buttonMetadata(button), label: compactText(button).slice(0,100), hasPopup: String(button.getAttribute('aria-haspopup') || '').slice(0,30),
      })) : [],
      adjacentMenuControls: composerRect ? visibleAll('button[aria-haspopup]').filter(button => {
        const r = button.getBoundingClientRect();
        return !button.closest('nav, aside, [role="menu"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]') &&
          r.right >= composerRect.left - 40 && r.left <= composerRect.right + 40 &&
          Math.max(composerRect.top - r.bottom, r.top - composerRect.bottom, 0) <= 100;
      }).slice(0,12).map(button => ({...buttonMetadata(button), label: compactText(button).slice(0,100), hasPopup: String(button.getAttribute('aria-haspopup') || '').slice(0,30)})) : [],
    },
    composerFormPresent: Boolean(composerForm),
    composerFormButtonCount: composerForm ? composerForm.querySelectorAll('button').length : 0,
    composerFormButtons: composerForm ? Array.from(composerForm.querySelectorAll('button')).slice(0, 12).map(buttonMetadata) : [],
    legacySendGlobalRawCount: document.querySelectorAll('button[data-testid="send-button"]').length,
    legacySendGlobalEligibleCount: visibleAll(SEND_LEGACY_SELECTOR).filter(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true').length,
    legacySendFormRawCount: composerForm ? composerForm.querySelectorAll('button[data-testid="send-button"]').length : 0,
    legacySendFormEligibleCount: composerForm ? Array.from(composerForm.querySelectorAll('button[data-testid="send-button"]')).filter(element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true').length : 0,
    documentReadyState: String(document.readyState || 'unknown'),
    visibilityState: String(document.visibilityState || 'unknown'),
    iframeCount: document.querySelectorAll('iframe').length,
    mainCount: document.querySelectorAll('main, [role="main"]').length,
    busyCount: visibleAll('[aria-busy="true"], [role="progressbar"]').length,
    composerCandidates: Array.from(document.querySelectorAll('#prompt-textarea, textarea, [contenteditable="true"]')).slice(0, 8).map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: String(element.tagName || '').toLowerCase(),
        id: String(element.id || '').slice(0, 80),
        role: String(element.getAttribute('role') || '').slice(0, 40),
        contenteditable: String(element.getAttribute('contenteditable') || '').slice(0, 20),
        testId: String(element.getAttribute('data-testid') || '').slice(0, 80),
        className: String(element.className || '').slice(0, 120),
        insideMain: Boolean(element.closest('main, [role="main"]')),
        insideMessageTurn: Boolean(element.closest('[data-message-author-role]')),
        insideForm: Boolean(element.closest('form')),
        formId: String(element.closest('form')?.id || '').slice(0, 80),
        formTestId: String(element.closest('form')?.getAttribute('data-testid') || '').slice(0, 80),
        disabled: element.hasAttribute('disabled'),
        visible: visible(element) && !element.closest('[hidden], [aria-hidden="true"]'),
        display: String(style.display || '').slice(0, 30),
        visibility: String(style.visibility || '').slice(0, 30),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }),
    visibleLoginLabelCount: visibleAll('button, a').filter(element =>
      !element.closest('[data-message-author-role]') && /^(Log in|Login|Sign in|登录|登入)$/i.test(compactText(element))
    ).length,
  };

  return {
    schemaVersion: 1,
    inspection,
    origin: location.origin,
    url: location.href,
    composer: { count: composers.length, selector: composerSelector, selectorMatchCount: composerSelectorMatchCount, value: composerValue },
    send: { count: sendButtons.length, selector: sendSelector, selectorMatchCount: sendSelectorMatchCount, formScope: sendFormScope },
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
    generating: stopButtons.length > 0 || transcriptGenerating,
    turnExtractionIssue,
    turnInspection: { ownershipInspection, newUserCount: newTurnCounts.user, newAssistantCount: newTurnCounts.assistant, assistantContextCount: newAssistantContexts.size, messageStreaming, composerStopping, composerBusy, emptyAssistantPending },
    userTurns,
    assistantTurns,
    turnLimitExceeded: userTurns.length > MAX_TURNS || assistantTurns.length > MAX_TURNS,
  };
})();
