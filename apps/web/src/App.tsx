import { Plan } from './pages/Plan';
import { RoutePage } from './pages/Route';
import { useLocation } from './lib/router';

export function App() {
  const { segments } = useLocation();
  const [page, id] = segments;

  if (page === 'route' && id) return <RoutePage key={id} meetingId={id} />;
  return <Plan />;
}
