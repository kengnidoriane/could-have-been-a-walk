import type { AgendaSegment } from '@cbaw/core';

interface AgendaTimelineProps {
  segments: AgendaSegment[];
  active?: number | null;
  onActive?: (index: number | null) => void;
}

export function segmentWhen(segment: AgendaSegment, isLast: boolean): string {
  const range = `${Math.round(segment.startMin)}–${Math.round(segment.endMin)} min`;
  return isLast ? `${range} · way back to the start` : `${range} · until ${segment.untilLabel}`;
}

export function AgendaTimeline({ segments, active, onActive }: AgendaTimelineProps) {
  return (
    <ol className="agenda">
      {segments.map((segment, i) => (
        <li
          key={`${i}-${segment.topic}`}
          className={active === i ? 'is-active' : ''}
          onMouseEnter={() => onActive?.(i)}
          onMouseLeave={() => onActive?.(null)}
        >
          <span className="agenda-num" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <p className="agenda-when">{segmentWhen(segment, i === segments.length - 1)}</p>
            <p className="agenda-topic">{segment.topic}</p>
            {segment.prompt && <p className="agenda-prompt">{segment.prompt}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
