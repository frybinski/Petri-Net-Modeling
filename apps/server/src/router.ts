import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from './config';
import type { Logger } from './logger';

/** What a handler knows about the request. */
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** The path without the query. */
  path: string;
  query: URLSearchParams;
  /** The parts of the path that the pattern named, decoded. */
  params: Record<string, string>;
  /** The address of the client as the filter sees it. */
  client: string;
  config: Config;
  log: Logger;
  /** Set by the handlers for the access log: the part of the answer that is not in the status. */
  note: Record<string, string | number | boolean | undefined>;
  /** Aborted when the client goes away before the answer is complete. */
  signal: AbortSignal;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RouteOptions {
  /**
   * Reachable without the password of `PNM_BASIC_AUTH`: the health check and everything that a
   * share link needs. The client filter still applies.
   */
  open?: boolean;
  /** One line for the documentation of the route. */
  summary?: string;
}

export interface Route {
  method: Method;
  /** The pattern as written, `/api/v1/projects/:id`. */
  pattern: string;
  open: boolean;
  handler: Handler;
  summary: string | undefined;
  match(path: string): Record<string, string> | null;
}

function compile(pattern: string): (path: string) => Record<string, string> | null {
  const names: string[] = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        names.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const expression = new RegExp(`^${source}$`);
  return (path) => {
    const found = expression.exec(path);
    if (!found) return null;
    const params: Record<string, string> = {};
    for (const [index, name] of names.entries()) {
      try {
        params[name] = decodeURIComponent(found[index + 1] ?? '');
      } catch {
        return null;
      }
    }
    return params;
  };
}

export type RouteMatch =
  | { kind: 'found'; route: Route; params: Record<string, string> }
  | { kind: 'method'; allowed: Method[] }
  | { kind: 'none' };

/** A router for exact patterns with `:name` parts. HEAD uses the handler of GET. */
export class Router {
  private readonly list: Route[] = [];

  add(method: Method, pattern: string, handler: Handler, options: RouteOptions = {}): void {
    this.list.push({
      method,
      pattern,
      open: options.open === true,
      handler,
      summary: options.summary,
      match: compile(pattern),
    });
  }

  get(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('GET', pattern, handler, options);
  }
  post(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('POST', pattern, handler, options);
  }
  put(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('PUT', pattern, handler, options);
  }
  delete(pattern: string, handler: Handler, options?: RouteOptions): void {
    this.add('DELETE', pattern, handler, options);
  }

  routes(): readonly Route[] {
    return this.list;
  }

  match(method: string, path: string): RouteMatch {
    const wanted = method === 'HEAD' ? 'GET' : method;
    const allowed = new Set<Method>();
    for (const route of this.list) {
      const params = route.match(path);
      if (params === null) continue;
      if (route.method === wanted) return { kind: 'found', route, params };
      allowed.add(route.method);
    }
    return allowed.size > 0 ? { kind: 'method', allowed: [...allowed] } : { kind: 'none' };
  }
}
