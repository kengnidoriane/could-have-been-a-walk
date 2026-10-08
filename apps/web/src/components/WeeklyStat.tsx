import { weeklyStats } from '@cbaw/core';
import { useMemo } from 'react';
import { formatKm, formatMinutes } from '../lib/format';
import { loadWalks } from '../lib/walkStats';

/** "This week: 3 walks · 4.2 km · 95 min away from the chair." Only this device's walks. */
export function WeeklyStat({ refreshKey }: { refreshKey?: unknown }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read storage when asked
  const stats = useMemo(() => weeklyStats(loadWalks(), Date.now()), [refreshKey]);
  if (stats.walks === 0) return null;
  return (
    <p className="weekly-stat">
      <span aria-hidden="true">🌳</span> This week: <strong>{stats.walks}</strong> walk
      {stats.walks > 1 ? 's' : ''} · <strong>{formatKm(stats.distanceM)}</strong> ·{' '}
      <strong>{formatMinutes(stats.minutes)}</strong> away from the chair
      {stats.demos > 0 && (
        <span className="muted">
          {' '}
          (incl. {stats.demos} demo replay{stats.demos > 1 ? 's' : ''})
        </span>
      )}
    </p>
  );
}
