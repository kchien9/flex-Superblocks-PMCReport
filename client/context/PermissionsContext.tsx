import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type PermissionState = Record<string, Record<string, boolean>>;

const defaultPermissions: PermissionState = {
  Leaderboard: {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": false,
    "Sales Manager": true,
    AE: true,
    SDR: false,
    PSM: false,
  },
  "Opp Data Quality": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": true,
    "Sales Manager": true,
    AE: true,
    SDR: true,
    PSM: false,
  },
  "Pricing Calculator": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": true,
    "Sales Manager": true,
    AE: true,
    SDR: true,
    PSM: false,
  },
  PitchPrep: {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": false,
    "Sales Manager": false,
    AE: true,
    SDR: true,
    PSM: false,
  },
  "PMC Monthly Report": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": true,
    "Sales Manager": true,
    AE: true,
    SDR: false,
    PSM: true,
  },
  "PSM Dashboard": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": false,
    "Sales Manager": false,
    AE: false,
    SDR: false,
    PSM: true,
  },
};

type PermissionsContextType = {
  savedPermissions: PermissionState;
  savePermissions: (permissions: PermissionState) => void;
};

const PermissionsContext = createContext<PermissionsContextType>({
  savedPermissions: defaultPermissions,
  savePermissions: () => {},
});

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [savedPermissions, setSavedPermissions] = useState<PermissionState>(defaultPermissions);

  const savePermissions = useCallback((permissions: PermissionState) => {
    setSavedPermissions(permissions);
  }, []);

  return (
    <PermissionsContext.Provider value={{ savedPermissions, savePermissions }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}

export { defaultPermissions };
