import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: [
      'tabs',
      'scripting',
      'storage',
      // Scraped catalogs run to several MB once descriptions are included,
      // which is past the default storage.local quota.
      'unlimitedStorage',
    ],
    host_permissions: ['https://ams.ashoka.edu.in/*'],
  },
});
