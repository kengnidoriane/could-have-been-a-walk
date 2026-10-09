import {
  decodeWalkPlan,
  minutesForDistance,
  pointAt,
  segmentIndexAt,
  type AgendaSegment,
  type Route,
  type WalkPlan,
} from '@cbaw/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgendaTimeline } from '../components/AgendaTimeline';
import { Header } from '../components/Header';
import { MapView, type MapPin } from '../components/MapView';
import { WeeklyStat } from '../components/WeeklyStat';
import { formatKm, formatMinutes, formatTime, relativeDay } from '../lib/format';
import { forgetTrack, loadTrack, trackKey } from '../lib/tracks';
import { useWalk, type WalkMode, type WalkView } from '../lib/useWalk';

const toAgenda = (plan: WalkPlan): AgendaSegment[] =>
  plan.segments.map((s) => ({
    ...s,
    startMin: minutesForDistance(s.startAlong, plan.speedKmh),
    endMin: minutesForDistance(s.endAlong, plan.speedKmh),
  }));

function agendaPins(plan: WalkPlan, route: Route, active?: number): MapPin[] {
  return plan.segments.map((s, i) => ({
    label: String(i + 1),
    title: `${i + 1}. ${s.topic}`,
    point: pointAt(route, (s.startAlong + s.endAlong) / 2),
    active: active === i,
  }));
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function WalkPage({ data }: { data: string }) {
  const [plan, setPlan] = useState<WalkPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    decodeWalkPlan(data)
      .then((p) => alive && setPlan(p))
      .catch((err: unknown) => alive && setError((err as Error).message));
    return () => {
      alive = false;
    };
  }, [data]);

  if (error) {
    return (
      <>
        <Header showModel={false} />
        <main className="page walk">
          <h1>This walk link doesn&rsquo;t work</h1>
          <p className="muted">{error} Ask for a fresh QR code from the planner.</p>
        </main>
      </>
    );
  }
  if (!plan) {
    return (
      <main className="page walk">
        <p className="loading">
          <span className="spinner" aria-hidden="true" /> Unpacking the walk…
        </p>
      </main>
    );
  }
  return <WalkScreen plan={plan} trackId={trackKey(data)} />;
}

function WalkScreen({ plan, trackId }: { plan: WalkPlan; trackId: string }) {
  const { view, route, begin, acknowledge, end } = useWalk(plan, trackId);
  if (view.status === 'arrived') return <Arrived plan={plan} view={view} />;
  if (view.status === 'walking') {
    return (
      <Walking plan={plan} route={route} view={view} onEnd={end} onAcknowledge={acknowledge} />
    );
  }
  return <StartScreen plan={plan} route={route} trackId={trackId} onStart={begin} />;
}

function StartScreen({
  plan,
  route,
  trackId,
  onStart,
}: {
  plan: WalkPlan;
  route: Route;
  trackId: string;
  onStart: (mode: WalkMode, speedUp?: number) => void;
}) {
  const [track, setTrack] = useState(() => loadTrack(trackId));
  const agenda = useMemo(() => toAgenda(plan), [plan]);
  const pins = useMemo(() => agendaPins(plan, route), [plan, route]);
  const loopMin = minutesForDistance(route.length, plan.speedKmh);
  const insecure = !window.isSecureContext;

  return (
    <>
      <Header showModel={false} />
      <main className="page walk">
        <p className="eyebrow">{relativeDay(plan.start)} · walking meeting</p>
        <h1 className="walk-title">{plan.title}</h1>
        <p className="backby-small">
          Back by <strong>{formatTime(plan.end)}</strong>
        </p>
        <p className="muted">
          {formatKm(route.length)} loop, about {formatMinutes(loopMin)} at {plan.speedKmh} km/h.
          Start &amp; finish: {plan.startLabel}.
        </p>

        <MapView
          start={plan.route[0]!}
          loop={plan.route}
          pins={pins}
          fitKey="start"
          className="walk-map"
          label="Map of the loop with the agenda"
        />

        {agenda.length > 0 && (
          <>
            <h2 className="section-title">Agenda along the way</h2>
            <AgendaTimeline segments={agenda} />
          </>
        )}

        <div className="walk-start">
          <button type="button" className="btn btn-primary btn-big" onClick={() => onStart('gps')}>
            Start walking
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onStart('demo', 10)}>
            Demo: replay a walk at 10×
          </button>
          {track && (
            <div className="row">
              <button type="button" className="btn btn-ghost" onClick={() => onStart('replay', 10)}>
                Replay my recorded walk at 10×
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  forgetTrack(trackId);
                  setTrack(null);
                }}
              >
                Forget it
              </button>
            </div>
          )}
        </div>
        {insecure && (
          <p className="note">
            This page isn&rsquo;t served over HTTPS, so the phone won&rsquo;t share its location.
            The demo replay still works.
          </p>
        )}
        <WeeklyStat />
        <p className="privacy-note">
          🔒 Your location stays on this phone (the track is kept here so you can replay it). The
          screen stays on while you walk.
        </p>
      </main>
    </>
  );
}

function statusLine(view: WalkView): { text: string; tone: string } {
  const a = view.assessment;
  if (!a) return { text: 'Starting…', tone: 'ok' };
  if (a.decision === 'TURN_BACK_NOW') {
    return {
      text: `Heading back · ${formatKm(a.directM)} to go · back at ${formatTime(a.etaDirect)}`,
      tone: a.lateByMs > 0 ? 'late' : 'back',
    };
  }
  if (a.lateByMs > 60_000) {
    return {
      text: `Running ${formatMinutes(a.lateByMs / 60_000)} late. Pick up the pace.`,
      tone: 'late',
    };
  }
  if (a.willCutShort) {
    return { text: "The full loop won't fit. We'll tell you when to turn back.", tone: 'warn' };
  }
  if (a.decision === 'SUGGEST_EXTENSION') {
    const spare = (a.deadline - a.etaLoop) / 60_000;
    return { text: `Ahead of time: about ${formatMinutes(spare)} to spare. Detour?`, tone: 'good' };
  }
  return { text: `On track · back at ${formatTime(a.etaLoop)}`, tone: 'ok' };
}

function Walking({
  plan,
  route,
  view,
  onEnd,
  onAcknowledge,
}: {
  plan: WalkPlan;
  route: Route;
  view: WalkView;
  onEnd: () => void;
  onAcknowledge: () => void;
}) {
  const a = view.assessment;
  const agenda = useMemo(() => toAgenda(plan), [plan]);
  const turningBack = a?.decision === 'TURN_BACK_NOW';
  // Heading back early means it's time to wrap up: jump to the last topic.
  const index = turningBack
    ? Math.max(0, plan.segments.length - 1)
    : segmentIndexAt(plan.segments, a?.along ?? 0);
  const segment = agenda[index];
  const pins = useMemo(() => agendaPins(plan, route, index), [plan, route, index]);
  const status = statusLine(view);
  const you = a ? { point: a.position } : null;

  return (
    <main className={`walk-live tone-${status.tone}`}>
      <header className="walk-top">
        {view.mode !== 'gps' && (
          <span className="demo-badge">
            {view.mode === 'replay' ? 'Replay' : 'Demo'} ×{view.speedUp}
          </span>
        )}
        <p className="backby">
          Back by <strong>{formatTime(plan.end)}</strong>
        </p>
        <p className="countdown" aria-label="Time left in the meeting">
          {countdown(plan.end - view.now)} left
        </p>
        <p className="walk-status" role="status" aria-live="polite">
          {status.text}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((a?.progress ?? 0) * 100)}
          aria-label="Progress along the loop"
        >
          <span style={{ width: `${Math.min(100, (a?.progress ?? 0) * 100)}%` }} />
          {plan.segments.slice(0, -1).map((s, i) => (
            <i key={i} style={{ left: `${(s.endAlong / route.length) * 100}%` }} />
          ))}
        </div>
      </header>

      {segment && (
        <section className="segment-card" aria-live="polite">
          <p className="segment-when">
            {index + 1} of {agenda.length} ·{' '}
            {index === agenda.length - 1 ? 'on the way back' : `until ${segment.untilLabel}`}
          </p>
          <p className="segment-topic">{segment.topic}</p>
          {segment.prompt && <p className="segment-prompt">{segment.prompt}</p>}
        </section>
      )}

      {view.gpsError && <p className="note walk-note">{view.gpsError}</p>}

      <MapView
        start={plan.route[0]!}
        loop={plan.route}
        walked={view.trail}
        pins={pins}
        returnPath={view.wayBack}
        you={you}
        follow
        fitKey="walk"
        className="walk-map walk-map-live"
        label="Live map"
      />

      <footer className="walk-footer">
        <span>
          {a ? `${(a.paceMps * 3.6).toFixed(1)} km/h` : '–'} · {formatKm(view.walkedM)} walked
        </span>
        <button type="button" className="btn btn-ghost btn-small" onClick={onEnd}>
          End walk
        </button>
      </footer>

      {view.takeover && a && <TurnBackNow plan={plan} view={view} onAcknowledge={onAcknowledge} />}
    </main>
  );
}

function TurnBackNow({
  plan,
  view,
  onAcknowledge,
}: {
  plan: WalkPlan;
  view: WalkView;
  onAcknowledge: () => void;
}) {
  const a = view.assessment!;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.focus(), []);
  const minutes = (a.etaDirect - view.now) / 60_000;
  const last = plan.segments[plan.segments.length - 1];

  return (
    <div
      className="takeover"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="takeover-title"
      aria-describedby="takeover-desc"
    >
      <p className="takeover-eyebrow">
        {a.lateByMs > 0
          ? `Even now you'll be ${formatMinutes(a.lateByMs / 60_000)} late`
          : `To be back by ${formatTime(plan.end)}`}
      </p>
      <h1 id="takeover-title">TURN BACK NOW</h1>
      <p id="takeover-desc" className="takeover-desc">
        Shortest way back: {formatKm(a.directM)}, about {formatMinutes(minutes)}. Back at{' '}
        {formatTime(a.etaDirect)}.
      </p>
      {last && <p className="takeover-topic">On the way: {last.topic}</p>}
      <button
        ref={button}
        type="button"
        className="btn btn-big takeover-btn"
        onClick={onAcknowledge}
      >
        We&rsquo;re heading back
      </button>
    </div>
  );
}

function Arrived({ plan, view }: { plan: WalkPlan; view: WalkView }) {
  const spareMin = (plan.end - view.now) / 60_000;
  const outsideMin = view.startedAt ? (view.now - view.startedAt) / 60_000 : 0;
  return (
    <>
      <Header showModel={false} />
      <main className="page walk walk-arrived">
        <p className="arrived-emoji" aria-hidden="true">
          🌿
        </p>
        <h1>
          {spareMin >= 0
            ? `Back with ${formatMinutes(spareMin)} to spare`
            : `Back, ${formatMinutes(-spareMin)} late`}
        </h1>
        <p className="lede">
          {formatKm(view.walkedM)} walked, {formatMinutes(outsideMin)} away from the chair.
          {view.mode !== 'gps' && ' (Replay.)'}
        </p>
        <WeeklyStat refreshKey="arrived" />
        <p className="note">
          Back at your desk? Open the planner on your computer and record a 1-minute recap: Gemma
          writes down decisions and action items, and the audio never leaves that computer.
        </p>
        <MapView
          start={plan.route[0]!}
          loop={plan.route}
          walked={view.trail}
          fitKey="arrived"
          className="walk-map"
          label="Where you walked"
        />
      </main>
    </>
  );
}
