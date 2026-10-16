export class LlmUnavailable extends Error {
  override name = "LlmUnavailable";
}

// account, quota and provider faults say nothing about the document being read
export function llmHttpError(message: string, status: number): Error {
  return status === 401 || status === 402 || status === 429 || status >= 500
    ? new LlmUnavailable(message)
    : new Error(message);
}
