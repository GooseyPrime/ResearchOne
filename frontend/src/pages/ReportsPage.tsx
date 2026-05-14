import { Navigate } from 'react-router-dom';

/** Report library list moved to Dossiers (Wave 5.0). Deep links to report bodies remain on `/app/reports/:id` until Wave 5.4. */
export default function ReportsPage() {
  return <Navigate to="/app/dossiers" replace />;
}
