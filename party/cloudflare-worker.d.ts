/**
 * Minimal Cloudflare Durable Objects & Worker ambient declarations for `tsc --noEmit`.
 * Avoids redeclaring global Fetch/WebSocket/EventTarget DOM interfaces from `worker-configuration.d.ts`
 * that conflict with Next.js `lib.dom.d.ts`.
 */

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  put<T = unknown>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: {
    start?: string;
    startAfter?: string;
    end?: string;
    prefix?: string;
    reverse?: boolean;
    limit?: number;
  }): Promise<Map<string, T>>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectId {
  readonly name?: string;
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

interface DurableObjectState<Props = Record<string, unknown>> {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  readonly props: Props;
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

type DurableObjectJurisdiction = string;
type DurableObjectLocationHint = string;

interface DurableObjectStub<T = unknown> {
  readonly id: DurableObjectId;
  readonly name?: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace<T = unknown> {
  newUniqueId(): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
  getByName(name: string): DurableObjectStub<T>;
}

declare module "cloudflare:workers" {
  export abstract class DurableObject<
    Env = Cloudflare.Env,
    Props = Record<string, unknown>,
  > {
    protected ctx: DurableObjectState<Props>;
    protected env: Env;
    constructor(ctx: DurableObjectState<Props>, env: Env);
  }
}

declare namespace Cloudflare {
  interface Env {
    Arena: DurableObjectNamespace<import("./worker").Arena>;
    NEXT_PUBLIC_SITE_URL?: string;
    NEXT_PUBLIC_APP_URL?: string;
    ALLOWED_ORIGINS?: string;
    PARTYKIT_INTERNAL_SECRET?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    NODE_ENV?: string;
    [key: string]: unknown;
  }
}
