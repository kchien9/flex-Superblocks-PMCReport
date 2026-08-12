import { memo } from "react";

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
  // Bill Pay fields (actual SF field names)
  Last_Bill_Pay_Charged_Users__c: number | null;
  Last_Bill_Pay_NAR__c: number | null;
  Last_Bill_Pay_TNAR__c: number | null;
  Rent_Paid_Last_BP__c: number | null;
  Bills_Paid_Last_BP__c: number | null;
  Total_of_Bill_Pay_Users__c: number | null;
  Owner: { Name: string } | null;
};

type AccountSearchResultProps = {
  account: Account;
  isSelected: boolean;
  onSelect: (account: Account) => void;
};

const AccountSearchResult = memo(function AccountSearchResult({
  account,
  isSelected,
  onSelect,
}: AccountSearchResultProps) {
  const location = [account.BillingCity, account.BillingState]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      onClick={() => onSelect(account)}
      className={[
        "w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all text-left",
        isSelected
          ? "border-[#00c896] bg-[#00c896]/5 shadow-sm"
          : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="font-semibold text-sm text-gray-900">
          {account.Name}
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          {location && <span>{location}</span>}
          {account.Owner?.Name && (
            <span>Owner: {account.Owner.Name}</span>
          )}
          {account.Website && (
            <span className="truncate max-w-[180px]">{account.Website.replace(/^https?:\/\//, "")}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 ml-3 flex-shrink-0">
        {account.Total_Company_Units__c != null && (
          <div className="flex flex-col items-end">
            <span className="text-xs font-medium text-gray-700">{account.Total_Company_Units__c.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">Units</span>
          </div>
        )}
        {account.Total_Units_on_Flex__c != null && account.Total_Units_on_Flex__c > 0 && (
          <div className="flex flex-col items-end">
            <span className="text-xs font-medium text-[#00c896]">{account.Total_Units_on_Flex__c.toLocaleString()}</span>
            <span className="text-[10px] text-gray-400">On Flex</span>
          </div>
        )}
        {account.Sales_Segment__c && (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
            {account.Sales_Segment__c}
          </span>
        )}
      </div>
    </button>
  );
});

export default AccountSearchResult;
export type { Account };
