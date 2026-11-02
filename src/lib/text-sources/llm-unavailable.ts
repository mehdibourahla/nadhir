// the plan, the gateway or the login is down: that says nothing about the document being read
export class LlmUnavailable extends Error {
  override name = "LlmUnavailable";
  readonly retryAfter: number | null;
  constructor(message: string, retryAfter: number | null = null) {
    super(message);
    this.retryAfter = retryAfter;
  }
}
