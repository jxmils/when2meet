/**
 * Runs inside the When2meet page's own JavaScript world, where its globals (TimeOfSlot,
 * AvailableAtSlot, UserID, SelectStop, …) are visible. Injected by the content script.
 */
import { bitsForPerson } from '@w2msync/core';
import { executeSave, parseEventHtml } from '@w2msync/when2meet';
import {
  createPageDriver,
  type PageWindow,
  readPageState,
  signInOnPage,
} from '@w2msync/when2meet/page';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { servePage } from '../lib/page-bridge.ts';

export default defineUnlistedScript(() => {
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-w2msync-channel]');
  const channel = script?.dataset.w2msyncChannel;
  if (!channel) return;
  const win = window as PageWindow;

  servePage(channel, {
    read: () => readPageState(win),

    signIn: ({ name, password }) => signInOnPage(win, name, password),

    async serverState({ personId }) {
      const response = await win.fetch(win.location.pathname + win.location.search, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(`Reloading the poll failed (HTTP ${response.status}).`);
      const poll = parseEventHtml(await response.text());
      return {
        slots: poll.slots,
        bits: bitsForPerson(poll.availableAt, personId),
        availableAt: poll.availableAt,
        people: poll.people,
      };
    },

    save: (options) => executeSave(createPageDriver(win, options.personId), options),

    resync: ({ personId, bits }) => createPageDriver(win, personId).resync(bits),
  });
});
