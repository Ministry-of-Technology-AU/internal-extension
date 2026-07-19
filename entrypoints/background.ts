import {
  applyProgress,
  cancelSync,
  getRun,
  getWarnings,
  restore,
  retrySource,
  startSync,
} from '@/sync/orchestrator';
import type { PopupMessage } from '@/sync/types';

export default defineBackground(() => {
  void restore();

  browser.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
    const msg = message as
      | PopupMessage
      | { type: 'sync:progress'; progress: any }
      | { type: 'sync:heartbeat' };

    switch (msg.type) {
      case 'sync:progress':
        applyProgress(msg.progress);
        return false;

      case 'sync:heartbeat':
        return false;

      case 'sync:getState':
        sendResponse({ run: getRun(), warnings: getWarnings() });
        return false;

      case 'sync:start':
        // Deliberately not awaited: the run outlives this message, and the
        // popup only needs to know it was accepted.
        startSync(msg.scheduleId).catch((err) => console.error('[sync] start failed', err));
        sendResponse({ ok: true });
        return false;

      case 'sync:retry':
        retrySource(msg.source).catch((err) => console.error('[sync] retry failed', err));
        sendResponse({ ok: true });
        return false;

      case 'sync:cancel':
        cancelSync().catch((err) => console.error('[sync] cancel failed', err));
        sendResponse({ ok: true });
        return false;

      default:
        return false;
    }
  });
});
