import { route } from "./utils.js";

const G2_ROUTES = [
  "/tasks", "/requests", "/projects", "/meetings", "/announcements", "/documents",
  "/tickets", "/leave", "/hr/lifecycle", "/finance", "/payroll"
];

const G3_ROUTES = [
  "/command", "/command/reports", "/command/claims", "/command/appeals",
  "/command/organizations", "/command/cases", "/command/evidence",
  "/command/accreditation", "/command/escalations", "/command/incidents",
  "/department-command", "/quality", "/public-relations", "/customer-service",
  "/executive", "/executive/accounts", "/executive/approvals", "/executive/audit"
];

let g2Promise = null;
let g3Promise = null;

function matches(current, routes) {
  return routes.some((item) => current === item || current.startsWith(`${item}/`));
}

function loadingSurface(label) {
  const root = document.querySelector("#page-root");
  if (!root || root.querySelector("[data-extension-loading-v4]")) return;
  root.innerHTML = `<section class="loading-screen" data-extension-loading-v4 aria-live="polite"><span class="loading-mark">C</span><div><strong>Opening ${label}</strong><p>Loading only the Command tools needed for this workspace…</p></div></section>`;
}

async function loadForRoute() {
  const current = route();
  try {
    if (matches(current, G2_ROUTES)) {
      loadingSurface("staff workspace");
      g2Promise ||= import("./generation2.js?v=20260912-v4-lazy");
      await g2Promise;
      return;
    }
    if (matches(current, G3_ROUTES)) {
      loadingSurface("Command workspace");
      g3Promise ||= import("./generation3.js?v=20260912-v4-lazy");
      await g3Promise;
    }
  } catch (error) {
    console.error("Cognitus extension workspace failed to load", error);
    const root = document.querySelector("#page-root");
    if (root) root.innerHTML = `<section class="access-shell"><div class="access-panel"><span class="access-mark">!</span><p class="eyebrow">Cognitus Command</p><h1>Workspace unavailable.</h1><p>The requested Staff / Command module could not be loaded. Refresh the page and try again.</p><a class="button button-dark" href="#/dashboard">Return to Dashboard</a></div></section>`;
  }
}

window.addEventListener("hashchange", loadForRoute);
loadForRoute();
