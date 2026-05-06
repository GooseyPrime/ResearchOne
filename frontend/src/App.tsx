import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
import RequireAdmin from './components/auth/RequireAdmin';
import RequireAuth from './components/auth/RequireAuth';
import LandingPage from './pages/LandingPage';
import ResearchPage from './pages/ResearchPage';
import ResearchPageV2 from './pages/ResearchPageV2';
import ReportsPage from './pages/ReportsPage';
import ReportDetailPage from './pages/ReportDetailPage';
import FailedRunReportPage from './pages/FailedRunReportPage';
import CorpusPage from './pages/CorpusPage';
import AtlasPage from './pages/AtlasPage';
import EmbeddingAtlasPage from './pages/EmbeddingAtlasPage';
import KnowledgeGraphPage from './pages/KnowledgeGraphPage';
import IngestPage from './pages/IngestPage';
import GuidePage from './pages/GuidePage';
import ResearchV2GuidePage from './pages/ResearchV2GuidePage';
import ModelsPage from './pages/ModelsPage';
import PricingPage from './pages/PricingPage';
import MethodologyPage from './pages/MethodologyPage';
import SovereignPage from './pages/SovereignPage';
import BYOKPage from './pages/BYOKPage';
import SecurityPage from './pages/SecurityPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import AcceptableUsePage from './pages/AcceptableUsePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import OnboardingPage from './pages/OnboardingPage';
import AccountPage from './pages/AccountPage';
import BillingPage from './pages/BillingPage';

export default function App() {
  const RouterProvider = typeof document === 'undefined' ? MemoryRouter : BrowserRouter;

  return (
    <RouterProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/methodology" element={<MethodologyPage />} />
        <Route path="/sovereign" element={<SovereignPage />} />
        <Route path="/byok" element={<BYOKPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/acceptable-use" element={<AcceptableUsePage />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><AccountPage /></RequireAuth>} />

        <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Navigate to="/app/research" replace />} />
          <Route path="research" element={<ResearchPage />} />
          <Route path="research-v2" element={<ResearchPageV2 />} />
          <Route path="models" element={<RequireAdmin><ModelsPage /></RequireAdmin>} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/run/:runId" element={<FailedRunReportPage />} />
          <Route path="reports/:id" element={<ReportDetailPage />} />
          <Route path="corpus" element={<CorpusPage />} />
          <Route path="atlas" element={<AtlasPage />} />
          <Route path="embedding-viz" element={<EmbeddingAtlasPage />} />
          <Route path="knowledge-graph" element={<KnowledgeGraphPage />} />
          <Route path="ingest" element={<IngestPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="guide/research-v2" element={<ResearchV2GuidePage />} />
          <Route path="billing" element={<BillingPage />} />
        </Route>
      </Routes>
    </RouterProvider>
  );
}
