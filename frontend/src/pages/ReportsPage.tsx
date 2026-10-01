import { Navigate } from 'react-router-dom';

/** Report library list moved to Dossiers (the dossier data-model pass). Deep links to report bodies remain on `/app/reports/:id` until the revision-spinoff pass. */
export default function ReportsPage() {
  return <Navigate to="/app/dossiers" replace />;
}
