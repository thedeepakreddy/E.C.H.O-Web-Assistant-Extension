const TAP_LIMIT_MS = 650;

type WakeKeyEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'isTrusted'>;

/**
 * A lone, quick Option/Alt tap wakes ECHO. Any second key cancels the tap, so
 * accent entry, browser shortcuts, Alt+Tab and ordinary key combinations keep
 * their normal behavior.
 */
export function wakeModifierHandlers(wake: () => void, now: () => number = Date.now) {
  let eligible = false;
  let pressedAt = 0;
  return {
    keydown(event: WakeKeyEvent) {
      if (!event.isTrusted) return;
      if (event.key === 'Alt' && !event.repeat && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        eligible = true;
        pressedAt = now();
      } else if (eligible) {
        eligible = false;
      }
    },
    keyup(event: WakeKeyEvent) {
      if (!event.isTrusted || event.key !== 'Alt') return;
      const shouldWake = eligible && now() - pressedAt <= TAP_LIMIT_MS;
      eligible = false;
      if (shouldWake) wake();
    },
  };
}

export function installWakeShortcut(wake: () => void): () => void {
  const handlers = wakeModifierHandlers(wake);
  window.addEventListener('keydown', handlers.keydown, true);
  window.addEventListener('keyup', handlers.keyup, true);
  return () => {
    window.removeEventListener('keydown', handlers.keydown, true);
    window.removeEventListener('keyup', handlers.keyup, true);
  };
}
