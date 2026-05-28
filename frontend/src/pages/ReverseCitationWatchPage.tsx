import { Link } from 'react-router-dom';
import MonitorManagementList from '../components/monitors/MonitorManagementList';

export default function ReverseCitationWatchPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <p className="text-xs text-indigo-400">
          <Link to="/app/add-ons" className="hover:text-indigo-300">
            ← All add-ons
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-white mt-2">Reverse-Citation Watch</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage citation-watch subscriptions per report. Subscribe from the{' '}
          <Link to="/app/add-ons" className="text-accent hover:underline">
            add-ons catalog
          </Link>{' '}
          or from a finalized report detail page.
        </p>
      </div>

      <MonitorManagementList
        monitorKind="reverse_citation_watch"
        emptyHint="No Reverse-Citation Watch subscriptions yet. Subscribe from the add-ons catalog or a finalized report."
      />
    </div>
  );
}
