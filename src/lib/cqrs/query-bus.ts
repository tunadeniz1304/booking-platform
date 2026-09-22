import { Query, QueryHandler } from "./types";
import { randomUUID } from "crypto";

/** Query Bus: salt-okuma read-model sorgularını dağıtır. Yan etkisiz. */

export class QueryBus {
  private readonly handlers = new Map<string, QueryHandler>();

  register(handler: QueryHandler): void {
    if (this.handlers.has(handler.handles)) {
      throw new Error(`Query handler already registered for: ${handler.handles}`);
    }
    this.handlers.set(handler.handles, handler);
  }

  async ask<Q extends Query>(query: Q): Promise<unknown> {
    const handler = this.handlers.get(query.type);
    if (!handler) {
      throw new Error(`No query handler registered for: ${query.type}`);
    }
    return handler.handle(query);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

export const queryBus = new QueryBus();
export type { QueryHandler } from "./types";
