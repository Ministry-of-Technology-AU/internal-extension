import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  manifest: {
    name: "Techmin - Internal Tool",
    description: "An internal tool made by Techmin for Techmin to assist with various internal workings, and neat features!",
    version: "1.0.0",
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
  webExt: {
    disabled: true,
  }
});
