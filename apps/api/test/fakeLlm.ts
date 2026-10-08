import {
  LlmError,
  type ChatJsonRequest,
  type ChatJsonResult,
  type JsonLlm,
} from '../src/llm/ollama';

/** A model that returns canned answers (validated with the real schema), or is down. */
export class FakeLlm implements JsonLlm {
  requests: ChatJsonRequest<unknown>[] = [];
  /** What the fake "hears" in audio, or the error it throws. */
  heard: string | Error = 'nothing';

  constructor(private readonly answer: ((request: ChatJsonRequest<unknown>) => unknown) | null) {}

  async resolveModel() {
    return this.answer ? 'gemma-test' : null;
  }

  async transcribe(chunks: string[]) {
    if (this.heard instanceof Error) throw this.heard;
    return { text: chunks.length > 0 ? this.heard : '', model: 'gemma-test', ms: 5 };
  }

  async chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResult<T>> {
    this.requests.push(request as ChatJsonRequest<unknown>);
    if (!this.answer) throw new LlmError('No Gemma model is available in Ollama.');
    const data = request.schema.parse(this.answer(request as ChatJsonRequest<unknown>));
    return { data, model: 'gemma-test', ms: 12, attempts: 1 };
  }
}
