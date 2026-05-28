import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
import RequireAdmin from './components/auth/RequireAdmin';
import RequireAuth from './components/auth/RequireAuth';
import LandingPage from './pages/LandingPage';
import LiveRunPage from './pages/LiveRunPage';
import ResearchPage from './pages/ResearchPage';
import ResearchLegacyV2Redirect from './pages/ResearchLegacyV2Redirect';
import ReportsPage from './pages/ReportsPage';
import DossiersPage from './pages/DossiersPage';
import DossierDetailPage from './pages/DossierDetailPage';
import DossierPlanHistoryPage from './pages/DossierPlanHistoryPage';
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
import BYOKConfigPage from './pages/BYOKConfigPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import UserLookup from './pages/admin/UserLookup';
import RunTelemetry from './pages/admin/RunTelemetry';
import AuditLogViewer from './pages/admin/AuditLogViewer';
import CostAnalytics from './pages/admin/CostAnalytics';
import SecurityPage from './pages/SecurityPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import AcceptableUsePage from './pages/AcceptableUsePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import OnboardingPage from './pages/OnboardingPage';
import AccountPage from './pages/AccountPage';
import BillingPage from './pages/BillingPage';
import SampleReportPage from './pages/SampleReportPage';
import MonitorsPage from './pages/MonitorsPage';
import NotFoundPage from './pages/NotFoundPage';
import FaqPage from './pages/FaqPage';
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import ComparePage from './pages/ComparePage';
import ChangelogPage from './pages/ChangelogPage';
import MarketingDocsPage from './pages/MarketingDocsPage';
import MarketingDocumentEffect from './components/MarketingDocumentEffect';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/methodology" element={<MethodologyPage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/compare" element={<ComparePage />} />
      <Route path="/changelog" element={<ChangelogPage />} />
      <Route path="/docs" element={<MarketingDocsPage />} />
      <Route path="/sovereign" element={<SovereignPage />} />
      <Route path="/byok" element={<BYOKPage />} />
      <Route path="/security" element={<SecurityPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/acceptable-use" element={<AcceptableUsePage />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/sample-report" element={<SampleReportPage />} />
      <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
      <Route path="/account/*" element={<RequireAuth><AccountPage /></RequireAuth>} />

      <Route path="/app" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Navigate to="/app/research" replace />} />
        <Route path="research" element={<ResearchPage />} />
        <Route path="run/:runId" element={<LiveRunPage />} />
        <Route path="research-v2" element={<ResearchLegacyV2Redirect />} />
        <Route path="models" element={<RequireAdmin><ModelsPage /></RequireAdmin>} />
        <Route path="dossiers" element={<DossiersPage />} />
        <Route path="dossiers/:id/plan-history" element={<DossierPlanHistoryPage />} />
        <Route path="dossiers/:id" element={<DossierDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/run/:runId" element={<FailedRunReportPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="corpus" element={<CorpusPage />} />
        <Route path="atlas" element={<AtlasPage />} />
        <Route path="embedding-viz" element={<EmbeddingAtlasPage />} />
        <Route path="knowledge-graph" element={<KnowledgeGraphPage />} />
        <Route path="ingest" element={<IngestPage />} />
        <Route path="guide" element={<GuidePage />} />
        <Route path="guide/research-v2" element={<ResearchV2GuidePage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="byok" element={<BYOKConfigPage />} />
        <Route path="admin" element={<RequireAdmin><AdminDashboard /></RequireAdmin>}>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<UserLookup />} />
          <Route path="telemetry" element={<RunTelemetry />} />
          <Route path="cost" element={<CostAnalytics />} />
          <Route path="audit" element={<AuditLogViewer />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export type AppProps = {
  /** Used when rendering under SSR/tests without a real browser location. */
  initialEntries?: string[];
};

export default function App({ initialEntries }: AppProps = {}) {
  if (typeof document === 'undefined') {
    return (
      <MemoryRouter initialEntries={initialEntries ?? ['/']}>
        <MarketingDocumentEffect />
        <AppRoutes />
      </MemoryRouter>
    );
  }
  return (
    <BrowserRouter>
      <MarketingDocumentEffect />
      <AppRoutes />
    </BrowserRouter>
  );
}
