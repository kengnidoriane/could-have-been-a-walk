import {
  LlmError,
  type ChatJsonRequest,
  type ChatJsonResult,
  type JsonLlm,
} from '../src/llm/ollama';

/** A model that returns canned answers (validated with the real schema), or is down. */
export class FakeLlm implements JsonLlm {
  requests: ChatJsonRequest<unknown>[] = [];

  constructor(private readonly answer: ((request: ChatJsonRequest<unknown>) => unknown) | null) {}

  async resolveModel() {
    return this.answer ? 'gemma-test' : null;
  }

  async chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResult<T>> {
    this.requests.push(request as ChatJsonRequest<unknown>);
    if (!this.answer) throw new LlmError('No Gemma model is available in Ollama.');
    const data = request.schema.parse(this.answer(request as ChatJsonRequest<unknown>));
    return { data, model: 'gemma-test', ms: 12, attempts: 1 };
  }
}
