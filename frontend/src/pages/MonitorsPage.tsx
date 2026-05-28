import { Navigate } from 'react-router-dom';

/** Legacy route — catalog lives at `/app/add-ons`; Living Reports management at `/app/monitors/living-reports`. */
export default function MonitorsPage() {
  return <Navigate to="/app/add-ons" replace />;
}
