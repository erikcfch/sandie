import { defineConfig } from 'vite';

// GitHub Pages serves a project site (not a user/org site) from
// https://<user>.github.io/<repo>/, so assets need that repo-name prefix -
// set only by the Pages deploy workflow (see .github/workflows/deploy.yml),
// not during local dev/build.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
});
