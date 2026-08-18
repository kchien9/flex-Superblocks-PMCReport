import { useState, useCallback, useEffect, useRef } from "react";
import { useSessionState, clearSessionNamespace } from "@/hooks/useSessionState";
import { useApi } from "@/hooks/useApi.js";
import { executeApi } from "@/lib/executeApi.js";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import AccountSearchResult from "@/components/PitchPrep/AccountSearchResult";
// Inline Account type to avoid TS never-narrowing bug with re-exported types
type Account = {
  Id: string;
  Name: string;
  Website: string | null;
  Phone: string | null;
  BillingCity: string | null;
  BillingState: string | null;
  BillingCountry: string | null;
  PM_Software__c: string | null;
  Total_Company_Units__c: number | null;
  Sales_Segment__c: string | null;
  Account_Status__c: string | null;
  Total_Units_on_Flex__c: number | null;
  Asset_Class__c: string | null;
  Portfolio_Type__c: string | null;
  Portfolio_Asset_Subtypes__c: string | null;
  Flex_Company_ID__c: string | null;
  Last_Bill_Pay_Charged_Users__c: number | null;
  Last_Bill_Pay_NAR__c: number | null;
  Last_Bill_Pay_TNAR__c: number | null;
  Rent_Paid_Last_BP__c: number | null;
  Bills_Paid_Last_BP__c: number | null;
  Total_of_Bill_Pay_Users__c: number | null;
  Owner: { Name: string } | null;
};
import DealContextForm from "@/components/PitchPrep/DealContextForm";
import type { DealContextData } from "@/components/PitchPrep/DealContextForm";
import AccountIntelResults from "@/components/PitchPrep/AccountIntelResults";
import PreCallBriefDisplay from "@/components/PitchPrep/PreCallBriefDisplay";
import PitchPractice from "@/components/PitchPrep/PitchPractice";
import ResearchLoadingSpinner from "@/components/PitchPrep/ResearchLoadingSpinner";
import BriefLoadingIndicator from "@/components/PitchPrep/BriefLoadingIndicator";
import InlineErrorBanner from "@/components/PitchPrep/InlineErrorBanner";
import { fetchGoogleKB } from "@/lib/fetchGoogleKB";
import NOTION_KB_STATIC from "@/lib/notionKBStatic";

const STATIC_STATS = `## Research Reports, Stats & Case Studies

### Breaking the Fee Cycle — 2025 Flex Financial Well-Being Survey
URL: https://getflex.com/properties/resources/breaking-the-fee-cycle
- 92% of Flex users avoid late fees and penalties
- 82% report a reduced risk of eviction
- 85% saved money in the past year
- 90% improved their housing stability

### Resident Experience in the Digital Age — J Turner Research Survey
URL: https://hubs.la/Q02JHBbK0
- 43% of lease non-renewals are preventable by enhancing the resident experience
- 84% of residents are interested in using a mobile app to split rent into smaller payments
- 85% of residents with access to flexible payment options report higher satisfaction
- Properties offering flexible payments outperform state ORA score by +3.6 points
- Property managers spend an average of 9.7 hours each month on late rent notices

### Flex Case Studies
Asset Living: 4 percentage point increase in collection rates, 70% Flex adoption in Texas
Sage Ventures: $2.2M processed, 7.2% NAR, 5 hrs/month saved per assistant manager
Lucky Communities: $100K+ on-time rent collected, 1.5 hrs/month staff time saved`;

const TABS = [
  { id: 0, label: "1 · Meeting Prep" },
  { id: 1, label: "2 · Account Intel" },
  { id: 2, label: "3 · Pre-Call Brief" },
  // { id: 3, label: "4 · Pitch Practice" }, // Hidden — In Development
] as const;

/** Tries the live Notion KB fetch; falls back to static export if it fails or returns too little. */
async function fetchNotionKBWithFallback(): Promise<string> {
  try {
    const result = await executeApi("FetchNotionKB", {});
    const content = (result as any)?.content ?? "";
    if (content && content.length > 200) return content;
    return NOTION_KB_STATIC;
  } catch {
    return NOTION_KB_STATIC;
  }
}

// SF enrichment data types
interface SFActivity {
  Subject?: string;
  ActivityDate?: string;
  Status?: string;
  Description?: string;
}

interface SFOpportunity {
  Name?: string;
  Amount?: number;
  StageName?: string;
  Type?: string;
  NextStep?: string;
  CloseDate?: string;
  Loss_Reason__c?: string;
}

interface SFClosedLost {
  Name?: string;
  CloseDate?: string;
  Loss_Reason__c?: string;
  Amount?: number;
  ContactRoles?: { Name?: string; Title?: string; Role?: string }[];
  Discovery_Notes__c?: string;
}

export default function PitchPrep() {
  const { track } = useUsageTracking("PitchPrep", { trackPageView: true });

  // Tab / step flow state (persisted)
  const [activeTab, setActiveTab] = useSessionState<number>("pitchprep:activeTab", 0);
  const [completedStepsArr, setCompletedStepsArr] = useSessionState<number[]>("pitchprep:completedSteps", []);
  // Derived Set for convenience; update via the array setter
  const completedSteps = new Set(completedStepsArr);
  const setCompletedSteps = useCallback((updater: (prev: Set<number>) => Set<number>) => {
    setCompletedStepsArr((prev) => [...updater(new Set(prev))]);
  }, [setCompletedStepsArr]);

  // Meeting Prep state (persisted)
  const [companySearch, setCompanySearch] = useSessionState<string>("pitchprep:companySearch", "");
  const [searchResults, setSearchResults] = useSessionState<Account[] | null>("pitchprep:searchResults", null);
  const { run: searchAccounts, loading: searching } = useApi("SearchSalesforceAccounts");

  // RunResearch API
  const { run: runResearch, loading: researchRunning } = useApi("RunResearch");

  // GenerateBrief API
  const { run: generateBrief, loading: briefGenerating } = useApi("GenerateBrief");

  // Page-level state variables (persisted)
  const [selectedAccount, setSelectedAccount] = useSessionState<Account | null>("pitchprep:selectedAccount", null);
  const [researchData, setResearchData] = useSessionState<Record<string, any> | null>("pitchprep:researchData", null);
  const [researchError, setResearchError] = useSessionState<string | null>("pitchprep:researchError", null);
  const [briefData, setBriefData] = useSessionState<Record<string, any> | null>("pitchprep:briefData", null);
  const [briefText, setBriefText] = useSessionState<string>("pitchprep:briefText", "");
  const [briefError, setBriefError] = useSessionState<string | null>("pitchprep:briefError", null);
  const [dealContext, setDealContext] = useSessionState<Record<string, any> | null>("pitchprep:dealContext", null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSalesforceAuthError, setIsSalesforceAuthError] = useState(false);

  // SF enrichment state (persisted)
  const [sfActivities, setSfActivities] = useSessionState<SFActivity[]>("pitchprep:sfActivities", []);
  const [sfOpenOpportunities, setSfOpenOpportunities] = useSessionState<SFOpportunity[]>("pitchprep:sfOpenOpps", []);
  const [sfClosedLost, setSfClosedLost] = useSessionState<SFClosedLost[]>("pitchprep:sfClosedLost", []);
  const [sfDataGaps, setSfDataGaps] = useSessionState<string[]>("pitchprep:sfDataGaps", []);

  // Knowledge base builder with 30-minute TTL cache
  const kbRef = useRef<{ text: string; fetchedAt: number }>({ text: "", fetchedAt: 0 });

  const buildKnowledgeBase = useCallback(async (): Promise<string> => {
    // Return cached version if still fresh (30-minute TTL)
    if (kbRef.current.text && (Date.now() - kbRef.current.fetchedAt) < 1_800_000) {
      return kbRef.current.text;
    }

    // Fetch Notion pages (with static fallback) and Google sources in parallel
    const [notionText, googleText] = await Promise.all([
      fetchNotionKBWithFallback(),
      fetchGoogleKB(),
    ]);

    const sections: string[] = [];
    if (notionText) sections.push(notionText);
    if (googleText) sections.push(googleText);
    sections.push(STATIC_STATS);

    const combined = sections.join("\n\n---\n\n");
    kbRef.current = { text: combined, fetchedAt: Date.now() };
    return combined;
  }, []);

  // SF Enrichment — fetch activities, opps, closed-lost when account selected
  const enrichmentFiredRef = useRef(false);

  const triggerEnrichment = useCallback(
    async (account: Account) => {
      if (enrichmentFiredRef.current) return;
      enrichmentFiredRef.current = true;

      try {
        const result = await searchAccounts({ companyName: account.Name, accountId: account.Id });
        if (result) {
          setSfActivities((result as any).activities ?? []);
          setSfOpenOpportunities((result as any).openOpportunities ?? []);
          setSfClosedLost((result as any).closedLostOpportunities ?? []);
          setSfDataGaps((result as any).dataGaps ?? []);
        }
      } catch {
        // Non-critical — enrichment failure doesn't block flow
      }
    },
    [searchAccounts]
  );

  // Auto-trigger research when navigating to Account Intel tab
  const researchTriggeredRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 1) return;
    if (!selectedAccount || !dealContext) return;
    if (researchData || researchTriggeredRef.current) return;

    researchTriggeredRef.current = true;
    setResearchError(null);

    const triggerResearch = async () => {
      try {
        const result = await runResearch({
          account: {
            Name: selectedAccount.Name,
            Website: selectedAccount.Website ?? null,
            BillingCity: selectedAccount.BillingCity ?? null,
            BillingState: selectedAccount.BillingState ?? null,
            BillingCountry: selectedAccount.BillingCountry ?? null,
            Total_Company_Units__c: selectedAccount.Total_Company_Units__c ?? null,
            PM_Software__c: selectedAccount.PM_Software__c ?? null,
            Account_Status__c: selectedAccount.Account_Status__c ?? null,
            Total_Units_on_Flex__c: selectedAccount.Total_Units_on_Flex__c ?? null,
            Sales_Segment__c: selectedAccount.Sales_Segment__c ?? null,
            Asset_Class__c: selectedAccount.Asset_Class__c ?? null,
            Portfolio_Type__c: selectedAccount.Portfolio_Type__c ?? null,
            Portfolio_Asset_Subtypes__c: selectedAccount.Portfolio_Asset_Subtypes__c ?? null,
            Last_Bill_Pay_Charged_Users__c: selectedAccount.Last_Bill_Pay_Charged_Users__c ?? null,
            Last_Bill_Pay_NAR__c: selectedAccount.Last_Bill_Pay_NAR__c ?? null,
            Last_Bill_Pay_TNAR__c: selectedAccount.Last_Bill_Pay_TNAR__c ?? null,
            Rent_Paid_Last_BP__c: selectedAccount.Rent_Paid_Last_BP__c ?? null,
            Bills_Paid_Last_BP__c: selectedAccount.Bills_Paid_Last_BP__c ?? null,
            Total_of_Bill_Pay_Users__c: selectedAccount.Total_of_Bill_Pay_Users__c ?? null,
          },
          dealContext: {
            attendees: dealContext.attendees || "",
            buyerPersonas: dealContext.buyerPersonas || [],
            focusAreas: dealContext.focusAreas || [],
            knownConcerns: dealContext.knownConcerns || "",
            marketFocus: dealContext.marketFocus || "",
            additionalNotes: dealContext.additionalNotes || "",
          },
          sfActivities: sfActivities.length > 0 ? sfActivities : null,
          sfOpenOpportunities: sfOpenOpportunities.length > 0 ? sfOpenOpportunities : null,
          sfClosedLost: sfClosedLost.length > 0 ? sfClosedLost : null,
          sfDataGaps: sfDataGaps.length > 0 ? sfDataGaps : null,
        });
        setResearchData(result?.research ?? null);
        if (result?.research) {
          setCompletedSteps((prev) => {
            const next = new Set(prev);
            next.add(1);
            return next;
          });
          track("research_generated", { account: selectedAccount?.Name ?? "" });
          // Pre-warm KB and auto-fire brief generation in background
          buildKnowledgeBase();
        }
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        setResearchError(message);
        toast.error("Research failed: " + message);
      }
    };

    triggerResearch();
  }, [activeTab, selectedAccount, dealContext, researchData, runResearch, sfActivities, sfOpenOpportunities, sfClosedLost, sfDataGaps, buildKnowledgeBase]);

  const handleSearch = useCallback(async () => {
    if (!companySearch.trim()) return;
    setSearchError(null);
    setIsSalesforceAuthError(false);
    try {
      const result = await searchAccounts({ companyName: companySearch.trim() });
      setSearchResults((result?.accounts ?? []) as Account[]);
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      // Detect 401 auth errors
      if (message.includes("401") || message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("session expired")) {
        setIsSalesforceAuthError(true);
      }
      setSearchError(message);
    }
  }, [companySearch, searchAccounts]);

  const handleAccountSelect = useCallback(
    (account: Account) => {
      setSelectedAccount(account);
      // Trigger enrichment fetch for activities/opps/closed-lost
      triggerEnrichment(account);
    },
    [triggerEnrichment]
  );

  // Deal context form
  const [researchLoading, setResearchLoading] = useState(false);

  const handleDealContextSubmit = useCallback(
    async (data: DealContextData) => {
      if (!selectedAccount) {
        toast.error("Please select an account first.");
        return;
      }
      setResearchLoading(true);
      setDealContext(data);

      // Mark step 0 as completed and navigate to tab 1
      setCompletedSteps((prev) => {
        const next = new Set(prev);
        next.add(0);
        return next;
      });
      setActiveTab(1);
      setResearchLoading(false);
    },
    [selectedAccount]
  );

  // Brief generation step tracking
  const [briefStep, setBriefStep] = useState<string>("");
  const briefFiredRef = useRef(false);

  const triggerBriefGeneration = useCallback(async () => {
    if (!researchData || !dealContext) return;
    if (briefFiredRef.current) return;
    briefFiredRef.current = true;
    setBriefError(null);
    setBriefStep("Assembling knowledge base…");

    try {
      // Ensure KB is ready before generating the brief
      const kb = kbRef.current.text || await buildKnowledgeBase();
      setBriefStep("Generating brief…");

      const result = await generateBrief({
        researchData,
        knowledgeBase: kb,
        dealContext: {
          personas: dealContext.buyerPersonas || [],
          focusAreas: dealContext.focusAreas || [],
          concerns: dealContext.knownConcerns || "",
          notes: dealContext.additionalNotes || "",
        },
      });
      setBriefStep("Structuring insights…");
      setBriefData(result?.brief ?? null);
      setBriefText(result?.rawText ?? "");
      if (result?.brief) {
        setCompletedSteps((prev) => {
          const next = new Set(prev);
          next.add(2);
          return next;
        });
        track("brief_generated", { account: selectedAccount?.Name ?? "" });
      }
    } catch (error) {
      briefFiredRef.current = false; // Allow retry
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      setBriefError(message);
      setBriefStep("");
    }
  }, [researchData, dealContext, generateBrief, buildKnowledgeBase]);

  // Auto-fire brief generation as soon as research data becomes available
  useEffect(() => {
    if (!researchData || !dealContext) return;
    if (briefData || briefFiredRef.current) return;
    triggerBriefGeneration();
  }, [researchData, dealContext, briefData, triggerBriefGeneration]);

  // Start Over — resets all state, clears session, and returns to tab 1
  const handleStartOver = useCallback(() => {
    clearSessionNamespace("pitchprep:");
    setActiveTab(0);
    setCompletedStepsArr([]);
    setCompanySearch("");
    setSearchResults(null);
    setSelectedAccount(null);
    setDealContext(null);
    setResearchData(null);
    setResearchError(null);
    setBriefData(null);
    setBriefText("");
    setBriefError(null);
    setBriefStep("");
    setSearchError(null);
    setIsSalesforceAuthError(false);
    setSfActivities([]);
    setSfOpenOpportunities([]);
    setSfClosedLost([]);
    setSfDataGaps([]);
    researchTriggeredRef.current = false;
    briefFiredRef.current = false;
    enrichmentFiredRef.current = false;
  }, [setActiveTab, setCompletedStepsArr, setCompanySearch, setSearchResults, setSelectedAccount, setDealContext, setResearchData, setResearchError, setBriefData, setBriefText, setBriefError, setSfActivities, setSfOpenOpportunities, setSfClosedLost, setSfDataGaps]);

  // Handle "Practice This Pitch" from Pre-Call Brief tab
  // NOTE: Pitch Practice is currently hidden — keeping handler for future re-enable
  const handlePracticePitch = useCallback(() => {
    // Pitch Practice tab is hidden; no-op for now
  }, []);

  // A tab is enabled if it's the first tab, or all prior steps are completed
  const isTabEnabled = useCallback(
    (tabIndex: number) => {
      if (tabIndex === 0) return true;
      for (let i = 0; i < tabIndex; i++) {
        if (!completedSteps.has(i)) return false;
      }
      return true;
    },
    [completedSteps]
  );

  const handleTabClick = useCallback(
    (tabIndex: number) => {
      if (isTabEnabled(tabIndex)) {
        setActiveTab(tabIndex);
      }
    },
    [isTabEnabled]
  );

  // Bill Pay data extracted from selected account for AccountIntelResults
  const billPayData = selectedAccount
    ? {
        Last_Bill_Pay_Charged_Users__c: selectedAccount.Last_Bill_Pay_Charged_Users__c,
        Last_Bill_Pay_NAR__c: selectedAccount.Last_Bill_Pay_NAR__c,
        Last_Bill_Pay_TNAR__c: selectedAccount.Last_Bill_Pay_TNAR__c,
        Rent_Paid_Last_BP__c: selectedAccount.Rent_Paid_Last_BP__c,
        Bills_Paid_Last_BP__c: selectedAccount.Bills_Paid_Last_BP__c,
        Total_of_Bill_Pay_Users__c: selectedAccount.Total_of_Bill_Pay_Users__c,
      }
    : null;

  return (
    <div className="flex flex-col h-full w-full overflow-auto">
      {/* HEADER BAR — sticky dark header */}
      <header className="pitch-prep-header sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0f1623]">
        <div className="flex items-center gap-2">
          <span className="text-white text-xl font-bold">PitchPrep</span>
          <span className="text-gray-400 text-sm">by Flex</span>
        </div>
        <div className="flex items-center gap-4">
          {selectedAccount && (
            <span className="text-gray-400 text-sm">
              {selectedAccount.Name || "Selected Account"}
            </span>
          )}
          {(selectedAccount || activeTab > 0) && (
            <button
              type="button"
              onClick={handleStartOver}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Icon icon="rotate-ccw" />
              Start Over
            </button>
          )}
        </div>
      </header>

      {/* TAB BAR */}
      <nav className="pitch-prep-tabs sticky top-[56px] z-40 flex items-center gap-0 bg-white border-b border-gray-200 px-6">
        {TABS.map((tab) => {
          const enabled = isTabEnabled(tab.id);
          const active = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              disabled={!enabled}
              className={[
                "relative px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap",
                active
                  ? "text-[#0f1623]"
                  : enabled
                    ? "text-gray-500 hover:text-gray-800"
                    : "text-gray-300 cursor-not-allowed opacity-50",
              ].join(" ")}
            >
              {tab.label}
              {/* Active underline indicator */}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-[3px] rounded-t bg-[#00c896]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* MAIN CONTENT AREA */}
      <main
        className="flex-1 w-full"
        style={{ backgroundColor: "#f5f6f8", padding: "32px 24px" }}
      >
        {/* Step 1: Meeting Prep */}
        {activeTab === 0 && (
          <section className="max-w-5xl">
            {/* Selected account summary (collapsed view) */}
            {selectedAccount ? (
              <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-[#00c896] bg-[#00c896]/5 mb-8">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-gray-900">{selectedAccount.Name}</span>
                  <span className="text-xs text-gray-500">
                    {[selectedAccount.BillingCity, selectedAccount.BillingState].filter(Boolean).join(", ")}
                    {selectedAccount.Owner?.Name && ` · ${selectedAccount.Owner.Name}`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAccount(null)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Find your account</h2>
                <p className="text-sm text-gray-500 mb-4">Search for the company you're about to call.</p>

                {/* Search bar */}
                <div className="flex gap-2 mb-6">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={companySearch}
                      onChange={(e) => setCompanySearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      placeholder="Type a company name..."
                      className="w-full px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00c896]/30 focus:border-[#00c896]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSearch}
                    disabled={searching || !companySearch.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#00c896] text-white text-sm font-medium hover:bg-[#00b386] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Icon icon="search" />
                    Search
                  </button>
                </div>

                {/* Results */}
                {searching && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg px-5 py-6 justify-center">
                    <div className="h-4 w-4 border-2 border-gray-300 border-t-[#00c896] rounded-full animate-spin" />
                    Searching Salesforce…
                  </div>
                )}

                {/* Salesforce search error */}
                {!searching && searchError && (
                  <InlineErrorBanner
                    title="Search failed"
                    message={searchError}
                    onRetry={handleSearch}
                    isSalesforceAuth={isSalesforceAuthError}
                  />
                )}

                {!searching && !searchError && searchResults !== null && searchResults.length === 0 && (
                  <div className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg px-4 py-6 text-center">
                    No accounts found. Try a shorter name or an abbreviation.
                  </div>
                )}

                {!searching && !searchError && searchResults !== null && searchResults.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {searchResults.map((acct: Account) => (
                      <AccountSearchResult
                        key={acct.Id}
                        account={acct}
                        // @ts-expect-error TS narrows selectedAccount to never in ternary else branch
                        isSelected={selectedAccount?.Id === acct.Id}
                        onSelect={handleAccountSelect}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Deal Context Form — appears after account selection */}
            {selectedAccount && (
              <DealContextForm
                onSubmit={handleDealContextSubmit}
                loading={researchLoading}
              />
            )}
          </section>
        )}

        {/* Step 2: Account Intel */}
        {activeTab === 1 && (
          <section className="max-w-6xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Account Intelligence</h2>
            <p className="text-sm text-gray-500 mb-6">
              AI-powered research on {selectedAccount?.Name || "your account"}.
            </p>

            {/* Loading state */}
            {researchRunning && !researchData && (
              <ResearchLoadingSpinner companyName={selectedAccount?.Name} />
            )}

            {/* Error state */}
            {researchError && !researchRunning && (
              <InlineErrorBanner
                title="Research failed"
                message={researchError}
                retryLabel="Retry Research"
                onRetry={() => {
                  researchTriggeredRef.current = false;
                  setResearchError(null);
                  setResearchData(null);
                }}
              />
            )}

            {/* Results */}
            {researchData && !researchRunning && (
              <AccountIntelResults
                data={researchData}
                billPayData={billPayData}
                dataGaps={sfDataGaps}
                sfActivities={sfActivities}
                sfOpenOpportunities={sfOpenOpportunities}
              />
            )}
          </section>
        )}

        {/* Step 3: Pre-Call Brief */}
        {activeTab === 2 && (
          <section className="pitch-prep-brief-print max-w-6xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1 pitch-prep-hide-print">Pre-Call Brief</h2>
            <p className="text-sm text-gray-500 mb-6 pitch-prep-hide-print">
              Your rep-ready brief for {selectedAccount?.Name || "this account"}.
            </p>

            {/* Loading state — step indicator */}
            {(briefGenerating || (briefStep && !briefData && !briefError)) && !briefData && (
              <BriefLoadingIndicator step={briefStep} />
            )}

            {/* Error state */}
            {briefError && !briefGenerating && (
              <InlineErrorBanner
                title="Brief generation failed"
                message={briefError}
                retryLabel="Regenerate Brief"
                onRetry={() => {
                  setBriefError(null);
                  setBriefData(null);
                  briefFiredRef.current = false;
                  triggerBriefGeneration();
                }}
              />
            )}

            {/* Brief generated — full display */}
            {briefData && !briefGenerating && (
              <PreCallBriefDisplay
                data={briefData}
                onPracticePitch={handlePracticePitch}
              />
            )}
          </section>
        )}

        {/* Step 4: Pitch Practice — HIDDEN (In Development) */}
        {/* To re-enable: uncomment tab id:3 in TABS array and restore this section */}
        {false && activeTab === 3 && (
          <section className="max-w-6xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Pitch Practice</h2>
            <p className="text-sm text-gray-500 mb-4">
              Roleplay your call with an AI prospect. Practice makes perfect.
            </p>
            <PitchPractice
              briefText={briefText}
              companyName={selectedAccount?.Name || "the prospect"}
              briefData={briefData}
            />
          </section>
        )}
      </main>
    </div>
  );
}
