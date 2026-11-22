import {
  getServerByName,
  routePartykitRequest,
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import ArenaServer, { CORS_HEADERS } from "./arena";

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

function getWorkerCorsHeaders(
  request: Request,
  env: Cloudflare.Env,
): HeadersInit | false {
  const reqOrigin = request.headers.get("origin");
  if (!reqOrigin) {
    return false;
  }

  try {
    const parsed = new URL(reqOrigin);
    const envRecord = env as unknown as Record<string, unknown>;
    const allowedOrigins = [
      envRecord.NEXT_PUBLIC_SITE_URL,
      envRecord.NEXT_PUBLIC_APP_URL,
      ...(typeof envRecord.ALLOWED_ORIGINS === "string"
        ? envRecord.ALLOWED_ORIGINS.split(",")
        : []),
    ]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => {
        try {
          return new URL(v.trim()).origin;
        } catch {
          return v.trim();
        }
      });

    const isLocalDev =
      envRecord.NODE_ENV !== "production" &&
      (parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "0.0.0.0");

    if (allowedOrigins.includes(parsed.origin) || isLocalDev) {
      return {
        ...CORS_HEADERS,
        "Access-Control-Allow-Origin": parsed.origin,
        Vary: "Origin",
      };
    }
  } catch {
    // Ignore malformed Origin
  }

  return {
    ...CORS_HEADERS,
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const cors = getWorkerCorsHeaders(request, env);
    const response = await routePartykitRequest(request, env, {
      cors,
    });
    if (response) return response;
    return new Response("Not Found", { status: 404 });
  },
};
