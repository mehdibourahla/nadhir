declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export abstract class DurableObject<Env = unknown> {
    protected ctx: {
      storage: {
        get<T>(key: string): Promise<T | undefined>;
        put(key: string, value: unknown): Promise<void>;
      };
    };
    protected env: Env;
    constructor(ctx: unknown, env: Env);
  }
}
