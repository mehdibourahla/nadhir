import { DurableObject } from "cloudflare:workers";

import { CodexLogin as CodexLoginState } from "@/lib/llm/codex-login.server";

export class CodexLogin extends DurableObject<Record<string, unknown>> {
  #login = new CodexLoginState({
    storage: this.ctx.storage,
    seed: () => this.env["CODEX_LOGIN_SEED"] as string | undefined,
  });

  lease() {
    return this.#login.lease();
  }

  pause(seconds: number) {
    return this.#login.pause(seconds);
  }

  expire(token: string) {
    return this.#login.expire(token);
  }
}
