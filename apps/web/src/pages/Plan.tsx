import { IcsParseError, parseIcs, type Meeting } from '@cbaw/core';
import { useEffect, useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { Header } from '../components/Header';
import { MeetingCard } from '../components/MeetingCard';
import { ScoreBadge } from '../components/ScoreBadge';
import { DEMO_WALK } from '../lib/demoWalk';
import { dayKey, formatShortDay, relativeDay } from '../lib/format';
import { prettyModel, useModelStatus } from '../lib/health';
import { navigate, paths } from '../lib/router';
import { sampleMeetings } from '../lib/sample';
import { cancelScoring, scoreMeetings, useScoringStatus } from '../lib/scoring';
import { clearCalendar, setCalendar, useAppState, type ScoreEntry } from '../lib/store';

function groupByDay(meetings: Meeting[]): Meeting[][] {
  const groups = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = dayKey(m.start);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()];
}

function Reason({ entry }: { entry?: ScoreEntry }) {
  if (!entry) return null;
  return (
    <>
      {entry.reason}{' '}
      <span className="source">
        {entry.source === 'gemma' && entry.model ? prettyModel(entry.model) : 'rules'}
      </span>
    </>
  );
}

function ScoringLine({ meetings }: { meetings: Meeting[] }) {
  const scores = useAppState((s) => s.scores);
  const { current } = useScoringStatus();
  const done = meetings.filter((m) => scores[m.id]).length;
  const reading = meetings.find((m) => m.id === current);

  if (reading) {
    return (
      <p className="status-line" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" /> Gemma is reading meeting {done + 1} of{' '}
        {meetings.length}: <em>{reading.title}</em>
      </p>
    );
  }
  if (done < meetings.length) return null;
  const walks = meetings.filter((m) => (scores[m.id]?.score ?? 0) >= 7).length;
  return (
    <p className="status-line" role="status" aria-live="polite">
      {walks === 0
        ? 'No obvious walks this week. Scores of 4 to 6 are worth a try.'
        : `${walks} meeting${walks > 1 ? 's' : ''} could be a walk.`}
    </p>
  );
}

function DemoInvite() {
  const status = useModelStatus();
  return (
    <section className="demo-invite">
      {status.state === 'no-api' && (
        <p className="note">
          Planning runs on your own computer: Gemma and the route search live in the local app (see
          the README). This page can&rsquo;t reach it, but the phone side works anywhere.
        </p>
      )}
      <a className="btn btn-ghost" href={`#${paths.walk(DEMO_WALK)}`}>
        📱 No setup? Open a real demo walk
      </a>
      <p className="muted small">
        A 45-minute meeting turned into a 3.2 km loop in downtown Monrovia. On the walk page, tap
        &ldquo;Demo: replay a walk at 10×&rdquo; to see TURN BACK NOW.
      </p>
    </section>
  );
}

export function Plan() {
  const meetings = useAppState((s) => s.meetings);
  const scores = useAppState((s) => s.scores);
  const calendarName = useAppState((s) => s.calendarName);
  const { current } = useScoringStatus();
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<'time' | 'walkability'>('time');

  useEffect(() => {
    if (meetings.length > 0) scoreMeetings(meetings);
  }, [meetings]);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const list = parseIcs(await file.text());
      if (list.length === 0) {
        setError('No upcoming meetings in the next two weeks in this file.');
        return;
      }
      cancelScoring();
      setCalendar(file.name, list);
    } catch (err) {
      setError(
        err instanceof IcsParseError
          ? err.message
          : "Couldn't read this file. Is it a calendar export (.ics)?",
      );
    }
  };

  if (meetings.length === 0) {
    return (
      <>
        <Header />
        <main className="page page-plan-empty">
          <section className="hero">
            <p className="eyebrow">Your calendar, outdoors</p>
            <h1>
              This meeting could have been a <em>walk</em>.
            </h1>
            <p className="lede">
              A Gemma model running on your computer reads your week, spots the meetings that
              don&rsquo;t need a screen, and turns them into a walking loop that lasts exactly as
              long as the meeting.
            </p>
          </section>
          <Dropzone
            onFile={onFile}
            onSample={() => {
              cancelScoring();
              setCalendar('Sample week (fake data)', sampleMeetings());
            }}
            error={error}
          />
          <DemoInvite />
        </main>
      </>
    );
  }

  const card = (m: Meeting, showDay = false) => (
    <MeetingCard
      key={m.id}
      meeting={m}
      day={showDay ? formatShortDay(m.start) : undefined}
      badge={<ScoreBadge entry={scores[m.id]} reading={current === m.id} />}
      reason={<Reason entry={scores[m.id]} />}
      dimmed={(scores[m.id]?.score ?? 10) <= 3}
      onPick={() => navigate(paths.route(m.id))}
    />
  );

  const ranked = [...meetings].sort(
    (a, b) => (scores[b.id]?.score ?? -1) - (scores[a.id]?.score ?? -1) || a.start - b.start,
  );

  return (
    <>
      <Header />
      <main className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">{calendarName}</p>
            <h1>Which of these could be a walk?</h1>
            <ScoringLine meetings={meetings} />
          </div>
          <div className="row">
            <div className="segmented" role="radiogroup" aria-label="Sort meetings">
              <button
                type="button"
                role="radio"
                aria-checked={sort === 'time'}
                className={sort === 'time' ? 'is-on' : ''}
                onClick={() => setSort('time')}
              >
                By day
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={sort === 'walkability'}
                className={sort === 'walkability' ? 'is-on' : ''}
                onClick={() => setSort('walkability')}
              >
                Best walks first
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                cancelScoring();
                clearCalendar();
              }}
            >
              Use another calendar
            </button>
          </div>
        </div>

        {sort === 'walkability' ? (
          <ul className="meetings">{ranked.map((m) => card(m, true))}</ul>
        ) : (
          groupByDay(meetings).map((day) => (
            <section key={dayKey(day[0]!.start)} className="day">
              <h2 className="day-title">{relativeDay(day[0]!.start)}</h2>
              <ul className="meetings">{day.map((m) => card(m))}</ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
