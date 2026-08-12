import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type PermissionState = Record<string, Record<string, boolean>>;

const defaultPermissions: PermissionState = {
  Dashboard: {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": true,
    "Sales Manager": true,
    AE: true,
    SDR: true,
  },
  "Pre-Call Prep": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": false,
    "Sales Manager": false,
    AE: false,
    SDR: false,
  },
  Leaderboard: {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": false,
    "Sales Manager": true,
    AE: true,
    SDR: false,
  },
  "Pricing Calculator": {
    Admin: true,
    "Senior Manager": true,
    "RevOps Lead": true,
    "Sales Manager": true,
    AE: true,
    SDR: true,
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
