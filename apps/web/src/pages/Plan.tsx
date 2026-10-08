import { IcsParseError, parseIcs, type Meeting } from '@cbaw/core';
import { useState } from 'react';
import { Dropzone } from '../components/Dropzone';
import { Header } from '../components/Header';
import { MeetingCard } from '../components/MeetingCard';
import { dayKey, relativeDay } from '../lib/format';
import { navigate, paths } from '../lib/router';
import { sampleMeetings } from '../lib/sample';
import { clearCalendar, setCalendar, useAppState } from '../lib/store';

function groupByDay(meetings: Meeting[]): Meeting[][] {
  const groups = new Map<string, Meeting[]>();
  for (const m of meetings) {
    const key = dayKey(m.start);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()];
}

export function Plan() {
  const meetings = useAppState((s) => s.meetings);
  const calendarName = useAppState((s) => s.calendarName);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    try {
      const list = parseIcs(await file.text());
      if (list.length === 0) {
        setError('No upcoming meetings in the next two weeks in this file.');
        return;
      }
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
            onSample={() => setCalendar('Sample week (fake data)', sampleMeetings())}
            error={error}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="page">
        <div className="page-head">
          <div>
            <p className="eyebrow">{calendarName}</p>
            <h1>Which of these could be a walk?</h1>
            <p className="muted">
              {meetings.length} upcoming meeting{meetings.length > 1 ? 's' : ''}. Pick one to plan
              the loop.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={clearCalendar}>
            Use another calendar
          </button>
        </div>

        {groupByDay(meetings).map((day) => (
          <section key={dayKey(day[0]!.start)} className="day">
            <h2 className="day-title">{relativeDay(day[0]!.start)}</h2>
            <ul className="meetings">
              {day.map((m) => (
                <MeetingCard key={m.id} meeting={m} onPick={() => navigate(paths.route(m.id))} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  );
}
