import { Injectable, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

const ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

interface Route {
  pattern: RegExp;
  method: string;
}

/**
 * Knows every route the controllers declare, so an unmatched request can be told apart:
 * unknown path (404) or known path with the wrong method (405 + Allow).
 */
@Injectable()
export class RouteTable implements OnApplicationBootstrap {
  private readonly routes: Route[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  /** Decorators only wrote metadata; here we read it back, once every module is loaded. */
  onApplicationBootstrap(): void {
    for (const { metatype } of this.discovery.getControllers()) {
      if (typeof metatype !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype) as string;
      const prototype = metatype.prototype as Record<string, object>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (!handler) continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        this.routes.push({ pattern: toPattern(base, path), method: RequestMethod[method] });
      }
    }
  }

  /** The methods declared for a path, in a stable order; empty when no route has this path. */
  allowedMethods(path: string): string[] {
    const methods = new Set(this.routes.filter((r) => r.pattern.test(path)).map((r) => r.method));
    if (methods.has('GET')) methods.add('HEAD');
    return ORDER.filter((m) => methods.has(m));
  }
}

/** ('api/v1', 'workspaces/:workspaceId/members') → /^\/api\/v1\/workspaces\/[^/]+\/members\/?$/ */
function toPattern(base: string, path: string): RegExp {
  const source = [base, path]
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(SPECIAL, '\\$&')))
    .join('/');
  return new RegExp(`^/${source}/?$`);
}
