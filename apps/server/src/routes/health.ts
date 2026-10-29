import { sendJson } from '../http';
import type { Router } from '../router';
import { VERSION } from '../version';

/** What the app reads to find out that a server is there, and which parts it offers. */
export interface Health {
  ok: true;
  /** A fixed marker, so that a page that answers every path with HTML is not taken for a server. */
  app: 'petri-net-modeling';
  version: string;
  /** The name that the app shows in its status bar. */
  name: string;
  features: { api: boolean; projects: boolean; llm: boolean; auth: boolean };
  llm: { models: string[]; defaultModel: string | null };
}

export function registerHealth(router: Router): void {
  router.get(
    '/api/health',
    (ctx) => {
      const { config } = ctx;
      const body: Health = {
        ok: true,
        app: 'petri-net-modeling',
        version: VERSION,
        name: config.serverName,
        features: {
          api: true,
          projects: true,
          llm: config.llm.baseUrl !== null,
          auth: config.basicAuth.length > 0,
        },
        llm: { models: config.llm.models, defaultModel: config.llm.defaultModel },
      };
      sendJson(ctx.res, 200, body);
    },
    { open: true, summary: 'Health check and the features of this server' },
  );
}
