import { useState, useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import TagMultiSelect from "./TagMultiSelect";

const MARKET_OPTIONS = [
  "National",
  "Northeast",
  "Southeast",
  "Midwest",
  "Southwest",
  "Mountain West",
  "West Coast",
  "Other",
];

const ROOM_ROLES = [
  "CFO",
  "COO",
  "Asset Manager",
  "Regional Ops",
  "VP of Operations",
  "Property Manager",
  "Other",
];

const FOCUS_AREAS = [
  "NOI & Revenue",
  "Delinquency & Collections",
  "Resident Retention",
  "Leasing Competitiveness",
  "Operational Efficiency",
  "Resident Experience",
  "Other",
];

const CONCERNS = [
  "Late fee revenue loss",
  "Tech fatigue / implementation burden",
  "Owner / board buy-in",
  "Staff bandwidth",
  "Compliance risk",
  "Other",
];

export type DealContextData = {
  attendees: string;
  buyerPersonas: string[];
  focusAreas: string[];
  knownConcerns: string;
  marketFocus: string;
  additionalNotes: string;
};

type DealContextFormProps = {
  onSubmit: (data: DealContextData) => void;
  loading: boolean;
};

export default function DealContextForm({ onSubmit, loading }: DealContextFormProps) {
  const [attendees, setAttendees] = useState("");
  const [roomRoles, setRoomRoles] = useState<string[]>([]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [concerns, setConcerns] = useState<string[]>([]);
  const [marketFocus, setMarketFocus] = useState("National");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const handleSubmit = useCallback(() => {
    onSubmit({
      attendees,
      buyerPersonas: roomRoles,
      focusAreas,
      knownConcerns: concerns.join(", "),
      marketFocus,
      additionalNotes,
    });
  }, [attendees, roomRoles, focusAreas, concerns, marketFocus, additionalNotes, onSubmit]);

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* Market Focus */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">Market focus</h4>
        <p className="text-xs text-gray-500 mb-3">Where is this account's portfolio concentrated?</p>
        <TagMultiSelect
          options={MARKET_OPTIONS}
          selected={[marketFocus]}
          onChange={(sel) => setMarketFocus(sel[sel.length - 1] || "National")}
        />
      </div>

      {/* Who's on the call */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">
          Who's on the call? <span className="font-normal text-gray-400">(optional)</span>
        </h4>
        <p className="text-xs text-gray-500 mb-3">Enter attendee names so we can look them up — one per line</p>
        <textarea
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          placeholder="Jane Smith&#10;John Doe"
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00c896]/30 focus:border-[#00c896] resize-none"
        />
      </div>

      {/* Who's in the room — roles */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">Who's in the room?</h4>
        <p className="text-xs text-gray-500 mb-3">Select all personas attending</p>
        <TagMultiSelect
          options={ROOM_ROLES}
          selected={roomRoles}
          onChange={setRoomRoles}
        />
      </div>

      {/* Focus Areas */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">What are they focused on improving?</h4>
        <p className="text-xs text-gray-500 mb-3">Select all that apply</p>
        <TagMultiSelect
          options={FOCUS_AREAS}
          selected={focusAreas}
          onChange={setFocusAreas}
        />
      </div>

      {/* Concerns */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">
          What are they worried about? <span className="font-normal text-gray-400">(optional)</span>
        </h4>
        <p className="text-xs text-gray-500 mb-3">Select all that apply — skip if you're not sure yet</p>
        <TagMultiSelect
          options={CONCERNS}
          selected={concerns}
          onChange={setConcerns}
        />
      </div>

      {/* Additional Notes */}
      <div>
        <h4 className="text-sm font-semibold text-gray-900 mb-0.5">
          Anything else? <span className="font-normal text-gray-400">(optional)</span>
        </h4>
        <p className="text-xs text-gray-500 mb-3">Context the AI should know going into this call</p>
        <textarea
          value={additionalNotes}
          onChange={(e) => setAdditionalNotes(e.target.value)}
          placeholder="E.g. they're evaluating a competitor, recently acquired properties, etc."
          rows={3}
          className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#00c896]/30 focus:border-[#00c896] resize-none"
        />
      </div>

      {/* Submit button */}
      <div className="pt-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#00c896] text-white text-sm font-semibold hover:bg-[#00b386] disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <>
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Researching…
            </>
          ) : (
            <>
              Research Account
              <Icon icon="arrow-right" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
