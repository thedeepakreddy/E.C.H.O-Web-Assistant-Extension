import { handleDomAction } from './actions';
import { initHighlighter, renderHighlights } from './highlighter';
import { initPassiveObserver } from './passive-observer';
import { startRecording } from './recorder';
import { videoTranscriptAction } from './video-transcript';
import { captureSelection } from './writer';
import { installWakeShortcut } from './wake-shortcut';

let uiLoaded = false;
let uiLoading: Promise<void> | null = null;
window.addEventListener('echo-ui-ready', () => { uiLoaded = true; }, { once: true });

/** Load React and the visual assistant only when something needs to be shown. */
function ensureUI(message?: unknown): void {
  if (message && !uiLoaded) {
    const w = window as any;
    (w.__echoPendingMessages ||= []).push(message);
  }
  if (uiLoaded || uiLoading) return;
  uiLoading = import(/* webpackIgnore: true */ chrome.runtime.getURL('content-ui.js'))
    .then(() => {})
    .catch(error => { uiLoading = null; console.error('[ECHO] UI failed to load:', error); });
}

// 1. DOM actions requested by the background (model tools AND the local stack).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ECHO_PING') {
    sendResponse({ success: true });
    return false;
  }
  // ECHO Writer: remember the selection the user right-clicked.
  if (message.type === 'ECHO_WRITER_CAPTURE') {
    try { sendResponse(captureSelection(String(message.requestId || ''))); }
    catch (e: any) { sendResponse({ success: false, error: e.message }); }
    return false;
  }
  // Transcripts need network and waiting, so this action answers asynchronously.
  if (message.type === 'DOM_ACTION' && message.action === 'get_video_transcript') {
    videoTranscriptAction(message.args)
      .then(sendResponse)
      .catch((e: any) => sendResponse({ success: false, error: e?.message || 'Transcript failed' }));
    return true;
  }
  if (message.type === 'DOM_ACTION') {
    try {
      const result = handleDomAction(message.action, message.args);
      sendResponse(result);
    } catch (e: any) {
      sendResponse({ success: false, error: e.message });
    }
    return true; // keep the channel open
  }

  // Background pushes back the highlights it has stored for this page.
  if (message.type === 'ECHO_APPLY_HIGHLIGHTS') {
    try {
      const painted = renderHighlights(message.texts || []);
      sendResponse({ success: true, painted });
    } catch {
      sendResponse({ success: false });
    }
    return true;
  }

  // Speech/status/chat/approval messages need the visual interface. The small
  // page-tools bundle remains available without downloading React on every URL.
  if (!uiLoaded && /^ECHO_(GLOBAL_WAKE|WAKE_AND_LISTEN|PREFS_UPDATED|STATE|WRITER_SHOW|SAY|SYNC_POSITION|OPEN_PALETTE|APPROVAL_|SPEECH_EVENT_)/.test(String(message.type || ''))) {
    ensureUI(message);
  }
});

installWakeShortcut(() => {
  chrome.runtime.sendMessage({ type: 'ECHO_WAKE_AND_LISTEN' }).catch(() => {});
});

// 2. Local-first features that run without any user action.
const initLocalFeatures = () => {
  chrome.runtime.sendMessage({ type: 'ECHO_CONTENT_PREFS' }).then((s: any) => {
    const autoIndex = s?.success && s.autoIndex === true && s.siteAllowed === true;
    const passive = s?.success && s.passiveSuggest === true;

    // Highlight capture is always on — it is purely local and user-initiated.
    initHighlighter();

    if (passive) { ensureUI(); initPassiveObserver(); }

    if (autoIndex) reportPageToKB();

    // Ask the background for any highlights saved on this page.
    chrome.runtime.sendMessage({ type: 'ECHO_GET_HIGHLIGHTS', url: location.href })
      .then((res: any) => {
        if (res?.texts?.length) renderHighlights(res.texts);
      })
      .catch(() => { /* background asleep — nothing to restore */ });
  }).catch(() => { initHighlighter(); });
  chrome.runtime.sendMessage({ type: 'ECHO_RECORD_STATUS' })
    .then((r: any) => { if (r?.active) startRecording(Number(r.count) || 0); })
    .catch(() => {});
  chrome.runtime.sendMessage({ type: 'CHECK_AWAKE_STATE' })
    .then((r: any) => { if (r?.isAwake) ensureUI({ type: 'ECHO_GLOBAL_WAKE', state: true }); })
    .catch(() => {});
};

/** Hand the readable text of this page to the background knowledge base. */
function reportPageToKB() {
  // Wait for the page to settle so SPAs have rendered their real content.
  setTimeout(() => {
    try {
      if (!/^https?:/.test(location.href)) return;
      const main = document.querySelector('article, main, [role="main"]') as HTMLElement | null;
      const source = main && main.innerText.length > 400 ? main : document.body;
      const text = (source?.innerText || '').replace(/\n\s*\n/g, '\n').trim();
      if (text.length < 250) return;
      chrome.runtime.sendMessage({
        type: 'ECHO_INDEX_PAGE',
        url: location.href,
        title: document.title,
        text: text.substring(0, 6000),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, 2500);
}

const boot = () => { initLocalFeatures(); };

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  boot();
} else {
  window.addEventListener('DOMContentLoaded', boot);
}
