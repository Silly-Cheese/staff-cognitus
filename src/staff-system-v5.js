import { firebaseState, readDoc } from "./firebase.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import { safe, lower, route } from "./utils.js";

const MAIN_URL = "https://cognitus-solutions.org/";
const CAREERS_URL = "https://careers.cognitus-solutions.org/";
const sidebar = document.querySelector("#sidebar");
const commandOverlay = document.querySelector("#command-overlay");
const commandInput = document.querySelector("#command-input");
const commandResults = document.querySelector("#command-results");

const state = {
  auth: null,
  Auth: null,
  userRecord: null,
  staffAccess: null,
  ready: false,
  syncing: false
};

function owner() {
  return Boolean(state.userRecord?.status === "active" && (
    state.userRecord?.role === "owner"
    || (isActiveStaff(state.staffAccess) && state.staffAccess?.rank === "co-owner")
  ));
}

function activeStaff() {
  return Boolean(state.auth?.currentUser && state.userRecord?.status === "active" && isActiveStaff(state.staffAccess));
}

function can(permission) {
  return owner() || hasPermission(state.staffAccess, permission);
}

function canAny(permissions = []) {
  return permissions.some((permission) => can(permission));
}

function activeHref(href) {
  if (!href?.startsWith("#")) return false;
  const target = href.slice(1);
  if (target.startsWith("/dashboard?")) {
    const currentHash = location.hash.replace(/^#/, "");
    return currentHash === target;
  }
  return route() === target || route().startsWith(`${target}/`);
}

function item(href, label, icon, description = "", external = false) {
  return { href, label, icon, description, external };
}

function buildNavigation() {
  const leadership = [];
  if (owner() || canAny([PERMISSIONS.HR_RECORDS_READ, PERMISSIONS.HR_RECORDS_MANAGE, PERMISSIONS.STAFF_MANAGE])) {
    leadership.push(item("#/hr/lifecycle", "Employee Lifecycle", "HR", "Onboarding, employment changes, leave review, and people operations"));
  }
  if (owner() || canAny([PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_MANAGE])) {
    leadership.push(item("#/finance", "Finance", "FN", "Financial records and department finance operations"));
  }
  if (owner() || canAny([PERMISSIONS.PAYROLL_READ, PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.PAYROLL_APPROVE])) {
    leadership.push(item("#/payroll", "Payroll", "PY", "Payroll statements, processing, and approvals"));
  }
  if (owner() || canAny([PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT])) {
    leadership.push(item("#/quality", "Quality Assurance", "QA", "Reviews, findings, audits, and corrective action"));
  }
  if (owner() || canAny([PERMISSIONS.PR_MANAGE, PERMISSIONS.PR_APPROVE])) {
    leadership.push(item("#/public-relations", "Public Relations", "PR", "Campaigns, publications, partnerships, and media"));
  }
  if (owner() || canAny([PERMISSIONS.CS_MANAGE, PERMISSIONS.TICKETS_MANAGE])) {
    leadership.push(item("#/customer-service", "Customer Service", "CS", "Service queue management, analytics, and response guidance"));
  }
  if (owner() || canAny([PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE])) {
    leadership.push(item("#/admin/staff", "Staff Administration", "SA", "Provision staff and manage staff access"));
  }

  const command = [];
  const commandAccess = owner() || canAny([
    PERMISSIONS.REPORTS_REVIEW, PERMISSIONS.CLAIMS_REVIEW, PERMISSIONS.APPEALS_REVIEW,
    PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW,
    PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE,
    PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE,
    PERMISSIONS.ACCREDITATION_MANAGE, PERMISSIONS.ESCALATIONS_MANAGE,
    PERMISSIONS.INCIDENTS_MANAGE
  ]);
  if (commandAccess) command.push(item("#/command", "Command Overview", "CM", "Operational review and judgment-based work"));
  if (can(PERMISSIONS.REPORTS_REVIEW)) command.push(item("#/command/reports", "Report Review", "RP", "Review submitted reports"));
  if (can(PERMISSIONS.CLAIMS_REVIEW)) command.push(item("#/command/claims", "Claims", "CL", "Identity and profile claim decisions"));
  if (can(PERMISSIONS.APPEALS_REVIEW)) command.push(item("#/command/appeals", "Appeals", "AP", "Appeal and correction review"));
  if (canAny([PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW])) command.push(item("#/command/organizations", "Organization Review", "OR", "Organization and employer verification"));
  if (canAny([PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE])) command.push(item("#/command/cases", "Case Files", "CF", "Internal operational casework"));
  if (canAny([PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE])) command.push(item("#/command/evidence", "Evidence Register", "EV", "Case-linked evidence and source records"));
  if (can(PERMISSIONS.ACCREDITATION_MANAGE)) command.push(item("#/command/accreditation", "Accreditation", "AC", "Organization accreditation lifecycle"));
  if (can(PERMISSIONS.ESCALATIONS_MANAGE)) command.push(item("#/command/escalations", "Escalations", "ES", "Cross-department escalation work"));
  if (can(PERMISSIONS.INCIDENTS_MANAGE)) command.push(item("#/command/incidents", "Incidents", "IC", "Major operational and system incidents"));

  const executive = [];
  if (owner() || canAny([PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ, PERMISSIONS.ACCOUNTS_READ_ALL])) {
    executive.push(item("#/executive", "Executive Command", "EX", "Company-wide operating picture"));
  }
  if (owner() || can(PERMISSIONS.ACCOUNTS_READ_ALL)) executive.push(item("#/executive/accounts", "Accounts & Organizations", "UA", "Executive account and organization registry"));
  if (owner() || can(PERMISSIONS.SYSTEM_MANAGE)) executive.push(item("#/executive/approvals", "Executive Approvals", "EA", "Cross-company approval queue"));
  if (owner() || can(PERMISSIONS.AUDIT_READ)) executive.push(item("#/executive/audit", "Audit Center", "AU", "Search recent authenticated activity"));

  return [
    {
      label: "Workspace",
      compact: false,
      items: [
        item("#/dashboard", "Home", "HM", "My Day and what needs attention"),
        item("#/dashboard?view=work", "Work Center", "WK", "Combined action queue"),
        item("#/department-command", "My Department", "DP", "Department operating view"),
        item("#/inbox", "Inbox", "IN", "Staff notifications")
      ]
    },
    {
      label: "My Work",
      compact: false,
      items: [
        item("#/tasks", "Tasks", "TK", "Assignments and delegated work"),
        item("#/requests", "Requests", "RQ", "Internal requests and approvals"),
        item("#/projects", "Projects", "PJ", "Department projects and initiatives"),
        item("#/meetings", "Meetings", "MT", "Company and department schedule")
      ]
    },
    {
      label: "Staff Services",
      compact: false,
      items: [
        item("#/tickets", "Service Desk", "TS", "Support and operational tickets"),
        item("#/announcements", "Announcements", "AN", "Company and department updates"),
        item("#/documents", "Documents", "DC", "Policies, forms, guides, and resources"),
        item("#/leave", "Leave", "LV", "Time-away requests"),
        item("#/payroll", "Payroll", "PY", "Your payroll statements"),
        item("#/dashboard?view=resources", "Resources Hub", "RS", "Combined employee resources")
      ]
    },
    {
      label: "Company",
      compact: false,
      items: [
        ...(can(PERMISSIONS.DIRECTORY_READ) ? [item("#/directory", "Staff Directory", "SD", "Find Cognitus employees")] : []),
        ...(can(PERMISSIONS.DEPARTMENT_READ) ? [item("#/departments", "Departments", "DP", "Department structure and leadership")] : []),
        item("#/profile", "My Employee Profile", "ME", "Your staff identity and access")
      ]
    },
    ...(leadership.length ? [{ label: "Leadership", compact: true, items: [item("#/dashboard?view=leadership", "Leadership Hub", "LD", "Permission-based management launchpad"), ...leadership] }] : []),
    ...(command.length ? [{ label: "Command", compact: true, items: command }] : []),
    ...(executive.length ? [{ label: "Executive", compact: true, items: executive }] : []),
    {
      label: "Cognitus",
      compact: true,
      items: [
        item(MAIN_URL, "Main Cognitus", "↗", "Open the main Cognitus product", true),
        item(CAREERS_URL, "Talent Gateway", "TG", "Careers, applications, and hiring", true)
      ]
    }
  ];
}

function navLink(entry) {
  return `<a class="sidebar-link ${activeHref(entry.href) ? "active" : ""} ${entry.external ? "v5-external" : ""}" href="${safe(entry.href)}" ${entry.external ? 'target="_blank" rel="noopener"' : ""} title="${safe(entry.description)}"><span class="sidebar-link-icon">${safe(entry.icon)}</span><span>${safe(entry.label)}</span></a>`;
}

function sectionOpen(section) {
  return section.items.some((entry) => activeHref(entry.href));
}

function renderNavigation() {
  if (!sidebar || !activeStaff() || state.syncing) return;
  state.syncing = true;
  try {
    document.body.classList.add("staff-system-v5");
    let shell = sidebar.querySelector("[data-system-v5-nav]");
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "v5-nav-shell";
      shell.dataset.systemV5Nav = "";
      const divider = sidebar.querySelector(".sidebar-divider");
      if (divider) sidebar.insertBefore(shell, divider);
      else sidebar.prepend(shell);
    }
    shell.innerHTML = buildNavigation().map((section) => {
      if (!section.items.length) return "";
      if (!section.compact) {
        return `<section class="sidebar-group v5-nav-group"><span class="sidebar-label">${safe(section.label)}</span>${section.items.map(navLink).join("")}</section>`;
      }
      const storageKey = `cognitus:staff-nav:${lower(section.label)}`;
      const stored = localStorage.getItem(storageKey);
      const open = sectionOpen(section) || stored === "open" || (stored === null && section.label === "Leadership");
      return `<details class="v5-nav-details" data-v5-section="${safe(storageKey)}" ${open ? "open" : ""}><summary>${safe(section.label)}<span>${section.items.length}</span></summary><div>${section.items.map(navLink).join("")}</div></details>`;
    }).join("");
    shell.querySelectorAll("[data-v5-section]").forEach((details) => {
      details.addEventListener("toggle", () => localStorage.setItem(details.dataset.v5Section, details.open ? "open" : "closed"));
    });
  } finally {
    state.syncing = false;
  }
}

function allSearchItems() {
  return buildNavigation().flatMap((section) => section.items.map((entry) => ({ ...entry, group: section.label })));
}

function appendSystemSearch() {
  if (!commandResults || commandOverlay?.hidden || !activeStaff()) return;
  commandResults.querySelectorAll("[data-v5-system-result], [data-v5-system-label]").forEach((node) => node.remove());
  const query = lower(commandInput?.value || "");
  const matches = allSearchItems().filter((entry) => {
    if (!query) return ["Home", "Work Center", "My Department", "Staff Directory", "Service Desk", "Leadership Hub", "Command Overview", "Executive Command"].includes(entry.label);
    return lower(`${entry.label} ${entry.description} ${entry.group}`).includes(query);
  }).slice(0, 10);
  if (!matches.length) return;

  const label = document.createElement("div");
  label.dataset.v5SystemLabel = "";
  label.className = "v5-command-label";
  label.textContent = "Pages & systems";
  commandResults.appendChild(label);

  matches.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-result v5-command-result";
    button.dataset.v5SystemResult = entry.href;
    button.innerHTML = `<span class="avatar">${safe(entry.icon)}</span><span class="command-result-copy"><strong>${safe(entry.label)}</strong><span>${safe(entry.description)}</span></span><span class="command-result-type">${safe(entry.group)}</span>`;
    button.addEventListener("click", () => {
      if (entry.external) window.open(entry.href, "_blank", "noopener");
      else location.hash = entry.href;
      commandOverlay.hidden = true;
    });
    commandResults.appendChild(button);
  });
}

function scheduleSync(delay = 30) {
  window.setTimeout(() => {
    if (!state.ready || !activeStaff()) return;
    renderNavigation();
    appendSystemSearch();
  }, delay);
}

async function refreshIdentity(user) {
  state.userRecord = null;
  state.staffAccess = null;
  if (!user) return;
  const [userRecord, staffAccess] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null)
  ]);
  state.userRecord = userRecord;
  state.staffAccess = staffAccess;
}

async function init() {
  const started = Date.now();
  while (!firebaseState().ready && Date.now() - started < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const services = firebaseState();
  if (!services.ready) return;
  state.auth = services.auth;
  state.Auth = services.Auth;

  state.Auth.onAuthStateChanged(state.auth, async (user) => {
    await refreshIdentity(user);
    state.ready = true;
    scheduleSync(80);
  });

  window.addEventListener("hashchange", () => scheduleSync(40));
  commandInput?.addEventListener("input", () => window.setTimeout(appendSystemSearch, 120));
  if (commandOverlay) {
    new MutationObserver(() => window.setTimeout(appendSystemSearch, 120)).observe(commandOverlay, { attributes: true, attributeFilter: ["hidden"] });
  }
  if (sidebar) {
    new MutationObserver(() => {
      if (state.ready && activeStaff() && !sidebar.querySelector("[data-system-v5-nav]")) scheduleSync(20);
    }).observe(sidebar, { childList: true });
  }
}

init();
