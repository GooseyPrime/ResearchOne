import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import ResearchPage from './pages/ResearchPage';
import ReportsPage from './pages/ReportsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import CorpusPage from './pages/CorpusPage';
import AtlasPage from './pages/AtlasPage';
import IngestPage from './pages/IngestPage';
import GuidePage from './pages/GuidePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/research" replace />} />
          <Route path="research" element={<ResearchPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportDetailPage />} />
          <Route path="corpus" element={<CorpusPage />} />
          <Route path="atlas" element={<AtlasPage />} />
          <Route path="ingest" element={<IngestPage />} />
          <Route path="guide" element={<GuidePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
