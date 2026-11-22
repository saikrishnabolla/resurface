import { createHandler } from '../api/resurface.mjs';

export function resurfaceApi({ apiKey }) {
  const handler = createHandler({ getApiKey: () => apiKey });
  function setup(server) {
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url ?? '/', 'http://resurface.invalid').pathname;
      if (path === '/api/accounts' || path === '/api/discover') return handler(req, res);
      next();
    });
  }
  return { name: 'resurface-api', configureServer: setup, configurePreviewServer: setup };
}
