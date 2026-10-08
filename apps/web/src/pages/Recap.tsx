import { recapToText, type Recap } from '@cbaw/core';
import { useEffect, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { fetchRecap } from '../lib/api';
import { startRecording, toWavChunks } from '../lib/audio';
import { prettyModel } from '../lib/health';
import { navigate, paths } from '../lib/router';
import { useAppState } from '../lib/store';

const MAX_SECONDS = 180;

type Phase =
  | { name: 'idle' }
  | { name: 'recording'; since: number }
  | { name: 'working'; step: string }
  | { name: 'done'; recap: Recap; transcript: string; by: string }
  | { name: 'error'; message: string };

export function RecapPage({ meetingId }: { meetingId: string }) {
  const meeting = useAppState((s) => s.meetings.find((m) => m.id === meetingId));
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const recorder = useRef<ReturnType<typeof startRecording> | null>(null);
  const title = meeting?.title ?? 'Walking meeting';

  useEffect(() => {
    if (phase.name !== 'recording') return;
    const id = setInterval(() => {
      const s = Math.round((Date.now() - phase.since) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stop() only reads refs
  }, [phase]);

  const summarize = async (audio?: string[]) => {
    setPhase({ name: 'working', step: audio ? 'Gemma is listening…' : 'Gemma is reading…' });
    try {
      const result = await fetchRecap({ consent: true, title, notes, audio });
      const by = [
        result.transcribedBy ? `Heard by ${prettyModel(result.transcribedBy)}` : null,
        result.source === 'gemma' && result.model
          ? `summarized by ${prettyModel(result.model)}`
          : 'summarized by the fallback rules',
      ]
        .filter(Boolean)
        .join(', ');
      setPhase({ name: 'done', recap: result.recap, transcript: result.transcript, by });
    } catch (err) {
      setPhase({ name: 'error', message: (err as Error).message });
    }
  };

  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder.current = startRecording(stream);
      setSeconds(0);
      setPhase({ name: 'recording', since: Date.now() });
    } catch {
      setPhase({
        name: 'error',
        message: "Couldn't use the microphone. You can type notes instead.",
      });
    }
  };

  const stop = async () => {
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setPhase({ name: 'working', step: 'Preparing the audio…' });
    const audio = await toWavChunks(await r.stop());
    await summarize(audio);
  };

  return (
    <>
      <Header />
      <main className="page recap">
        <button
          type="button"
          className="link-back"
          onClick={() => navigate(meeting ? paths.route(meeting.id) : paths.plan())}
        >
          ← Back to the walk
        </button>
        <p className="eyebrow">Back at your desk</p>
        <h1>Recap: {title}</h1>
        <p className="lede">
          One minute of talking, and Gemma writes down the decisions, the action items and who owns
          them.
        </p>

        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            <strong>Everyone on this walk agreed</strong> to this recap being recorded or written
            down.
          </span>
        </label>

        <section className="recap-input" aria-label="Recap input">
          <div className="recorder">
            {phase.name === 'recording' ? (
              <button
                type="button"
                className="btn btn-primary btn-big rec-on"
                onClick={() => void stop()}
              >
                ■ Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={!consent || phase.name === 'working'}
                onClick={() => void record()}
              >
                ● Record a voice memo
              </button>
            )}
            <p className="muted small">
              Up to 3 minutes. Needs a Gemma model that can hear (Gemma 4 E2B/E4B).
            </p>
          </div>
          <div className="or" aria-hidden="true">
            or
          </div>
          <div className="notes">
            <label htmlFor="notes" className="control-label">
              Type or paste notes
            </label>
            <textarea
              id="notes"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="We decided to fund the community program. Kofi will draft the budget by Friday…"
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={
                !consent || !notes.trim() || phase.name === 'working' || phase.name === 'recording'
              }
              onClick={() => void summarize()}
            >
              Summarize these notes
            </button>
          </div>
        </section>

        <p className="privacy-note">
          🔒 The recording goes to Gemma on this computer, and nowhere else. Nothing is saved.
        </p>

        {phase.name === 'working' && (
          <p className="loading" role="status">
            <span className="spinner" aria-hidden="true" /> {phase.step}
          </p>
        )}
        {phase.name === 'error' && (
          <p className="error" role="alert">
            {phase.message}
          </p>
        )}
        {phase.name === 'done' && (
          <section className="recap-result" aria-live="polite">
            <p className="summary-big">{phase.recap.summary || 'No summary.'}</p>
            <div className="recap-cols">
              <div>
                <h2 className="section-title">Decisions</h2>
                {phase.recap.decisions.length > 0 ? (
                  <ul>
                    {phase.recap.decisions.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">None recorded.</p>
                )}
              </div>
              <div>
                <h2 className="section-title">Action items</h2>
                {phase.recap.actions.length > 0 ? (
                  <ul className="actions-list">
                    {phase.recap.actions.map((a) => (
                      <li key={a.task}>
                        <span>{a.task}</span>
                        <span className="owner">
                          {a.owner}
                          {a.due ? ` · ${a.due}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">None recorded.</p>
                )}
              </div>
            </div>
            <p className="source-note">{phase.by}, on this computer.</p>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(recapToText(title, phase.recap))
                  .then(() => setCopied(true))
              }
            >
              {copied ? 'Copied ✓' : 'Copy recap'}
            </button>
            {phase.transcript && (
              <details className="transcript">
                <summary>What Gemma worked from</summary>
                <p>{phase.transcript}</p>
              </details>
            )}
          </section>
        )}
      </main>
    </>
  );
}
