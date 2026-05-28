import { Link } from 'react-router-dom';
import MonitorManagementList from '../components/monitors/MonitorManagementList';

export default function LivingReportsPage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div>
        <p className="text-xs text-indigo-400">
          <Link to="/app/add-ons" className="hover:text-indigo-300">
            ← All add-ons
          </Link>
        </p>
        <h1 className="text-2xl font-bold text-white mt-2">Living Reports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage Living Report subscriptions attached to finalized reports. Subscribe to new reports from the{' '}
          <Link to="/app/add-ons" className="text-accent hover:underline">
            add-ons catalog
          </Link>
          .
        </p>
      </div>

      <MonitorManagementList
        monitorKind="living_report"
        emptyHint="No Living Report subscriptions yet. Open the add-ons catalog to subscribe on a finalized report, or use the Living Report panel on any report page."
      />
    </div>
  );
}
