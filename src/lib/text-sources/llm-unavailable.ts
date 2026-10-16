export class LlmUnavailable extends Error {
  override name = "LlmUnavailable";
}

// account, quota and provider faults say nothing about the document being read
export function llmHttpError(message: string, status: number): Error {
  return status === 401 || status === 402 || status === 429 || status >= 500
    ? new LlmUnavailable(message)
    : new Error(message);
}

// fetch rejects with a TypeError only when the connection itself fails; a timeout stays the document's
export function llmFetchError(error: unknown): never {
  if (error instanceof TypeError)
    throw new LlmUnavailable(`LLM provider unreachable: ${error.message}`);
  throw error;
}
