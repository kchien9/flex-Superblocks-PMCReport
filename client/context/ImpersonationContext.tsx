import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export type ImpersonatedUser = {
  name: string;
  role: string;
};

export type AuditEntry = {
  timestamp: string;
  actor: string;
  action: "Started impersonation" | "Ended impersonation";
  targetUser: string;
  sessionDuration: string;
  details: string;
};

type ImpersonationContextType = {
  impersonating: ImpersonatedUser | null;
  sessionStartTime: number | null;
  auditEntries: AuditEntry[];
  startImpersonation: (user: ImpersonatedUser) => void;
  endImpersonation: () => void;
};

const ImpersonationContext = createContext<ImpersonationContextType>({
  impersonating: null,
  sessionStartTime: null,
  auditEntries: [],
  startImpersonation: () => {},
  endImpersonation: () => {},
});

function formatTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const [impersonating, setImpersonating] = useState<ImpersonatedUser | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  // Refs to avoid stale closures in stable callbacks
  const impersonatingRef = useRef<ImpersonatedUser | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);

  const startImpersonation = useCallback((user: ImpersonatedUser) => {
    const now = Date.now();
    impersonatingRef.current = user;
    sessionStartTimeRef.current = now;
    setImpersonating(user);
    setSessionStartTime(now);
    setAuditEntries((prev) => [
      {
        timestamp: formatTimestamp(),
        actor: "Kumbi Murinda",
        action: "Started impersonation",
        targetUser: user.name,
        sessionDuration: "—",
        details: "—",
      },
      ...prev,
    ]);
  }, []);

  const endImpersonation = useCallback(() => {
    const currentUser = impersonatingRef.current;
    const startTime = sessionStartTimeRef.current;
    if (!currentUser || !startTime) return;

    const durationMs = Date.now() - startTime;
    const durationMin = Math.round(durationMs / 60000);
    const durationStr = durationMin < 1 ? "< 1 min" : `${durationMin} min`;

    setAuditEntries((prev) => [
      {
        timestamp: formatTimestamp(),
        actor: "Kumbi Murinda",
        action: "Ended impersonation",
        targetUser: currentUser.name,
        sessionDuration: durationStr,
        details: "Manual exit",
      },
      ...prev,
    ]);

    impersonatingRef.current = null;
    sessionStartTimeRef.current = null;
    setImpersonating(null);
    setSessionStartTime(null);
  }, []);

  return (
    <ImpersonationContext.Provider
      value={{ impersonating, sessionStartTime, auditEntries, startImpersonation, endImpersonation }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
