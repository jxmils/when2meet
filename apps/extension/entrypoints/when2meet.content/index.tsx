import './style.css';
import type { PageState } from '@w2msync/when2meet';
import { parseEventRef } from '@w2msync/when2meet';
import { render } from 'preact';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { injectScript } from 'wxt/utils/inject-script';
import { createPageClient, type PageClient } from '../../lib/page-bridge.ts';
import { pruneRecords } from '../../lib/records.ts';
import { Panel } from './Panel.tsx';

export default defineContentScript({
  // Development builds with W2M_DEV_HOSTS=1 also match localhost (added in wxt.config.ts).
  matches: ['https://www.when2meet.com/*', 'https://when2meet.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const pollRef = parseEventRef(location.search);
    if (!pollRef) return;

    const channel = crypto.randomUUID();
    await injectScript('/page-script.js', {
      keepInDom: true,
      modifyScript: (script) => {
        script.dataset.w2msyncChannel = channel;
      },
    });
    const page = createPageClient(channel);
    const initial = await readPage(page);
    if (!initial) return;
    void pruneRecords();

    const ui = await createShadowRootUi(ctx, {
      name: 'w2msync-panel',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      isolateEvents: true,
      onMount(container) {
        render(<Panel page={page} pollRef={pollRef} initial={initial} />, container);
        return container;
      },
      onRemove(container) {
        if (container) render(null, container);
      },
    });
    ui.mount();
  },
});

/** The page script loads asynchronously; ask a few times before giving up. */
async function readPage(page: PageClient): Promise<PageState | null> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      return await page.call('read', undefined, 500);
    } catch {
      // Not listening yet.
    }
  }
  return null;
}
