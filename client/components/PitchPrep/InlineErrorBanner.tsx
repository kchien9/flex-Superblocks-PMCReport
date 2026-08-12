import { Icon } from "@/components/ui/icon";

interface InlineErrorBannerProps {
  title: string;
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  /** If true, shows "Reconnect Salesforce" style button instead of default retry */
  isSalesforceAuth?: boolean;
}

export default function InlineErrorBanner({
  title,
  message,
  onRetry,
  retryLabel = "Try Again",
  isSalesforceAuth = false,
}: InlineErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-red-500">
          <Icon icon="alert-circle" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800 mb-1">{title}</p>
          {!isSalesforceAuth && (
            <p className="text-sm text-red-600 break-words">{message}</p>
          )}
          {isSalesforceAuth && (
            <p className="text-sm text-red-600">
              Your Salesforce session has expired. Please reconnect to continue.
            </p>
          )}
          <button
            type="button"
            onClick={onRetry}
            className={[
              "mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors",
              isSalesforceAuth
                ? "bg-blue-100 text-blue-800 hover:bg-blue-200"
                : "bg-red-100 text-red-800 hover:bg-red-200",
            ].join(" ")}
          >
            <Icon icon={isSalesforceAuth ? "link" : "refresh-cw"} />
            {isSalesforceAuth ? "Reconnect Salesforce" : retryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
