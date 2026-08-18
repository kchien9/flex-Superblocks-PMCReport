/**
 * API Registry - Central export for all APIs.
 *
 * This file is the single source of truth for API definitions.
 * Add new APIs here to get full TypeScript support in the frontend.
 *
 * Usage:
 * 1. Import your API: `import MyApi from './MyApi/api.js';`
 * 2. Add it to the apis object below
 * 3. That's it! Types automatically flow to useApi via client/hooks/useApi.ts
 *
 * IMPORTANT: Use .js extension for imports (required for ESM compatibility)
 */

import SetupContentLibrary from './content-library/setup.js';
import GetContentLibrary from './content-library/get-all.js';
import UpdateContentDocument from './content-library/update.js';

import GetPSMNARData from './psm-dashboard/get-nar-data.js';
import GeneratePSMActionItems from './psm-dashboard/generate-action-items.js';
import GetPSMList from './psm-dashboard/get-psm-list.js';
import SetupSkillRegistry from './skills-registry/setup.js';
import GetSkillRegistry from './skills-registry/get-all.js';
import UpdateSkill from './skills-registry/update.js';
import InsertSkill from './skills-registry/insert.js';
import GetPMCPropertyDetail from './psm-dashboard/get-pmc-property-detail.js';
import GetPMCSupportHealth from './psm-dashboard/get-pmc-support-health.js';
import GetLeaderboardClosedWon from './leaderboard/get-closed-won.js';
import GetLeaderboardPipeline from './leaderboard/get-pipeline.js';
import GetPMCTicketList from './psm-dashboard/get-pmc-ticket-list.js';
import SetupAuditTables from './audit/setup-tables.js';
import GetOpportunityDQLive from './opportunity-dq/get-live.js';
import GetOpportunityDQHistory from './opportunity-dq/get-history.js';
import SetupOppDQGovernance from './opportunity-dq/setup-governance.js';
import LogConsoleActivity from './audit/log-activity.js';
import SearchSalesforceAccounts from './pitch-prep/search-accounts.js';
import RunResearch from './pitch-prep/run-research.js';
import GenerateBrief from './pitch-prep/generate-brief.js';
import PracticeChat from './pitch-prep/practice-chat.js';
import FetchNotionKB from './pitch-prep/fetch-notion-kb.js';
import GetPMCNames from './pmc-report/get-pmc-names.js';
import GetPMCMonthlyReport from './pmc-report/get-pmc-monthly-report.js';
import GetPMCTestimonials from './pmc-report/get-pmc-testimonials.js';
import SearchProspectAccounts from './pmc-report/search-prospect-accounts.js';
import GetProspectDeck from './pmc-report/get-prospect-deck.js';
import SetupUsageTable from './usage/setup-table.js';
import LogUsageEvent from './usage/log-event.js';
import GetUsageStats from './usage/get-stats.js';

const apis = {
  SetupContentLibrary,
  GetContentLibrary,
  UpdateContentDocument,
  GetPSMNARData,
  GeneratePSMActionItems,
  GetPSMList,
  SetupSkillRegistry,
  GetSkillRegistry,
  UpdateSkill,
  InsertSkill,
  GetPMCPropertyDetail,
  GetPMCSupportHealth,
  GetLeaderboardClosedWon,
  GetLeaderboardPipeline,
  GetPMCTicketList,
  SetupAuditTables,
  GetOpportunityDQLive,
  GetOpportunityDQHistory,
  SetupOppDQGovernance,
  LogConsoleActivity,
  SearchSalesforceAccounts,
  RunResearch,
  GenerateBrief,
  PracticeChat,
  FetchNotionKB,
  GetPMCNames,
  GetPMCMonthlyReport,
  GetPMCTestimonials,
  SearchProspectAccounts,
  GetProspectDeck,
  SetupUsageTable,
  LogUsageEvent,
  GetUsageStats,
} as const;

export default apis;

/** Type for useApi inference - exported for client type-only imports */
export type ApiRegistry = typeof apis;
