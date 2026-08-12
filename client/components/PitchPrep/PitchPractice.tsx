import { useState, useCallback, useRef, useEffect } from "react";
import { useApi } from "@/hooks/useApi.js";
import { toast } from "sonner";

type PracticeMode = "open_call" | "objection_drill" | "opener_only";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: string[];
}

interface PitchPracticeProps {
  briefText: string;
  companyName: string;
  briefData?: Record<string, any> | null;
}

const MODES: { id: PracticeMode; label: string; description: string }[] = [
  {
    id: "open_call",
    label: "Open Call",
    description: "Natural conversation. Claude plays a realistic PMC prospect.",
  },
  {
    id: "objection_drill",
    label: "Objection Drill",
    description: "Claude pushes back hard on every statement. Good for pressure testing.",
  },
  {
    id: "opener_only",
    label: "Opener Only",
    description: "Send your opening line. Claude evaluates it and suggests improvements.",
  },
];

export default function PitchPractice({ briefText, companyName, briefData }: PitchPracticeProps) {
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("open_call");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const { run: sendMessage, loading: sending } = useApi("PracticeChat");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const handleSend = useCallback(
    async (text?: string) => {
      const messageText = text ?? inputValue.trim();
      if (!messageText || sending) return;

      setInputValue("");

      const userMessage: ChatMessage = { role: "user", content: messageText };
      const updatedHistory = [...chatHistory, userMessage];
      setChatHistory(updatedHistory);

      try {
        const result = await sendMessage({
          mode: practiceMode,
          messages: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
          companyContext: briefText,
          briefContext: briefData ?? null,
        });

        if (result) {
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: result.response,
            suggestions: result.suggestions,
          };
          setChatHistory([...updatedHistory, assistantMessage]);
        }
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Chat failed: " + message);
      }
    },
    [inputValue, sending, chatHistory, practiceMode, briefText, sendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleModeChange = useCallback((mode: PracticeMode) => {
    setPracticeMode(mode);
    setChatHistory([]);
    setInputValue("");
  }, []);

  const handleReset = useCallback(() => {
    setChatHistory([]);
    setInputValue("");
    textareaRef.current?.focus();
  }, []);

  const handleSuggestionClick = useCallback(
    (phrase: string) => {
      setInputValue(phrase);
      textareaRef.current?.focus();
    },
    []
  );

  const activeMode = MODES.find((m) => m.id === practiceMode)!;

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] max-h-[700px]">
      {/* MODE SELECTOR */}
      <div className="flex-shrink-0 mb-4">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => handleModeChange(mode.id)}
              className={[
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                practiceMode === mode.id
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-800",
              ].join(" ")}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2 ml-1">{activeMode.description}</p>
      </div>

      {/* CHAT WINDOW */}
      <div className="flex-1 overflow-y-auto bg-white border border-gray-200 rounded-xl px-4 py-4 space-y-4 min-h-0">
        {chatHistory.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-400 max-w-sm">
              <p className="text-sm font-medium mb-1">Ready to practice</p>
              <p className="text-xs">
                {practiceMode === "opener_only"
                  ? "Type your opening line and Claude will evaluate it."
                  : `Type your opening line to start the call with ${companyName}.`}
              </p>
            </div>
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div key={i}>
            {msg.role === "assistant" ? (
              /* Prospect (Claude) message — left aligned */
              <div className="flex items-start gap-2 max-w-[85%]">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0f1623] text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
                  P
                </div>
                <div>
                  <span className="text-[10px] text-gray-500 font-medium block mb-1">
                    PMC Prospect
                  </span>
                  <div className="bg-[#0f1623] text-white text-sm rounded-xl rounded-tl-sm px-4 py-2.5 leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                  {/* Suggested phrases */}
                  {msg.suggestions && msg.suggestions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {msg.suggestions.map((phrase, j) => (
                        <button
                          key={j}
                          type="button"
                          onClick={() => handleSuggestionClick(phrase)}
                          disabled={sending}
                          className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50 text-left leading-snug max-w-[280px]"
                        >
                          {phrase}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Rep message — right aligned */
              <div className="flex justify-end">
                <div className="bg-blue-600 text-white text-sm rounded-xl rounded-tr-sm px-4 py-2.5 max-w-[75%] leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {sending && (
          <div className="flex items-start gap-2 max-w-[85%]">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0f1623] text-white flex items-center justify-center text-[10px] font-bold mt-0.5">
              P
            </div>
            <div>
              <span className="text-[10px] text-gray-500 font-medium block mb-1">
                PMC Prospect
              </span>
              <div className="bg-[#0f1623] text-white text-sm rounded-xl rounded-tl-sm px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="flex-shrink-0 mt-3 flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type what you'd say..."
            rows={2}
            disabled={sending}
            className="w-full resize-none px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00c896]/30 focus:border-[#00c896] disabled:opacity-50"
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleSend()}
            disabled={sending || !inputValue.trim()}
            className="px-5 py-3 rounded-xl bg-[#00c896] text-white text-sm font-semibold hover:bg-[#00b386] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={sending}
            className="px-5 py-2 rounded-xl border border-gray-200 text-gray-500 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
