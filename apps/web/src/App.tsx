import { Plan } from './pages/Plan';
import { RoutePage } from './pages/Route';
import { WalkPage } from './pages/Walk';
import { useLocation } from './lib/router';

export function App() {
  const { segments, params } = useLocation();
  const [page, id] = segments;

  if (page === 'walk') {
    const data = params.get('d');
    if (data) return <WalkPage key={data} data={data} />;
  }
  if (page === 'route' && id) return <RoutePage key={id} meetingId={id} />;
  return <Plan />;
}
