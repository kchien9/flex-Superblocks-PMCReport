import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "react-router";
import { useApi } from "@/hooks/useApi.js";
import { toast } from "sonner";
import { MessageSquare, X, Send } from "lucide-react";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();

  const { run: submitFeedback, loading } = useApi("SubmitFeedback");

  // Derive page name from route
  const pageName = getPageName(location.pathname);

  // Focus textarea when opening
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  // Auto-close after showing thank you
  useEffect(() => {
    if (submitted) {
      const timer = setTimeout(() => {
        setSubmitted(false);
        setOpen(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [submitted]);

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || loading) return;
    try {
      await submitFeedback({ page: pageName, message: message.trim() });
      setMessage("");
      setSubmitted(true);
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Something went wrong. Please try again.";
      toast.error(msg);
    }
  }, [message, loading, submitFeedback, pageName]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {/* Popup */}
      {open && (
        <div className="absolute bottom-14 right-0 w-80 rounded-lg shadow-xl border border-gray-200 bg-white overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#2C194D]">
            <span className="text-sm font-medium text-white">Send Feedback</span>
            <button
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="p-4">
            {submitted ? (
              <div className="flex flex-col items-center py-6 gap-2">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-900">Thanks for your feedback!</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  Sharing from <span className="font-medium text-gray-700">{pageName}</span>
                </p>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="What's on your mind? Bug, idea, or general feedback..."
                  className="w-full h-24 px-3 py-2 text-sm border border-gray-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-[#6A3DB8]/30 focus:border-[#6A3DB8] placeholder:text-gray-400"
                />
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-400">
                    Press Enter to send
                  </span>
                  <button
                    onClick={handleSubmit}
                    disabled={!message.trim() || loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6A3DB8] rounded-md hover:bg-[#5a3399] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send size={12} />
                    )}
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-12 h-12 rounded-full bg-[#6A3DB8] hover:bg-[#5a3399] text-white shadow-lg flex items-center justify-center transition-all hover:scale-105"
        title="Send feedback"
      >
        {open ? <X size={20} /> : <MessageSquare size={20} />}
      </button>
    </div>
  );
}

function getPageName(pathname: string): string {
  const map: Record<string, string> = {
    "/": "Home",
    "/leaderboard": "Leaderboard",
    "/opportunity-data-quality": "Opp Data Quality",
    "/pricing-calculator": "Pricing Calculator",
    "/pitch-prep": "PitchPrep",
    "/psm-dashboard": "PSM Dashboard",
    "/pmc-monthly-report": "PMC Monthly Report",
    "/permissions": "Permissions",
    "/audit-log": "Audit Log",
    "/module-registry": "Module Registry",
    "/skills-registry": "Skills Registry",
    "/content-library": "Content Library",
    "/user-management": "User Management",
    "/feedback": "Feedback",
  };
  return map[pathname] || pathname;
}
