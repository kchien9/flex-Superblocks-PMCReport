import { Outlet } from "react-router";

import { App as AppProvider } from "@superblocksteam/library";

import { Toaster } from "./components/common/sonner";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import ImpersonationBanner from "./components/ImpersonationBanner";
import { ImpersonationProvider } from "./context/ImpersonationContext";
import { PermissionsProvider } from "./context/PermissionsContext";

export default function AppComponent() {
  return (
    <>
      {/* Do not remove the AppProvider */}
      <AppProvider className="h-full w-full">
        <PermissionsProvider>
        <ImpersonationProvider>
          <div className="flex flex-col h-full w-full overflow-hidden">
            {/* Impersonation banner - spans full width above everything */}
            <ImpersonationBanner />

            <div className="flex flex-1 min-h-0">
              {/* Persistent sidebar */}
              <Sidebar />

              {/* Main content area */}
              <div className="flex flex-col flex-1 h-full min-w-0" style={{ backgroundColor: "#F7F7F7" }}>
                {/* Top bar */}
                <TopBar />

                {/* Page content */}
                <div className="flex-1 overflow-auto">
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        </ImpersonationProvider>
        </PermissionsProvider>
      </AppProvider>
      <Toaster />
    </>
  );
}
