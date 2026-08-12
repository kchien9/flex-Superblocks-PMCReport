import { Icon } from "@/components/ui/icon";

interface ResearchData {
  company_name?: string;
  hq_location?: string;
  units_managed?: string;
  pm_software?: string;
  business_model?: string;
  asset_class?: string;
  portfolio_type?: string;
  housing_types?: string[];
  markets_operated?: string[];
  market_headwinds?: { headline: string; summary: string }[];
  recent_news?: { headline: string; summary: string; source_url?: string }[];
  pain_points?: (string | { point: string; detail?: string; source?: string; headline?: string; summary?: string })[];
  company_website_notes?: string;
  contacts?: {
    name: string;
    title: string;
    background?: string;
    linkedin_url?: string;
    prep_note?: string;
  }[];
  relationship_summary?: string;
  open_opportunity?: {
    name?: string;
    amount?: string;
    stage?: string;
    next_steps?: string;
    type?: string;
  };
  closed_lost_history?: {
    name?: string;
    close_date?: string;
    loss_reason?: string;
    contacts?: string[];
    discovery_notes?: string;
  }[];
  summary?: string;
}

interface BillPayData {
  Last_Bill_Pay_Charged_Users__c?: number | null;
  Last_Bill_Pay_NAR__c?: number | null;
  Last_Bill_Pay_TNAR__c?: number | null;
  Rent_Paid_Last_BP__c?: number | null;
  Bills_Paid_Last_BP__c?: number | null;
  Total_of_Bill_Pay_Users__c?: number | null;
}

interface AccountIntelResultsProps {
  data: ResearchData;
  billPayData?: BillPayData | null;
  dataGaps?: string[];
  sfActivities?: { Subject?: string; ActivityDate?: string; Status?: string; Description?: string }[];
  sfOpenOpportunities?: { Name?: string; Amount?: number; StageName?: string; Type?: string; NextStep?: string }[];
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
      <span className="text-xs text-gray-500 block mb-0.5">{label}</span>
      <span className="text-sm font-semibold text-gray-900 leading-snug">{value}</span>
    </div>
  );
}

function NewsCard({ headline, summary, sourceUrl }: { headline: string; summary: string; sourceUrl?: string }) {
  return (
    <div className="flex-shrink-0 w-[320px] bg-white border border-gray-200 rounded-lg p-4 flex flex-col justify-between">
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-1.5 line-clamp-2">{headline}</p>
        <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{summary}</p>
      </div>
      {sourceUrl && (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#00c896] hover:underline mt-3"
        >
          Source →
        </a>
      )}
    </div>
  );
}

function PainPointCard({ point, detail, source }: { point: string; detail?: string; source?: string }) {
  return (
    <div className="bg-white border border-gray-200 border-l-4 border-l-amber-400 rounded-lg px-4 py-3">
      <p className="text-sm font-semibold text-gray-900 mb-1">{point}</p>
      {detail && <p className="text-xs text-gray-600 leading-relaxed mb-1.5">{detail}</p>}
      {source && (
        <span className="inline-block text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
          {source}
        </span>
      )}
    </div>
  );
}

function HeadwindCard({ headline, summary }: { headline: string; summary: string }) {
  return (
    <div className="bg-white border border-gray-200 border-l-4 border-l-red-400 rounded-lg px-4 py-3">
      <p className="text-sm font-semibold text-gray-900 mb-1">{headline}</p>
      <p className="text-xs text-gray-600 leading-relaxed">{summary}</p>
    </div>
  );
}

function ContactCard({
  name,
  title,
  background,
  linkedinUrl,
  prepNote,
}: {
  name: string;
  title: string;
  background?: string;
  linkedinUrl?: string;
  prepNote?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 bg-[#00c896]/10 text-[#00c896] rounded-full flex items-center justify-center text-sm font-semibold">
          {name?.charAt(0) || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{name}</span>
            {linkedinUrl && (
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                LinkedIn
              </a>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{title}</p>
          {background && (
            <p className="text-xs text-gray-600 mt-2 leading-relaxed">{background}</p>
          )}
        </div>
      </div>
      {prepNote && (
        <div className="mt-3 bg-[#00c896]/5 border border-[#00c896]/20 rounded-md px-3 py-2">
          <p className="text-xs text-gray-500 font-medium mb-0.5">Prep Note</p>
          <p className="text-xs text-gray-800 leading-relaxed">{prepNote}</p>
        </div>
      )}
    </div>
  );
}

export default function AccountIntelResults({
  data,
  billPayData,
  dataGaps,
  sfActivities,
  sfOpenOpportunities,
}: AccountIntelResultsProps) {
  const hasBillPay = billPayData && (billPayData.Total_of_Bill_Pay_Users__c || billPayData.Bills_Paid_Last_BP__c);

  return (
    <div className="space-y-8">
      {/* DATA GAPS NUDGE STRIP */}
      {dataGaps && dataGaps.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <div className="flex items-start gap-2">
            <Icon icon="alert-triangle" className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-amber-800 mb-1">Missing from Salesforce</p>
              <div className="flex flex-wrap gap-1.5">
                {dataGaps.map((gap, i) => (
                  <span
                    key={i}
                    className="inline-block px-2 py-0.5 rounded bg-amber-100 text-[10px] font-medium text-amber-700"
                  >
                    {gap}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* METRICS GRID */}
      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Company Snapshot
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <MetricTile label="HQ Location" value={data.hq_location || "—"} />
          <MetricTile label="Units Managed" value={data.units_managed || "—"} />
          <MetricTile label="PMS" value={data.pm_software || "—"} />
          <MetricTile label="Business Model" value={data.business_model || "—"} />
          <MetricTile label="Asset Class" value={data.asset_class || "—"} />
          <MetricTile label="Portfolio Type" value={data.portfolio_type || "—"} />
          {data.housing_types && data.housing_types.length > 0 && (
            <MetricTile label="Housing Types" value={data.housing_types.join(", ")} />
          )}
          <MetricTile
            label="Markets Operated"
            value={data.markets_operated?.join(", ") || "—"}
          />
        </div>
      </section>

      {/* BILL PAY BLOCK */}
      {hasBillPay && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="credit-card" />
            Flex Bill Pay
          </h3>
          <div className="bg-[#00c896]/5 border border-[#00c896]/20 rounded-lg p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {billPayData.Total_of_Bill_Pay_Users__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">Total BP Users</span>
                  <span className="text-sm font-semibold text-gray-900">{billPayData.Total_of_Bill_Pay_Users__c.toLocaleString()}</span>
                </div>
              )}
              {billPayData.Last_Bill_Pay_Charged_Users__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">Charged Users (Last)</span>
                  <span className="text-sm font-semibold text-gray-900">{billPayData.Last_Bill_Pay_Charged_Users__c.toLocaleString()}</span>
                </div>
              )}
              {billPayData.Last_Bill_Pay_NAR__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">NAR %</span>
                  <span className="text-sm font-semibold text-gray-900">{billPayData.Last_Bill_Pay_NAR__c.toFixed(1)}%</span>
                </div>
              )}
              {billPayData.Last_Bill_Pay_TNAR__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">TNAR %</span>
                  <span className="text-sm font-semibold text-gray-900">{billPayData.Last_Bill_Pay_TNAR__c.toFixed(1)}%</span>
                </div>
              )}
              {billPayData.Rent_Paid_Last_BP__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">Rent Paid (Last BP)</span>
                  <span className="text-sm font-semibold text-gray-900">${billPayData.Rent_Paid_Last_BP__c.toLocaleString()}</span>
                </div>
              )}
              {billPayData.Bills_Paid_Last_BP__c != null && (
                <div>
                  <span className="text-[10px] font-semibold text-gray-500 uppercase block mb-0.5">Bills Paid (Last BP)</span>
                  <span className="text-sm font-semibold text-gray-900">{billPayData.Bills_Paid_Last_BP__c.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* OPEN OPPORTUNITY */}
      {data.open_opportunity && data.open_opportunity.name && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="target" />
            Open Opportunity
          </h3>
          <div className="bg-white border border-gray-200 border-l-4 border-l-[#00c896] rounded-lg p-4">
            <p className="text-sm font-semibold text-gray-900 mb-2">{data.open_opportunity.name}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {data.open_opportunity.type && (
                <div>
                  <span className="text-gray-500 block">Type</span>
                  <span className="font-medium text-gray-900">{data.open_opportunity.type}</span>
                </div>
              )}
              {data.open_opportunity.amount && (
                <div>
                  <span className="text-gray-500 block">Amount</span>
                  <span className="font-medium text-gray-900">{data.open_opportunity.amount}</span>
                </div>
              )}
              {data.open_opportunity.stage && (
                <div>
                  <span className="text-gray-500 block">Stage</span>
                  <span className="font-medium text-gray-900">{data.open_opportunity.stage}</span>
                </div>
              )}
              {data.open_opportunity.next_steps && (
                <div className="col-span-2 sm:col-span-4">
                  <span className="text-gray-500 block">Next Steps</span>
                  <span className="font-medium text-gray-900">{data.open_opportunity.next_steps}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* SF OPEN OPPORTUNITIES (raw from Salesforce) */}
      {sfOpenOpportunities && sfOpenOpportunities.length > 0 && !data.open_opportunity?.name && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="target" />
            Open Opportunities
          </h3>
          <div className="space-y-2">
            {sfOpenOpportunities.map((opp, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{opp.Name}</p>
                  <p className="text-xs text-gray-500">{opp.StageName}{opp.Type ? ` · ${opp.Type}` : ""}</p>
                </div>
                {opp.Amount != null && (
                  <span className="text-sm font-semibold text-[#00c896]">${opp.Amount.toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RELATIONSHIP SUMMARY */}
      {data.relationship_summary && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="handshake" />
            Relationship Summary
          </h3>
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 border-l-4 border-l-blue-400">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{data.relationship_summary}</p>
            {sfActivities && sfActivities.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-3">
                Based on {sfActivities.length} Salesforce activities in the last 180 days
              </p>
            )}
          </div>
        </section>
      )}

      {/* PRIOR DEAL HISTORY (CLOSED-LOST) */}
      {data.closed_lost_history && data.closed_lost_history.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="history" />
            Prior Deal History
          </h3>
          <div className="space-y-3">
            {data.closed_lost_history.map((deal, i) => (
              <div key={i} className="bg-white border border-gray-200 border-l-4 border-l-red-300 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-semibold text-gray-900">{deal.name || "Past Opportunity"}</p>
                  {deal.close_date && (
                    <span className="text-xs text-gray-400 flex-shrink-0">{deal.close_date}</span>
                  )}
                </div>
                {deal.loss_reason && (
                  <p className="text-xs text-red-600 font-medium mb-1">Loss Reason: {deal.loss_reason}</p>
                )}
                {deal.discovery_notes && (
                  <p className="text-xs text-gray-600 leading-relaxed mb-1">{deal.discovery_notes}</p>
                )}
                {deal.contacts && deal.contacts.length > 0 && (
                  <p className="text-xs text-gray-500 mt-1">Contacts involved: {deal.contacts.join(", ")}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* RECENT NEWS — horizontal scroll */}
      {data.recent_news && data.recent_news.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="newspaper" />
            Recent News
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {data.recent_news.map((news, i) => (
              <NewsCard
                key={i}
                headline={news.headline}
                summary={news.summary}
                sourceUrl={news.source_url}
              />
            ))}
          </div>
        </section>
      )}

      {/* MARKET HEADWINDS — separate from Pain Points */}
      {data.market_headwinds && data.market_headwinds.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="trending-down" />
            Market Headwinds
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.market_headwinds.map((hw, i) => (
              <HeadwindCard key={i} headline={hw.headline} summary={hw.summary} />
            ))}
          </div>
        </section>
      )}

      {/* PAIN POINTS — 2 column grid */}
      {data.pain_points && data.pain_points.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="alert-triangle" />
            Pain Points
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.pain_points.map((pp, i) => {
              if (typeof pp === "string") {
                return <PainPointCard key={i} point={pp} />;
              }
              // Handle both new format (point/detail/source) and legacy (headline/summary)
              const point = pp.point || pp.headline || "";
              const detail = pp.detail || pp.summary || "";
              const source = pp.source;
              return <PainPointCard key={i} point={point} detail={detail} source={source} />;
            })}
          </div>
        </section>
      )}

      {/* FROM THEIR WEBSITE — italic quote style */}
      {data.company_website_notes && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            From Their Website
          </h3>
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 border-l-4 border-l-gray-300">
            <p className="text-sm text-gray-700 italic leading-relaxed">
              {data.company_website_notes}
            </p>
          </div>
        </section>
      )}

      {/* PEOPLE ON THE CALL */}
      {data.contacts && data.contacts.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Icon icon="users" />
            People on the Call
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {data.contacts.map((contact, i) => (
              <ContactCard
                key={i}
                name={contact.name}
                title={contact.title}
                background={contact.background}
                linkedinUrl={contact.linkedin_url}
                prepNote={contact.prep_note}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
