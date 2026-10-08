import type { ScoreEntry } from '../lib/store';

interface ScoreBadgeProps {
  entry?: ScoreEntry;
  /** Gemma is reading this meeting right now. */
  reading?: boolean;
}

export function ScoreBadge({ entry, reading }: ScoreBadgeProps) {
  if (!entry) {
    return (
      <div
        className={`score score-pending ${reading ? 'is-reading' : ''}`}
        role="img"
        aria-label={reading ? 'Gemma is reading this meeting' : 'Waiting for Gemma'}
      >
        <span aria-hidden="true">{reading ? '' : '·'}</span>
      </div>
    );
  }
  const tone = entry.score >= 7 ? 'good' : entry.score >= 4 ? 'maybe' : 'no';
  return (
    <div
      className={`score score-${tone}`}
      role="img"
      aria-label={`Walkability ${entry.score} out of 10`}
    >
      <strong>{entry.score}</strong>
      <small>/10</small>
    </div>
  );
}
