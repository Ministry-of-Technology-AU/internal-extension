import { useCallback, useEffect, useState } from 'react';
import type { PopupMessage, SourceId, SyncRun } from '@/sync/types';

type Warnings = Partial<Record<SourceId, string[]>>;

const send = (msg: PopupMessage) => browser.runtime.sendMessage(msg);

/**
 * The popup is destroyed whenever it loses focus, so it holds no run state of
 * its own — it reads the background worker's state on mount and then follows
 * broadcasts. Closing and reopening mid-sync is a no-op.
 */
export function useSyncRun() {
  const [run, setRun] = useState<SyncRun | null>(null);
  const [warnings, setWarnings] = useState<Warnings>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    send({ type: 'sync:getState' })
      .then((res: any) => {
        if (!active) return;
        setRun(res?.run ?? null);
        setWarnings(res?.warnings ?? {});
      })
      .catch(() => {})
      .finally(() => active && setLoaded(true));

    const listener = (message: any) => {
      if (message?.type === 'sync:state') setRun(message.run);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => {
      active = false;
      browser.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const start = useCallback((scheduleId: string) => {
    setRun(null);
    return send({ type: 'sync:start', scheduleId });
  }, []);

  const cancel = useCallback(() => send({ type: 'sync:cancel' }), []);
  const retry = useCallback((source: SourceId) => send({ type: 'sync:retry', source }), []);

  return { run, warnings, loaded, start, cancel, retry };
}
