import {
  getServerByName,
  routePartykitRequest,
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import ArenaServer from "./arena";

/**
 * Cloudflare Durable Object entrypoint powered by `partyserver`.
 * Wraps `ArenaServer` so existing room logic and Vitest parity tests stay intact.
 */
export class Arena extends Server {
  static options = {
    hibernate: false,
  };

  private engine: ArenaServer | null = null;

  private getEngine(): ArenaServer {
    if (!this.engine) {
      const env = this.env;
      const roomAdapter = {
        id: this.name,
        env,
        storage: this.ctx.storage,
        broadcast: (msg: string, without?: string[]) => {
          this.broadcast(msg, without);
        },
        getConnections: () => this.getConnections(),
        context: {
          parties: {
            arena: {
              get: (name: string) => ({
                fetch: async (init: RequestInit) => {
                  const stub = await getServerByName(env.Arena, name);
                  return stub.fetch(
                    `https://internal/parties/arena/${encodeURIComponent(name)}`,
                    init,
                  );
                },
              }),
            },
          },
        },
      };
      this.engine = new ArenaServer(roomAdapter as unknown as ConstructorParameters<typeof ArenaServer>[0]);
    }
    return this.engine;
  }

  async onStart(): Promise<void> {
    await this.getEngine().onStart();
  }

  async onAlarm(): Promise<void> {
    await this.getEngine().onAlarm();
  }

  onConnect(conn: Connection, _ctx: ConnectionContext): void {
    this.getEngine().onConnect(conn as unknown as Parameters<ArenaServer["onConnect"]>[0]);
  }

  onClose(conn: Connection): void {
    this.getEngine().onClose(conn as unknown as Parameters<ArenaServer["onClose"]>[0]);
  }

  async onMessage(conn: Connection, message: WSMessage): Promise<void> {
    const text =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(message);
    await this.getEngine().onMessage(
      text,
      conn as unknown as Parameters<ArenaServer["onMessage"]>[1],
    );
  }

  async onRequest(request: Request): Promise<Response> {
    return this.getEngine().onRequest(
      request as unknown as Parameters<ArenaServer["onRequest"]>[0],
    );
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const response = await routePartykitRequest(request, env, {
      cors: true,
    });
    if (response) return response;
    return new Response("Not Found", { status: 404 });
  },
};
