import type { ScraperProgress } from '@/sync/types';

/**
 * Bridge between injected scrapers (MAIN world, can't reach extension APIs) and
 * the background worker. Also heartbeats while a scrape is active so the worker
 * is not torn down during a long quiet stretch between progress reports.
 */
export default defineContentScript({
  matches: [
    'https://ams.ashoka.edu.in/Contents/ContentManagement/ViewCourseCatalogue.aspx*',
    'https://ams.ashoka.edu.in/Contents/CourseManagement/CoursePreRequisites_View.aspx*',
    'https://ams.ashoka.edu.in/Contents/TimeTable/TimeTablePreferenceView.aspx*',
  ],
  main() {
    let lastSeen = 0;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const stopHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = undefined;
      }
    };

    const startHeartbeat = () => {
      if (heartbeat) return;
      heartbeat = setInterval(() => {
        // Stop once the scrape has been quiet for a while — either it finished
        // or the tab is about to be closed by the orchestrator.
        if (Date.now() - lastSeen > 60_000) return stopHeartbeat();
        browser.runtime.sendMessage({ type: 'sync:heartbeat' }).catch(() => stopHeartbeat());
      }, 20_000);
    };

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data as ScraperProgress | undefined;
      if (!data || data.__amsSync !== true) return;

      lastSeen = Date.now();
      startHeartbeat();
      browser.runtime.sendMessage({ type: 'sync:progress', progress: data }).catch(() => {});
    });
  },
});
