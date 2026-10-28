return (() => {
  'use strict';
  const p = /*APPROVED_UPLOAD_PAYLOAD*/ {};
  const normalize = v => String(v ?? '').replace(/\r\n?/g, '\n').trim();
  const visible = e => {
    if (!e || e.hidden || e.getAttribute('aria-hidden') === 'true') return false;
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const visibleAll = s => Array.from(document.querySelectorAll(s)).filter(visible);
  const composerSelector = '#prompt-textarea, :is(main, [role="main"]) form div.ProseMirror[role="textbox"][contenteditable="true"]:not([data-message-author-role], [data-message-author-role] *, article[data-testid^="conversation-turn-"] *)';
  if (location.origin !== 'https://chatgpt.com' || location.href !== p.expectedUrl || p.expectedUrl !== 'https://chatgpt.com/')
    return {schemaVersion: 1, ok: false, reason: 'upload-url-drift'};
  const composers = visibleAll(composerSelector).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true');
  if (composers.length !== 1) return {schemaVersion: 1, ok: false, reason: 'upload-composer-count'};
  const form = composers[0].closest('form');
  if (!form) return {schemaVersion: 1, ok: false, reason: 'upload-form-missing'};
  const fileInputs = Array.from(form.querySelectorAll('input[type="file"]')).filter(i =>
    i.form === form && i.closest('form') === form && !i.disabled && i.getAttribute('aria-disabled') !== 'true' &&
    !i.closest('[data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]') && !normalize(i.accept));
  const meta = e => ({
    tag: String(e.tagName || '').toLowerCase(), role: String(e.getAttribute('role') || '').slice(0,40),
    testId: String(e.getAttribute('data-testid') || '').slice(0,100),
    ariaLabel: String(e.getAttribute('aria-label') || '').slice(0,100),
    ariaBusy: e.getAttribute('aria-busy') === 'true',
    className: String(e.getAttribute('class') || '').slice(0,220),
    attrs: Array.from(e.attributes || []).filter(a => /^data-(?:state|file|attachment|upload|testid)/.test(a.name)).slice(0,12).map(a => ({name:a.name,value:String(a.value).slice(0,100)})),
  });
  const rawDisplayMap = p.displayNameMappings === undefined ? {} : p.displayNameMappings;
  if (!Array.isArray(p.expectedNames) || !p.expectedNames.length || p.expectedNames.length > 6 ||
      p.expectedNames.some(name => typeof name !== 'string' || !name) || new Set(p.expectedNames).size !== p.expectedNames.length ||
      !rawDisplayMap || typeof rawDisplayMap !== 'object' || Array.isArray(rawDisplayMap) ||
      Object.keys(rawDisplayMap).some(name => !p.expectedNames.includes(name) || typeof rawDisplayMap[name] !== 'string' ||
        !rawDisplayMap[name] || rawDisplayMap[name].length > 180 || normalize(rawDisplayMap[name]) !== rawDisplayMap[name]))
    return {schemaVersion: 1, ok: false, reason: 'upload-display-map-invalid'};
  const displayFor = name => Object.prototype.hasOwnProperty.call(rawDisplayMap, name) ? rawDisplayMap[name] : name;
  const expectedDisplays = p.expectedNames.map(displayFor);
  if (new Set(expectedDisplays).size !== expectedDisplays.length)
    return {schemaVersion: 1, ok: false, reason: 'upload-display-map-invalid'};
  const matches = p.expectedNames.map(name => {
    const displayName = displayFor(name);
    const leaves = Array.from(form.querySelectorAll('*')).filter(e => visible(e) &&
      !e.closest('[hidden], [aria-hidden="true"]') && e.closest('form') === form &&
      e.closest('span[class~="group/composer-attachment"]')?.closest('form') === form &&
      !e.closest('nav, aside, header, [role="banner"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]') &&
      normalize(e.textContent) === displayName && !Array.from(e.children).some(c => normalize(c.textContent) === displayName));
    return {name, expectedDisplayName: displayName, matchCount: leaves.length, ancestors: leaves.slice(0,2).map(e => {
      const result=[]; let node=e;
      for(let i=0;i<5 && node && node!==form;i++,node=node.parentElement) result.push(meta(node));
      return result;
    })};
  });
  // Read-only metadata: only exact model controls owned by this composer form.
  const modelControls = Array.from(form.querySelectorAll('button[aria-haspopup="menu"][aria-label="选择 ChatGPT 模型"]')).filter(e =>
    e.form === form && e.closest('form') === form && !e.closest('nav, aside, header, [role="banner"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]'));
  const modelInspection = {
    controlCount: modelControls.length, truncated: modelControls.length > 4,
    controls: modelControls.slice(0,4).map(e => ({
      tag: String(e.tagName || '').toLowerCase(), ariaLabel: String(e.getAttribute('aria-label') || '').slice(0,100),
      hasPopup: String(e.getAttribute('aria-haspopup') || '').slice(0,30),
      ariaExpanded: String(e.getAttribute('aria-expanded') || '').slice(0,10),
      ariaControls: String(e.getAttribute('aria-controls') || '').slice(0,100),
      testId: String(e.getAttribute('data-testid') || '').slice(0,100),
      visible: visible(e) && !e.closest('[hidden], [aria-hidden="true"]'),
      disabled: Boolean(e.disabled) || e.getAttribute('aria-disabled') === 'true', sameComposerForm: true,
      innerText: normalize(typeof e.innerText === 'string' ? e.innerText : '').slice(0,100),
      textContent: normalize(e.textContent).slice(0,100),
      exactInnerTextPro: normalize(typeof e.innerText === 'string' ? e.innerText : '') === 'Pro',
      exactTextContentPro: normalize(e.textContent) === 'Pro',
    })),
  };
  // Read-only diagnostics for the attachment class observed after this approved upload.
  const attachmentInspection = (() => {
    const excluded = 'nav, aside, header, [role="banner"], [data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id]';
    const owned = e => e.closest('form') === form && !e.closest(excluded);
    const shown = e => visible(e) && !e.closest('[hidden], [aria-hidden="true"]');
    const cardSelector = 'span[class~="group/composer-attachment"]';
    const allCards = Array.from(form.querySelectorAll(cardSelector));
    const cards = allCards.filter(owned);
    const historyCount = document.querySelectorAll('[data-message-author-role], :is(main, [role="main"]) [data-user-message-bubble], :is(main, [role="main"]) [data-chatgpt-selection-message-id]').length;
    const approvedBlankPage = historyCount === 0 && !normalize(composers[0].textContent);
    const cardRelations = e => {
      const nodes = [e, ...Array.from(e.querySelectorAll('*')).slice(0,256)];
      const cardControls = Array.from(e.querySelectorAll('button, [role="button"]')).filter(c => c.closest(cardSelector) === e && c.closest('form') === form && shown(c));
      const opens = cardControls.filter(c => String(c.tagName || '').toLowerCase() === 'button' && String(c.className || '').split(/\s+/).includes('composer-attachment-surface'));
      const names = opens.map(c => normalize(c.getAttribute('aria-label'))).filter(name => name && name.length <= 180);
      const relationMeta = c => ({...meta(c), id: String(c.getAttribute('id') || '').slice(0,100),
        nativeType: String(c.getAttribute('type') || '').slice(0,30), sameComposerForm: c.form === form,
        sameCardOwner: c.closest(cardSelector) === e, disabled: Boolean(c.disabled) || c.matches(':disabled') || c.getAttribute('aria-disabled') === 'true'});
      const removes = cardControls.filter(c => names.some(name => normalize(c.getAttribute('aria-label')) === `移除 ${name}`));
      const filenameNodes = nodes.filter(n => names.some(name => normalize(n.textContent) === name || normalize(n.getAttribute('title')) === name));
      const spinCount = nodes.filter(n => shown(n) && String(n.getAttribute('class') || '').split(/\s+/).includes('animate-spin')).length;
      return {id: String(e.getAttribute('id') || '').slice(0,100),
        openControlCount: opens.length, removeControlCount: removes.length,
        observedDisplayNames: names.slice(0,4),
        openControls: opens.slice(0,4).map(relationMeta), removeControls: removes.slice(0,4).map(relationMeta),
        uniqueOpenRemoveRelationship: opens.length === 1 && names.length === 1 && removes.length === 1,
        filenameEvidence: filenameNodes.slice(0,8).map(n => ({tag: String(n.tagName || '').toLowerCase(), className: String(n.className || '').slice(0,220), id: String(n.getAttribute('id') || '').slice(0,100),
          exactOpenLabelText: names.includes(normalize(n.textContent)), exactOpenLabelTitle: names.includes(normalize(n.getAttribute('title')))})),
        visibleZipLabelCount: nodes.filter(n => shown(n) && /^(?:ZIP|zip)$/.test(normalize(n.textContent)) && !Array.from(n.children || []).some(c => /^(?:ZIP|zip)$/.test(normalize(c.textContent)))).length,
        observedDisplayZipExtension: names.length === 1 && /\.zip$/i.test(names[0]), visibleAnimateSpinCount: spinCount,
        identityNodes: nodes.filter(n => n.getAttribute('id') || Array.from(n.attributes || []).some(a => /^data-(?:file|attachment|upload)/.test(a.name))).slice(0,8).map(n => ({...meta(n), id: String(n.getAttribute('id') || '').slice(0,100)})),
        svgMetadata: nodes.filter(n => String(n.tagName || '').toLowerCase() === 'svg').slice(0,6).map(meta),
      };
    };
    const cardInfo = e => ({...meta(e), ...cardRelations(e), visible: shown(e), sameComposerForm: true,
      expectedNameMatches: p.expectedNames.filter(name => normalize(e.textContent).includes(name)),
      exactFilenameEvidence: [e, ...Array.from(e.querySelectorAll('*')).slice(0,256)].flatMap(n => p.expectedNames.filter(name => normalize(n.textContent) === name || normalize(n.getAttribute('title')) === name || normalize(n.getAttribute('aria-label')) === name).map(name => ({name, tag: String(n.tagName || '').toLowerCase(), exactText: normalize(n.textContent) === name, exactTitle: normalize(n.getAttribute('title')) === name, exactAriaLabel: normalize(n.getAttribute('aria-label')) === name}))).slice(0,12),
      busyCount: Array.from(e.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).filter(shown).length,
      alertCount: Array.from(e.querySelectorAll('[role="alert"]')).filter(shown).length,
      controls: Array.from(e.querySelectorAll('button, [role="button"]')).filter(shown).slice(0,6).map(c => ({...meta(c), disabled: Boolean(c.disabled) || c.getAttribute('aria-disabled') === 'true'})),
    });
    const regions = approvedBlankPage ? Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"]')).filter(e => {
      if (!shown(e) || e.closest(excluded) || (e.closest('form') && e.closest('form') !== form) || e.contains(form) || e.contains(composers[0])) return false;
      const text = normalize(typeof e.innerText === 'string' ? e.innerText : e.textContent);
      return p.expectedNames.some(name => text.includes(name)) || /uploads?|attachments?|\bfiles?\b|\.zip\b|文件|附件|上传|上傳|不支持|不支援|无法上传|無法上傳/i.test(text);
    }) : [];
    const leaves = regions.filter(e => !regions.some(other => other !== e && e.contains(other)));
    const surfaceCount = Array.from(form.querySelectorAll('span')).filter(e => owned(e) && String(e.className || '').split(/\s+/).includes('composer-attachment-surface')).length;
    const mainOutsideFormCardCount = approvedBlankPage ? Array.from(document.querySelectorAll(':is(main, [role="main"]) span')).filter(e => !e.closest('form') && !e.closest(excluded) && String(e.className || '').split(/\s+/).includes('group/composer-attachment')).length : 0;
    const sendButtons = Array.from(form.querySelectorAll('button[data-testid="send-button"], button[type="submit"][aria-label="发送"]'));
    const enabledSendButtons = sendButtons.filter(e => e.form === form && e.closest('form') === form && !e.closest(excluded) && shown(e) && !e.disabled && !e.matches(':disabled') && e.getAttribute('aria-disabled') !== 'true');
    const sendAvailability = {rawCount: sendButtons.length, enabledCount: enabledSendButtons.length, uniqueEnabled: enabledSendButtons.length === 1};
    const visiblePageAlertCount = Array.from(document.querySelectorAll('[role="alert"]')).filter(e => shown(e) && !e.closest(excluded) && (!e.closest('form') || e.closest('form') === form)).length;
    return {approvedBlankPage, historyCount, visiblePageAlertCount, sendAvailability, surfaceCount, mainOutsideFormCardCount, formCardRawCount: allCards.length, ownedCardCount: cards.length,
      cardTruncated: cards.length > 6, cards: cards.slice(0,6).map(cardInfo),
      publicNotificationCount: leaves.length, notificationTruncated: leaves.length > 6,
      publicNotifications: leaves.slice(0,6).map(e => ({...meta(e), visible: true,
        publicText: normalize(typeof e.innerText === 'string' ? e.innerText : e.textContent).slice(0,400)})),
    };
  })();
  const observation = {
    schemaVersion: 1, ok: true, phase: 'observed', url: location.href, fileInputCount: fileInputs.length,
    selectedFileCount: fileInputs.length === 1 && fileInputs[0].files ? fileInputs[0].files.length : null,
    modelInspection, attachmentInspection, matches, busyCount: Array.from(form.querySelectorAll('[aria-busy="true"], [role="progressbar"]')).filter(visible).length,
    alertCount: Array.from(form.querySelectorAll('[role="alert"]')).filter(visible).length,
    readyProved: false,
  };
  // Candidate proof from the fixed public card structure; the caller enforces two stable observations.
  const cards = attachmentInspection.cards;
  let cardSetIssue = '';
  const failCards = issue => { if (!cardSetIssue) cardSetIssue = issue; };
  if (attachmentInspection.historyCount) failCards('AttachmentHistoryPresent');
  if (fileInputs.length !== 1 || observation.selectedFileCount === null) failCards('AttachmentInputAmbiguous');
  if (observation.selectedFileCount !== 0) failCards('AttachmentFileStillSelected');
  if (attachmentInspection.cardTruncated) failCards('AttachmentSetTruncated');
  if (attachmentInspection.mainOutsideFormCardCount) failCards('AttachmentOutsideComposerForm');
  if (observation.busyCount) failCards('AttachmentPending');
  if (observation.alertCount || attachmentInspection.visiblePageAlertCount) failCards('AttachmentError');
  const publicErrorCount = attachmentInspection.publicNotifications.filter(n => n.role === 'alert' || /error|fail|unsupported|not supported|too (?:large|many)|错误|失败|不支持|不支援|无法|無法/i.test(n.publicText)).length;
  const publicPendingCount = attachmentInspection.publicNotifications.filter(n => /uploading|正在上传|上傳中|上传中|正在上傳/i.test(n.publicText)).length;
  if (publicErrorCount) failCards('AttachmentError');
  if (publicPendingCount) failCards('AttachmentPending');
  const observedNames = [];
  for (const card of cards) {
    if (!card.visible || !card.sameComposerForm) failCards('AttachmentHiddenOrUnowned');
    if (card.ariaBusy || card.busyCount || card.visibleAnimateSpinCount) failCards('AttachmentPending');
    if (card.alertCount) failCards('AttachmentError');
    if (!card.uniqueOpenRemoveRelationship || card.observedDisplayNames.length !== 1 ||
        card.openControls.length !== 1 || card.removeControls.length !== 1 ||
        card.openControls[0].disabled || card.removeControls[0].disabled ||
        !card.openControls[0].sameComposerForm || !card.removeControls[0].sameComposerForm ||
        !card.openControls[0].sameCardOwner || !card.removeControls[0].sameCardOwner)
      failCards('AttachmentOpenRemoveAmbiguous');
    if (!card.observedDisplayZipExtension || !card.filenameEvidence.some(e => e.exactOpenLabelText))
      failCards('AttachmentFilenameUnproved');
    const displayName = card.observedDisplayNames.length === 1 ? card.observedDisplayNames[0] : '';
    if (!expectedDisplays.includes(displayName)) failCards('AttachmentUnexpectedDisplayName');
    if (observedNames.includes(displayName)) failCards('AttachmentDuplicateDisplayName');
    observedNames.push(displayName);
  }
  if (cards.length && !attachmentInspection.sendAvailability.uniqueEnabled) failCards('AttachmentSendUnavailable');
  const candidates = matches.map(match => {
    const selected = cards.filter(card => card.observedDisplayNames.length === 1 && card.observedDisplayNames[0] === match.expectedDisplayName);
    const card = selected.length === 1 ? selected[0] : null;
    const idEvidence = card ? card.identityNodes.map(n => [n.id, n.attrs.filter(a => /^data-(?:file|attachment|upload)-(?:id|key)$/.test(a.name)).slice(0,3).map(a => [a.name,a.value])]) : [];
    const signature = card ? JSON.stringify([1, match.name, match.expectedDisplayName, card.id, card.openControls[0]?.id || '', card.removeControls[0]?.id || '', idEvidence]) : '';
    if (signature.length > 4096) failCards('AttachmentSignatureTooLong');
    if (card && match.matchCount !== 1) failCards('AttachmentFilenameAmbiguous');
    return {match, card, count: selected.length, signature};
  });
  observation.cardSetValid = !cardSetIssue;
  observation.cardSetIssue = cardSetIssue;
  observation.publicUploadErrorCount = publicErrorCount;
  observation.publicUploadPendingCount = publicPendingCount;
  for (const candidate of candidates) {
    const match = candidate.match;
    match.cardMatchCount = candidate.count;
    match.observedDisplayName = candidate.card ? candidate.card.observedDisplayNames[0] : '';
    match.readyProved = observation.cardSetValid && candidate.count === 1;
    match.cardSignature = match.readyProved ? candidate.signature : '';
  }
  const currentProof = matches.filter(m => m.readyProved).map(m => [m.name,m.observedDisplayName,m.cardSignature]);
  observation.observedCardSetSignature = observation.cardSetValid ? JSON.stringify(currentProof) : '';
  observation.readyProved = observation.cardSetValid && cards.length === p.expectedNames.length && matches.every(m => m.readyProved);
  observation.cardSetSignature = observation.readyProved ? observation.observedCardSetSignature : '';
  if (p.action === 'inspect') return observation;
  if (p.action !== 'assign' || !p.file || !/^[a-f0-9]{64}$/.test(p.file.sha256) || !p.expectedNames.includes(p.file.name))
    return {schemaVersion: 1, ok: false, reason: 'upload-payload-invalid'};
  if (fileInputs.length !== 1) return {schemaVersion: 1, ok: false, reason: 'upload-input-count', count:fileInputs.length};
  if (observation.busyCount || observation.alertCount) return {schemaVersion:1,ok:false,reason:'upload-transfer-active-or-error'};
  if (normalize(composers[0].textContent) || visibleAll('button[data-testid="stop-button"], button[data-testid="stop-generating-button"], input[type="password"], input[autocomplete="one-time-code"], iframe[src*="captcha" i]').length)
    return {schemaVersion: 1, ok: false, reason: 'upload-page-not-ready'};
  if (document.querySelectorAll('[data-message-author-role], :is(main, [role="main"]) [data-user-message-bubble], :is(main, [role="main"]) [data-chatgpt-selection-message-id]').length)
    return {schemaVersion:1,ok:false,reason:'upload-history-present'};
  const proControls = modelControls.filter(e => visible(e) && !e.closest('[hidden], [aria-hidden="true"]') &&
    !e.disabled && !e.matches(':disabled') && e.getAttribute('aria-disabled') !== 'true' &&
    normalize(typeof e.innerText === 'string' ? e.innerText : '') === 'Pro');
  if (modelControls.length !== 1 || proControls.length !== 1) return {schemaVersion: 1, ok: false, reason: 'upload-pro-unproved'};
  if (matches.some(m => m.name === p.file.name && m.matchCount !== 0)) return {schemaVersion:1,ok:false,reason:'upload-duplicate-existing'};
  const input=fileInputs[0];
  if (input.files && input.files.length) return {schemaVersion:1,ok:false,reason:'upload-input-not-cleared'};
  const bytes=Uint8Array.from(atob(p.file.base64),c=>c.charCodeAt(0));
  if(bytes.length!==p.file.sizeBytes) return {schemaVersion:1,ok:false,reason:'upload-byte-length'};
  const file=new File([bytes],p.file.name,{type:'application/zip'});
  const transfer=new DataTransfer();transfer.items.add(file);
  input.files=transfer.files;
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  return {schemaVersion:1,ok:true,phase:'assigned',name:file.name,sizeBytes:file.size,fileType:file.type,fileNameVerified:file.name===p.file.name,fileSizeVerified:file.size===p.file.sizeBytes,selectedFileCount:input.files.length,readyProved:false};
})();
