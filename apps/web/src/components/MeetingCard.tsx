import type { Meeting } from '@cbaw/core';
import type { ReactNode } from 'react';
import { formatMinutes, formatRange } from '../lib/format';

interface MeetingCardProps {
  meeting: Meeting;
  badge?: ReactNode;
  reason?: ReactNode;
  onPick: () => void;
  dimmed?: boolean;
}

export function MeetingCard({ meeting, badge, reason, onPick, dimmed }: MeetingCardProps) {
  const people = meeting.attendeeCount === 1 ? 'Just you' : `${meeting.attendeeCount} people`;
  return (
    <li className={`meeting ${dimmed ? 'is-dimmed' : ''}`}>
      <div className="meeting-badge">{badge}</div>
      <div className="meeting-body">
        <h3 className="meeting-title">{meeting.title}</h3>
        <p className="meeting-meta">
          <span>{formatRange(meeting.start, meeting.end)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatMinutes(meeting.durationMin)}</span>
          <span aria-hidden="true">·</span>
          <span>{people}</span>
          {meeting.hasVideoLink && (
            <>
              <span aria-hidden="true">·</span>
              <span>video link</span>
            </>
          )}
          {meeting.recurring && (
            <>
              <span aria-hidden="true">·</span>
              <span>recurring</span>
            </>
          )}
        </p>
        {reason && <p className="meeting-reason">{reason}</p>}
      </div>
      <button
        type="button"
        className="btn btn-primary meeting-cta"
        onClick={onPick}
        aria-label={`Make "${meeting.title}" a walk`}
      >
        Make it a walk →
      </button>
    </li>
  );
}
