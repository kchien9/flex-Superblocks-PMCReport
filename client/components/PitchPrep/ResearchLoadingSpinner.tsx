import { useState, useEffect } from "react";

const STATUS_MESSAGES = [
  "Searching the web…",
  "Pulling Salesforce data…",
  "Analyzing pain points…",
  "Building your brief…",
];

interface ResearchLoadingSpinnerProps {
  companyName?: string;
}

export default function ResearchLoadingSpinner({ companyName }: ResearchLoadingSpinnerProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      {/* Large spinner */}
      <div className="relative mb-6">
        <div className="h-14 w-14 border-4 border-gray-200 border-t-[#00c896] rounded-full animate-spin" />
      </div>

      {/* Rotating status message */}
      <p className="text-base font-medium text-gray-700 mb-1 transition-all duration-300">
        {STATUS_MESSAGES[messageIndex]}
      </p>
      {companyName && (
        <p className="text-sm text-gray-400">
          Researching {companyName}
        </p>
      )}

      {/* Skeleton cards below */}
      <div className="w-full max-w-lg mt-8 space-y-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="bg-white border border-gray-200 rounded-lg p-5 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
            <div className="h-3 bg-gray-100 rounded w-full mb-2" />
            <div className="h-3 bg-gray-100 rounded w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
