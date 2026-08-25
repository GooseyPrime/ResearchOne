/**
 * `/app/research` — where a research request is written, and nothing else.
 *
 * This page used to host a mode toggle, a surface toggle, three different
 * forms, a live trace, a plan gate and a run list. A request and the run it
 * produced shared one screen, so submitting a second request meant leaving the
 * first one's progress. WO-AF gave every run its own workspace at
 * `/app/run/<id>`; WO-AH leaves this page with the one thing it is for.
 */

import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import ResearchRequestForm from '../components/research/ResearchRequestForm';
import { parseRunIdFromSearchParams } from '../utils/researchRunRoutes';

export default function ResearchPage() {
  const [searchParams] = useSearchParams();
  const runId = parseRunIdFromSearchParams(searchParams);

  // Bookmarks and older links still point here with `?runId=`. A run lives in
  // its own workspace now, and that workspace handles every state a run can be
  // in — including waiting at the plan gate, which used to be the one case
  // that stayed on this page.
  if (runId) {
    return <Navigate to={`/app/run/${runId}`} replace />;
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FlaskConical className="text-accent" size={28} />
          <span className="text-gradient">Research</span>
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          Write your request here. Once it starts, it moves to its own page and this one is free
          for the next one.{' '}
          <Link to="/app/guide/research-v2" className="text-accent hover:underline">
            What happens to a request
          </Link>
        </p>
      </div>

      <ResearchRequestForm />
    </div>
  );
}
