import { createBrowserRouter } from "react-router";

import { PageNotFound, RouteLoadError } from "@superblocksteam/library";

import RegisteredApp from "./App.js";

export const router = createBrowserRouter([
  {
    Component: RegisteredApp,
    errorElement: <RouteLoadError />,
    children: [
      {
        path: "/",
        index: true,
        lazy: () =>
          import("./pages/Dashboard/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/pricing-calculator",
        lazy: () =>
          import("./pages/PricingCalculator/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/leaderboard",
        lazy: () =>
          import("./pages/Leaderboard/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/psm-dashboard",
        lazy: () =>
          import("./pages/PSMDashboard/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/opportunity-data-quality",
        lazy: () =>
          import("./pages/OpportunityDataQuality/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/psm-dashboard/:pmcId",
        lazy: () =>
          import("./pages/PMCDetail/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/user-management",
        lazy: () =>
          import("./pages/UserManagement/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/permissions",
        lazy: () =>
          import("./pages/Permissions/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/audit-log",
        lazy: () =>
          import("./pages/AuditLog/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/module-registry",
        lazy: () =>
          import("./pages/ModuleRegistry/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/skills-registry",
        lazy: () =>
          import("./pages/SkillsRegistry/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/content-library",
        lazy: () =>
          import("./pages/ContentLibrary/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/pitch-prep",
        lazy: () =>
          import("./pages/PitchPrep/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "/pmc-monthly-report",
        lazy: () =>
          import("./pages/PMCMonthlyReport/index.js").then((mod) => {
            const Component = mod.default;
            return { Component };
          }),
      },
      {
        path: "*",
        Component: () => {
          const currentPath = window.location.pathname;
          return (
            <PageNotFound
              title="Page not found"
              errorMessage={
                currentPath === "/" ? (
                  <span>
                    The <strong>/</strong> route has been deleted from this
                    application. Please try another URL or contact your
                    developer for assistance.
                  </span>
                ) : (
                  "Content not found"
                )
              }
              hideActions={currentPath === "/"}
              buttonPath={"/"}
              buttonText={"Return to application"}
            />
          );
        },
      },
    ],
  },
]);
