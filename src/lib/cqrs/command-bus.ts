import { Command, CommandHandler, CommandContext } from "./types";
import { randomUUID } from "crypto";

/**
 * Command Bus: yazma niyetlerini tekil handler'lara dağıtır.
 * Middleware zinciri (trace, yetki, doğrulama, outbox) komut etrafında
 * LIFO (son eklenen içte) sırayla çalışır.
 */

export type CommandMiddleware = (
  context: CommandContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

export class CommandBus {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly middlewares: CommandMiddleware[] = [];

  register(handler: CommandHandler): void {
    if (this.handlers.has(handler.handles)) {
      throw new Error(`Command handler already registered for: ${handler.handles}`);
    }
    this.handlers.set(handler.handles, handler);
  }

  use(middleware: CommandMiddleware): void {
    this.middlewares.push(middleware);
  }

  async dispatch<C extends Command>(command: C): Promise<unknown> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No command handler registered for: ${command.type}`);
    }

    const traceId = randomUUID();
    const context: CommandContext = { command, traceId };

    let index = this.middlewares.length - 1;
    const run = (): Promise<unknown> => {
      const mw = this.middlewares[index];
      if (!mw) return handler.handle(command);
      const next = () => {
        index -= 1;
        return run();
      };
      return mw(context, next);
    };

    return run();
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }
}

/** Tek uygulama-çapı bus (global singleton). */
export const commandBus = new CommandBus();
