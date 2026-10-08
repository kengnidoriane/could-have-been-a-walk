import { lazy, Suspense } from 'react';
import { useLocation } from './lib/router';

// Each screen is its own chunk: the phone opening a walk link doesn't download the calendar
// parser, the QR generator or the recap recorder.
const Plan = lazy(() => import('./pages/Plan').then((m) => ({ default: m.Plan })));
const RoutePage = lazy(() => import('./pages/Route').then((m) => ({ default: m.RoutePage })));
const WalkPage = lazy(() => import('./pages/Walk').then((m) => ({ default: m.WalkPage })));
const RecapPage = lazy(() => import('./pages/Recap').then((m) => ({ default: m.RecapPage })));

function Screen() {
  const { segments, params } = useLocation();
  const [page, id] = segments;

  if (page === 'walk') {
    const data = params.get('d');
    if (data) return <WalkPage key={data} data={data} />;
  }
  if (page === 'route' && id) return <RoutePage key={id} meetingId={id} />;
  if (page === 'recap' && id) return <RecapPage key={id} meetingId={id} />;
  return <Plan />;
}

export function App() {
  return (
    <Suspense
      fallback={
        <p className="loading page" role="status">
          <span className="spinner" aria-hidden="true" /> Loading…
        </p>
      }
    >
      <Screen />
    </Suspense>
  );
}
