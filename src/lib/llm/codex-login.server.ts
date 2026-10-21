import {
  CodexUnavailable,
  OAUTH_CLIENT_ID,
  OAUTH_TOKEN_URL,
  pauseFor,
} from "./codex.server";

const REFRESH_MARGIN_MS = 300_000;
const KEY = "login";

export type LoginStorage = {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
};

export type Lease =
  | { status: "ready"; token: string; account: string }
  | { status: "paused" }
  | { status: "unavailable"; reason: string; pausedSeconds: number };

type LoginRecord = {
  refresh_token: string;
  access_token?: string;
  id_token?: string;
  account_id?: string;
};

type State = {
  record?: LoginRecord;
  seed?: string;
  pausedUntil: number;
  stale: boolean;
};

function claims(token: string | undefined): Record<string, unknown> {
  try {
    const part = token!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(
      atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), "=")),
    );
  } catch {
    return {};
  }
}

function accountOf(token: string | undefined): string | undefined {
  const auth = claims(token)["https://api.openai.com/auth"] as
    { chatgpt_account_id?: string } | undefined;
  return auth?.chatgpt_account_id;
}

async function fingerprint(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSeed(seed: string): LoginRecord | null {
  try {
    const value = JSON.parse(seed) as Partial<LoginRecord>;
    return typeof value.refresh_token === "string" && value.refresh_token
      ? (value as LoginRecord)
      : null;
  } catch {
    return null;
  }
}

// one instance owns the rotating refresh token: two writers of one grant race and kill the login
export class CodexLogin {
  #storage: LoginStorage;
  #seed: () => string | undefined;
  #now: () => number;
  #state: Promise<State> | null = null;
  #refreshing: Promise<Lease> | null = null;

  constructor(deps: {
    storage: LoginStorage;
    seed: () => string | undefined;
    now?: () => number;
  }) {
    this.#storage = deps.storage;
    this.#seed = deps.seed;
    this.#now = deps.now ?? Date.now;
  }

  async lease(): Promise<Lease> {
    const state = await this.#load();
    const seed = this.#seed();
    if (seed) {
      const print = await fingerprint(seed);
      if (print !== state.seed) {
        const record = parseSeed(seed);
        state.seed = print;
        if (!record) return this.#fail(state, "login_seed_invalid");
        state.record = record;
        state.stale = false;
        state.pausedUntil = 0;
        await this.#save(state);
      }
    }
    if (this.#now() < state.pausedUntil) return { status: "paused" };
    if (!state.record) return this.#fail(state, "login_missing");
    if (!state.stale && this.#fresh(state.record))
      return this.#ready(state, state.record);
    this.#refreshing ??= this.#refresh(state).finally(() => {
      this.#refreshing = null;
    });
    return this.#refreshing;
  }

  async pause(seconds: number): Promise<void> {
    const state = await this.#load();
    state.pausedUntil = Math.max(
      state.pausedUntil,
      this.#now() + seconds * 1000,
    );
    await this.#save(state);
  }

  async expire(token: string): Promise<void> {
    const state = await this.#load();
    if (state.record?.access_token !== token) return;
    state.stale = true;
    await this.#save(state);
  }

  #load(): Promise<State> {
    this.#state ??= this.#storage
      .get<State>(KEY)
      .then((state) => state ?? { pausedUntil: 0, stale: false });
    return this.#state;
  }

  #save(state: State): Promise<void> {
    return this.#storage.put(KEY, state);
  }

  #fresh(record: LoginRecord): boolean {
    const exp = claims(record.access_token)["exp"];
    return (
      typeof exp === "number" && exp * 1000 - this.#now() > REFRESH_MARGIN_MS
    );
  }

  async #ready(state: State, record: LoginRecord): Promise<Lease> {
    const account =
      record.account_id ??
      accountOf(record.id_token) ??
      accountOf(record.access_token);
    if (!account || !record.access_token)
      return this.#fail(state, "login_account_missing");
    return { status: "ready", token: record.access_token, account };
  }

  async #fail(state: State, reason: string): Promise<Lease> {
    const pausedSeconds = pauseFor(
      new CodexUnavailable(reason, { sent: false }),
    );
    state.pausedUntil = Math.max(
      state.pausedUntil,
      this.#now() + pausedSeconds * 1000,
    );
    await this.#save(state);
    return { status: "unavailable", reason, pausedSeconds };
  }

  async #refresh(state: State): Promise<Lease> {
    const record = state.record!;
    let res: Response;
    try {
      res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: OAUTH_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: record.refresh_token,
          scope: "openid profile email",
        }),
      });
    } catch {
      return this.#fail(state, "refresh_network");
    }
    if (res.status !== 200) {
      await res.body?.cancel();
      return this.#fail(state, `refresh_http_${res.status}`);
    }
    let data: {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
    };
    try {
      data = await res.json();
    } catch {
      return this.#fail(state, "refresh_malformed");
    }
    if (!data.access_token) return this.#fail(state, "refresh_malformed");
    const refreshed: LoginRecord = {
      ...record,
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? record.refresh_token,
      ...(data.id_token ? { id_token: data.id_token } : {}),
    };
    state.record = refreshed;
    state.stale = false;
    await this.#save(state);
    return this.#ready(state, refreshed);
  }
}
