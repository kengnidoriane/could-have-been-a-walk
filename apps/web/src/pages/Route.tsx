import {
  agendaHeuristic,
  buildCheckpoints,
  DEFAULT_SPEED_KMH,
  GENTLE_SPEED_KMH,
  makeRoute,
  pointAt,
} from '@cbaw/core';
import { useEffect, useMemo, useState } from 'react';
import { AgendaTimeline } from '../components/AgendaTimeline';
import { Header } from '../components/Header';
import { MapView, type MapPin } from '../components/MapView';
import { QRHandoff } from '../components/QRHandoff';
import { ApiError, fetchAgenda, fetchLoop } from '../lib/api';
import { formatKm, formatMinutes, formatRange, relativeDay } from '../lib/format';
import { prettyModel } from '../lib/health';
import { setPreferences, usePreferences } from '../lib/office';
import { navigate, paths } from '../lib/router';
import { setScoringPaused } from '../lib/scoring';
import { planKey, saveAgenda, savePlan, useAppState } from '../lib/store';
import { buildWalkUrl, downloadInvite, toWalkPlan } from '../lib/walkLink';

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

const LOADING_LINES = [
  'Asking OpenStreetMap for a loop that fits…',
  'Steering away from the ocean…',
  'Trimming dead-end alleys…',
  'The volunteer routing server takes one request per second. Worth the wait.',
];

function LoadingLines() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % LOADING_LINES.length), 2600);
    return () => clearInterval(id);
  }, []);
  return (
    <p className="loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" /> {LOADING_LINES[i]}
    </p>
  );
}

export function RoutePage({ meetingId }: { meetingId: string }) {
  const meeting = useAppState((s) => s.meetings.find((m) => m.id === meetingId));
  const plan = useAppState((s) => s.plans[meetingId]);
  const { office, speedKmh } = usePreferences();
  const [seed, setSeed] = useState(() => plan?.seed ?? randomSeed());
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setScoringPaused(true);
    return () => setScoringPaused(false);
  }, []);

  const requestKey = `${seed}|${speedKmh}|${office.lat},${office.lon}|${attempt}`;
  const planIsCurrent =
    !!plan &&
    plan.seed === seed &&
    plan.speedKmh === speedKmh &&
    plan.start.lat === office.lat &&
    plan.start.lon === office.lon;
  const error = failure?.key === requestKey ? failure.message : null;
  const loading = !planIsCurrent && !error;

  useEffect(() => {
    if (!meeting || planIsCurrent) return;
    const controller = new AbortController();
    fetchLoop({ start: office, minutes: meeting.durationMin, speedKmh, seed }, controller.signal)
      .then((loop) => savePlan(meeting.id, { loop, start: office, seed, speedKmh }))
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setFailure({
          key: requestKey,
          message: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
        });
      });
    return () => controller.abort();
  }, [meeting, office, speedKmh, seed, planIsCurrent, requestKey]);

  const loop = planIsCurrent ? plan.loop : null;
  const agenda = useAppState((s) => s.agendas[meetingId]);
  const agendaIsCurrent = !!agenda && planIsCurrent && agenda.planKey === planKey(plan);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  // Once the loop is known, ask Gemma to pin the agenda along it.
  useEffect(() => {
    if (!meeting || !planIsCurrent || agendaIsCurrent) return;
    const controller = new AbortController();
    const key = planKey(plan);
    fetchAgenda(meeting, plan.loop, controller.signal)
      .then((a) =>
        saveAgenda(meeting.id, {
          planKey: key,
          segments: a.segments,
          source: a.source,
          model: a.model,
        }),
      )
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        const segments = agendaHeuristic(meeting, buildCheckpoints(plan.loop));
        saveAgenda(meeting.id, { planKey: key, segments, source: 'heuristic' });
      });
    return () => controller.abort();
  }, [meeting, plan, planIsCurrent, agendaIsCurrent]);

  const route = useMemo(() => (loop ? makeRoute(loop.points) : null), [loop]);
  // The walk link carries everything the phone needs; rebuilt when the plan or agenda changes.
  const [walkUrl, setWalkUrl] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (!meeting || !loop || !agendaIsCurrent) {
      setWalkUrl(null);
      return;
    }
    let alive = true;
    void buildWalkUrl(toWalkPlan(meeting, loop, agenda.segments, office)).then(
      (url) => alive && setWalkUrl(url),
    );
    return () => {
      alive = false;
    };
  }, [meeting, loop, agenda, agendaIsCurrent, office]);

  const pins = useMemo<MapPin[]>(() => {
    if (!route || !loop || !agendaIsCurrent) return [];
    // Agenda distances use the router's metres; the drawn polyline may differ by a hair.
    const scale = route.length / loop.distanceM;
    return agenda.segments.map((segment, i) => ({
      label: String(i + 1),
      title: `${i + 1}. ${segment.topic}`,
      point: pointAt(route, ((segment.startAlong + segment.endAlong) / 2) * scale),
      active: activeSegment === i,
    }));
  }, [route, loop, agenda, agendaIsCurrent, activeSegment]);

  if (!meeting) {
    return (
      <>
        <Header />
        <main className="page">
          <h1>Meeting not found</h1>
          <p className="muted">Your calendar is only kept for this browser session.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate(paths.plan())}>
            Back to my meetings
          </button>
        </main>
      </>
    );
  }

  const spareMin = loop ? Math.max(0, Math.round(meeting.durationMin - loop.durationMin)) : 0;
  const mostlyOutAndBack = loop && loop.overlapRatio > 0.5;

  return (
    <>
      <Header />
      <main className="page page-route">
        <div className="route-map">
          <MapView
            start={office}
            loop={loop?.points}
            landmarks={loop?.landmarks}
            pins={pins}
            onPick={
              picking
                ? (p) => {
                    setPreferences({ office: { ...p, label: 'Custom start' } });
                    setPicking(false);
                  }
                : undefined
            }
            fitKey={loop ? `${meetingId}:${seed}:${loop.distanceM}` : `${office.lat},${office.lon}`}
          />
          {picking && (
            <p className="map-hint">Click the map where the walk should start and end.</p>
          )}
        </div>

        <aside className="route-panel">
          <button type="button" className="link-back" onClick={() => navigate(paths.plan())}>
            ← All meetings
          </button>
          <p className="eyebrow">
            {relativeDay(meeting.start)} · {formatRange(meeting.start, meeting.end)}
          </p>
          <h1 className="route-title">{meeting.title}</h1>

          <section className="summary" aria-live="polite">
            {loading && <LoadingLines />}
            {error && (
              <div role="alert">
                <p className="error">{error}</p>
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Try again
                </button>
              </div>
            )}
            {loop && !loading && (
              <>
                <p className="summary-big">
                  <strong>{formatMinutes(loop.durationMin)}</strong> loop for a{' '}
                  {formatMinutes(meeting.durationMin)} meeting
                </p>
                <p className="muted">
                  {formatKm(loop.distanceM)} at {speedKmh} km/h · back {spareMin} min before the end
                </p>
                {mostlyOutAndBack && (
                  <p className="note">
                    Mostly out-and-back: few through streets around here. Try another loop, or move
                    the start onto a main road.
                  </p>
                )}
              </>
            )}
          </section>

          {loop && (
            <section className="agenda-wrap" aria-labelledby="agenda-title">
              <h2 id="agenda-title" className="section-title">
                Agenda along the way
              </h2>
              {agendaIsCurrent ? (
                <>
                  <AgendaTimeline
                    segments={agenda.segments}
                    active={activeSegment}
                    onActive={setActiveSegment}
                  />
                  <p className="source-note">
                    {agenda.source === 'gemma' && agenda.model
                      ? `Pinned to the route by ${prettyModel(agenda.model)}, on this computer.`
                      : 'Pinned by the fallback rules: Gemma was not available.'}
                  </p>
                </>
              ) : (
                <p className="loading" role="status">
                  <span className="spinner" aria-hidden="true" /> Gemma is pinning the agenda to the
                  route…
                </p>
              )}
            </section>
          )}

          <section className="controls" aria-label="Loop settings">
            <div className="control">
              <span className="control-label">Start &amp; finish</span>
              <span className="control-value">{office.label}</span>
              <div className="row">
                <button
                  type="button"
                  className={`btn btn-small ${picking ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPicking((p) => !p)}
                  aria-pressed={picking}
                >
                  {picking ? 'Click the map…' : 'Move start'}
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={() =>
                    navigator.geolocation?.getCurrentPosition(
                      (pos) =>
                        setPreferences({
                          office: {
                            lat: pos.coords.latitude,
                            lon: pos.coords.longitude,
                            label: 'My location',
                          },
                        }),
                      () =>
                        setFailure({
                          key: requestKey,
                          message: "Couldn't get your location. Click the map instead.",
                        }),
                    )
                  }
                >
                  Use my location
                </button>
              </div>
            </div>

            <div className="control">
              <span className="control-label" id="pace-label">
                Pace
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="pace-label">
                {[
                  { kmh: DEFAULT_SPEED_KMH, label: 'Brisk' },
                  { kmh: GENTLE_SPEED_KMH, label: 'Gentle' },
                ].map((o) => (
                  <button
                    key={o.kmh}
                    type="button"
                    role="radio"
                    aria-checked={speedKmh === o.kmh}
                    className={speedKmh === o.kmh ? 'is-on' : ''}
                    onClick={() => setPreferences({ speedKmh: o.kmh })}
                  >
                    {o.label} <small>{o.kmh} km/h</small>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <p className="recap-link">
            Back from the walk?{' '}
            <a href={`#${paths.recap(meeting.id)}`}>Record a 1-minute recap →</a>
          </p>

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!walkUrl}
              onClick={() => setShowQr(true)}
            >
              Send to phone (QR)
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!walkUrl || !loop || !agendaIsCurrent}
              onClick={() =>
                walkUrl &&
                loop &&
                agendaIsCurrent &&
                downloadInvite(meeting, loop, agenda.segments, office, walkUrl)
              }
            >
              Export invite (.ics)
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading}
              onClick={() => setSeed(randomSeed())}
            >
              ↻ Another loop
            </button>
          </div>
        </aside>
      </main>
      {showQr && walkUrl && <QRHandoff url={walkUrl} onClose={() => setShowQr(false)} />}
    </>
  );
}
