import { DurableObject } from "cloudflare:workers";

import {
  CodexLogin as CodexLoginState,
  type CodexOutcome,
} from "@/lib/llm/codex-login.server";

export class CodexLogin extends DurableObject<Record<string, unknown>> {
  #login = new CodexLoginState({
    storage: this.ctx.storage,
    seed: () => this.env["CODEX_LOGIN_SEED"] as string | undefined,
  });

  lease() {
    return this.#login.lease();
  }

  report(token: string, outcome: CodexOutcome) {
    return this.#login.report(token, outcome);
  }
}
