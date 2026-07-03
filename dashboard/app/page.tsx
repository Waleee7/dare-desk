import Dashboard from './components/Dashboard';

// The shell is fully client-side: it polls /api/state every 15s, so the page
// itself is static and the data path stays one clean route.
export default function Page() {
  return <Dashboard />;
}
