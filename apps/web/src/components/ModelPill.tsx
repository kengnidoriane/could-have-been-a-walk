import { prettyModel, useModelStatus } from '../lib/health';

/** Says, at all times, which brain is answering: Gemma on this laptop, or the fallback rules. */
export function ModelPill() {
  const status = useModelStatus();

  if (status.state === 'checking') return null;

  if (status.state === 'ready') {
    const upgrade = status.model !== status.preferred;
    return (
      <span
        className="pill pill-ok"
        title={
          upgrade
            ? `Running ${status.model}. Pull ${status.preferred} to use it instead: ollama pull ${status.preferred}`
            : `Running ${status.model} with Ollama, on this computer`
        }
      >
        <span className="dot" aria-hidden="true" /> {prettyModel(status.model)} · on this computer
      </span>
    );
  }

  const text =
    status.state === 'no-model'
      ? `No Gemma model yet: rules only (ollama pull ${status.preferred})`
      : 'Local AI offline: rules only';
  return (
    <span className="pill pill-warn" title={text}>
      <span className="dot" aria-hidden="true" /> {text}
    </span>
  );
}
