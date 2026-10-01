import { defineConfig } from 'wxt';

/**
 * Build-time configuration (set in apps/extension/.env, see .env.example):
 * - WXT_GOOGLE_BROKER_URL   origin of the OAuth broker Worker (enables "Connect Google")
 * - WXT_MICROSOFT_CLIENT_ID Entra application id (enables "Connect Microsoft")
 * - W2M_DEV_HOSTS=1         also run on http://localhost (for the mock When2meet server)
 * - W2M_EXTENSION_KEY       public key that pins the extension id in development builds
 */
const brokerOrigin = originOf(process.env.WXT_GOOGLE_BROKER_URL);
const devHosts = process.env.W2M_DEV_HOSTS === '1';
const POLL_HOSTS = ['https://www.when2meet.com/*', 'https://when2meet.com/*'];

export default defineConfig({
  srcDir: '.',
  vite: () => ({
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    define: { __W2M_DEV_HOSTS__: JSON.stringify(devHosts) },
  }),
  manifest: ({ browser }) => ({
    name: 'Calendar Sync for When2meet',
    short_name: 'W2M Calendar Sync',
    description:
      'Fill your When2meet availability from Google Calendar, Outlook or any calendar link in one click. Unofficial; not affiliated with When2meet.',
    homepage_url: 'https://github.com/jxmils/when2meet',
    permissions: ['storage', 'identity'],
    host_permissions: [
      ...POLL_HOSTS,
      ...(brokerOrigin ? [`${brokerOrigin}/*`] : []),
      ...(devHosts ? ['http://localhost/*'] : []),
    ],
    optional_host_permissions: ['https://*/*'],
    web_accessible_resources: [
      {
        resources: ['page-script.js'],
        matches: [...POLL_HOSTS, ...(devHosts ? ['http://localhost/*'] : [])],
      },
    ],
    action: { default_title: 'Calendar Sync for When2meet settings' },
    ...(process.env.W2M_EXTENSION_KEY ? { key: process.env.W2M_EXTENSION_KEY } : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'calendar-sync@w2msync.org',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (!devHosts) return;
      for (const script of manifest.content_scripts ?? []) {
        script.matches = [...(script.matches ?? []), 'http://localhost/*'];
      }
    },
  },
  zip: {
    artifactTemplate: 'calendar-sync-for-when2meet-{{version}}-{{browser}}.zip',
    sourcesTemplate: 'calendar-sync-for-when2meet-{{version}}-sources.zip',
    sourcesRoot: '../..',
    excludeSources: ['**/node_modules/**', '**/.output/**', '**/.wxt/**', '**/.env', '**/.env.*'],
  },
});

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    throw new Error(`WXT_GOOGLE_BROKER_URL is not a valid URL: ${url}`);
  }
}
