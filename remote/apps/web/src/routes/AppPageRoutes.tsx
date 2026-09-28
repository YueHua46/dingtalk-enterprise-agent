import { lazy } from 'react';
import { Navigate, Route, Routes, type Location } from 'react-router-dom';
import { SettingsLayout } from '@/layout/SettingsLayout';
import { CompetitorComparisonPage } from '@/pages/CompetitorComparisonPage';
import { UserManagementPage } from '@/pages/UserManagementPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const CommerceIntelArchivePage = lazy(() =>
  import('@/pages/CommerceIntelArchivePage').then((module) => ({ default: module.CommerceIntelArchivePage })),
);
const OpsInsightsPage = lazy(() => import('@/pages/OpsInsightsPage').then((module) => ({ default: module.OpsInsightsPage })));
const CompetitorPage = lazy(() => import('@/pages/CompetitorPage').then((module) => ({ default: module.CompetitorPage })));
const CompetitorSnapshotDetailPage = lazy(() =>
  import('@/pages/CompetitorSnapshotDetailPage').then((module) => ({ default: module.CompetitorSnapshotDetailPage })),
);
const CompetitorResearchPage = lazy(() =>
  import('@/pages/CompetitorResearchPage').then((module) => ({ default: module.CompetitorResearchPage })),
);
const AmazonAdsPage = lazy(() => import('@/pages/AmazonAdsPage').then((module) => ({ default: module.AmazonAdsPage })));
const AmazonRankTrackerPage = lazy(() =>
  import('@/pages/AmazonRankTrackerPage').then((module) => ({ default: module.AmazonRankTrackerPage })),
);
const AmazonRankPlansPage = lazy(() =>
  import('@/pages/AmazonRankPlansPage').then((module) => ({ default: module.AmazonRankPlansPage })),
);
const AmazonRankRunPage = lazy(() =>
  import('@/pages/AmazonRankRunPage').then((module) => ({ default: module.AmazonRankRunPage })),
);
const PricingSopPage = lazy(() => import('@/pages/PricingSopPage').then((module) => ({ default: module.PricingSopPage })));
const DailyAnalysisPage = lazy(() =>
  import('@/pages/DailyAnalysisPage').then((module) => ({ default: module.DailyAnalysisPage })),
);
const DataLineagePage = lazy(() => import('@/pages/DataLineagePage').then((module) => ({ default: module.DataLineagePage })));
const ReviewAnalysisPage = lazy(() =>
  import('@/pages/ReviewAnalysisPage').then((module) => ({ default: module.ReviewAnalysisPage })),
);
const ReviewNotifyAsinPage = lazy(() =>
  import('@/pages/ReviewNotifyAsinPage').then((module) => ({ default: module.ReviewNotifyAsinPage })),
);
const TaskMonitorPage = lazy(() => import('@/pages/TaskMonitorPage').then((module) => ({ default: module.TaskMonitorPage })));
const AgentPage = lazy(() => import('@/pages/AgentPage').then((module) => ({ default: module.AgentPage })));
const KnowledgeBasePage = lazy(() =>
  import('@/pages/KnowledgeBasePage').then((module) => ({ default: module.KnowledgeBasePage })),
);
const SettingsHubPage = lazy(() =>
  import('@/pages/SettingsHubPage').then((module) => ({ default: module.SettingsHubPage })),
);
const LlmSettingsPage = lazy(() =>
  import('@/pages/LlmSettingsPage').then((module) => ({ default: module.LlmSettingsPage })),
);
const NotificationsSettingsPage = lazy(() =>
  import('@/pages/NotificationsSettingsPage').then((module) => ({ default: module.NotificationsSettingsPage })),
);
const RagSettingsPage = lazy(() =>
  import('@/pages/RagSettingsPage').then((module) => ({ default: module.RagSettingsPage })),
);
const McpSettingsPage = lazy(() =>
  import('@/pages/McpSettingsPage').then((module) => ({ default: module.McpSettingsPage })),
);
const ExternalIntegrationsPage = lazy(() =>
  import('@/pages/ExternalIntegrationsPage').then((module) => ({ default: module.ExternalIntegrationsPage })),
);
const UserProfilePage = lazy(() =>
  import('@/pages/UserProfilePage').then((module) => ({ default: module.UserProfilePage })),
);
const UserRolePermissionsPage = lazy(() =>
  import('@/pages/UserRolePermissionsPage').then((module) => ({ default: module.UserRolePermissionsPage })),
);
const StoreManagementPage = lazy(() =>
  import('@/pages/StoreManagementPage').then((module) => ({ default: module.StoreManagementPage })),
);
const AgentDataAccessPage = lazy(() => import('@/pages/AgentDataAccessPage').then((module) => ({ default: module.AgentDataAccessPage })));

type Props = {
  location: Location;
};

/**
 * A complete business route tree that can render against a cached location.
 * Each mounted tab owns one instance, so navigating elsewhere does not unmount it.
 */
export function AppPageRoutes({ location }: Props) {
  return (
    <Routes location={location}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard/data-screen" element={<Navigate to="/daily-analysis" replace />} />
      <Route path="/commerce-intel-archive" element={<CommerceIntelArchivePage />} />
      <Route path="/ops-insights" element={<OpsInsightsPage />} />
      <Route path="/ai-agent" element={<AgentPage />} />
      <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
      <Route path="/knowledge-chat" element={<Navigate to="/ai-agent" replace />} />
      <Route path="/competitor-monitoring" element={<CompetitorPage />} />
      <Route path="/competitor-comparison/:productId" element={<CompetitorSnapshotDetailPage />} />
      <Route path="/competitor-comparison" element={<CompetitorComparisonPage />} />
      <Route path="/competitor-research" element={<Navigate to="/competitor-research/new" replace />} />
      <Route path="/competitor-research/new" element={<CompetitorResearchPage />} />
      <Route path="/competitor-research/history" element={<CompetitorResearchPage />} />
      <Route path="/competitor-research/:runId" element={<CompetitorResearchPage />} />
      <Route path="/amazon-ads" element={<AmazonAdsPage />} />
      <Route path="/rank-tracker" element={<AmazonRankTrackerPage />} />
      <Route path="/rank-tracker/plans" element={<AmazonRankPlansPage />} />
      <Route path="/rank-tracker/runs/:runId" element={<AmazonRankRunPage />} />
      <Route path="/pricing-sop" element={<PricingSopPage />} />
      <Route path="/daily-analysis" element={<DailyAnalysisPage />} />
      <Route path="/data-lineage" element={<DataLineagePage />} />
      <Route path="/review-notify-asins" element={<ReviewNotifyAsinPage />} />
      <Route path="/review-analysis" element={<ReviewAnalysisPage />} />
      <Route path="/task-monitor" element={<TaskMonitorPage />} />
      <Route path="/user" element={<Navigate to="/settings/user/profile" replace />} />
      <Route path="/user/profile" element={<Navigate to="/settings/user/profile" replace />} />
      <Route path="/user/management" element={<Navigate to="/settings/user/management" replace />} />
      <Route path="/user/roles" element={<Navigate to="/settings/user/roles" replace />} />
      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<SettingsHubPage />} />
        <Route path="llm" element={<LlmSettingsPage />} />
        <Route path="rag" element={<RagSettingsPage />} />
        <Route path="mcp" element={<McpSettingsPage />} />
        <Route path="integrations" element={<ExternalIntegrationsPage />} />
        <Route path="agent-access" element={<AgentDataAccessPage />} />
        <Route path="notifications" element={<NotificationsSettingsPage />} />
        <Route path="users" element={<Navigate to="/settings/user/management" replace />} />
        <Route path="user" element={<Navigate to="/settings/user/profile" replace />} />
        <Route path="user/profile" element={<UserProfilePage />} />
        <Route path="user/management" element={<UserManagementPage />} />
        <Route path="user/stores" element={<StoreManagementPage />} />
        <Route path="user/roles" element={<UserRolePermissionsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
