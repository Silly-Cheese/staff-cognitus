import { firebaseState, readDoc, readCollection, readQuery, newFirestoreDoc } from "./firebase.js";
import { DEPARTMENTS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import {
  clean,
  lower,
  safe,
  route,
  formObject,
  formatDate,
  formatTimestamp,
  newestFirst,
  alphabetic,
  initials,
  createCognitusId,
  setBusy,
  showNotice,
  titleCase,
  debounce
} from "./utils.js";

const BUILD = "command-g3-executive-registry-2026-09-07";
const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const commandOverlay = document.querySelector("#command-overlay");
const commandInput = document.querySelector("#command-input");
const commandResults = document.querySelector("#command-results");
const toastRegion = document.querySelector("#toast-region");

const g3 = {
  auth: null,
  db: null,
  Auth: null,
  Fire: null,
  authUser: null,
  userRecord: null,
  staffAccess: null,
  directorySelf: null,
  directory: [],
  ready: false,
  rendering: false
};

const G3_ROUTES = new Set([
  "/command",
  "/command/reports",
  "/command/claims",
  "/command/appeals",
  "/command/organizations",
  "/command/cases",
  "/command/evidence",
  "/command/accreditation",
  "/command/escalations",
  "/command/incidents",
  "/department-command",
  "/quality",
  "/public-relations",
  "/customer-service",
  "/executive",
  "/executive/accounts",
  "/executive/approvals",
  "/executive/audit"
]);

const COMMAND_PAGES = [
  ["Command Overview", "Operational queues and active Cognitus work", "#/command", "CM"],
  ["Report Review", "Human review of submitted reports", "#/command/reports", "RP", PERMISSIONS.REPORTS_REVIEW],
  ["Claims", "Identity and profile claim decisions", "#/command/claims", "CL", PERMISSIONS.CLAIMS_REVIEW],
  ["Appeals", "Appeal and correction review", "#/command/appeals", "AP", PERMISSIONS.APPEALS_REVIEW],
  ["Organization Review", "Organization and employer verification", "#/command/organizations", "OR", PERMISSIONS.ORGANIZATIONS_REVIEW],
  ["Case Files", "Internal operational casework", "#/command/cases", "CF", [PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE]],
  ["Evidence Register", "Case-linked evidence and source records", "#/command/evidence", "EV", [PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE]],
  ["Accreditation", "Organization accreditation lifecycle", "#/command/accreditation", "AC", PERMISSIONS.ACCREDITATION_MANAGE],
  ["Escalations", "Cross-department operational escalation", "#/command/escalations", "ES", PERMISSIONS.ESCALATIONS_MANAGE],
  ["Incidents", "Major operational and system incidents", "#/command/incidents", "IC", PERMISSIONS.INCIDENTS_MANAGE],
  ["Department Command", "Your department's live operating view", "#/department-command", "DP"],
  ["Quality Assurance", "Reviews, findings, audits, and corrective action", "#/quality", "QA", [PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT]],
  ["Public Relations", "Campaigns, publications, partnerships, and media", "#/public-relations", "PR", [PERMISSIONS.PR_MANAGE, PERMISSIONS.PR_APPROVE]],
  ["Customer Service", "Service analytics, support operations, and response library", "#/customer-service", "CS", [PERMISSIONS.CS_MANAGE, PERMISSIONS.TICKETS_MANAGE]],
  ["Executive Command", "Board-level company overview", "#/executive", "EX", [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ]],
  ["All Accounts", "Every Cognitus account in one executive directory", "#/executive/accounts", "UA", PERMISSIONS.ACCOUNTS_READ_ALL],
  ["Executive Approvals", "Cross-company approval queue", "#/executive/approvals", "EA", PERMISSIONS.SYSTEM_MANAGE],
  ["Audit Center", "Search recent Cognitus activity", "#/executive/audit", "AU", PERMISSIONS.AUDIT_READ]
];

function owner() {
  return Boolean(
    (g3.userRecord?.status === "active" && g3.userRecord?.role === "owner")
    || (g3.userRecord?.status === "active" && isActiveStaff(g3.staffAccess) && g3.staffAccess?.rank === "co-owner")
  );
}

function can(permission) {
  if (permission === PERMISSIONS.ACCOUNTS_READ_ALL
      && g3.userRecord?.status === "active"
      && isActiveStaff(g3.staffAccess)
      && ["owner", "co-owner", "chief-officer"].includes(g3.staffAccess?.rank)) return true;
  return owner() || hasPermission(g3.staffAccess, permission);
}

function canAny(permissions = []) {
  return permissions.some((permission) => can(permission));
}

function activeStaff() {
  return Boolean(g3.authUser && g3.userRecord?.status === "active" && isActiveStaff(g3.staffAccess));
}

function departmentId() {
  return g3.staffAccess?.departmentId || g3.directorySelf?.departmentId || "";
}

function department() {
  return getDepartment(departmentId());
}

function setTitle(title) {
  document.title = `${title} · Cognitus Staff / Command`;
}

function toast(message) {
  if (!toastRegion) return;
  const element = document.createElement("div");
  element.className = "toast";
  element.textContent = message;
  toastRegion.appendChild(element);
  window.setTimeout(() => element.remove(), 3200);
}

function pageHeader(eyebrow, title, description, action = "") {
  return `<header class="page-header g3-page-header"><div class="page-header-copy"><p class="eyebrow">${safe(eyebrow)}</p><h1>${safe(title)}</h1><p>${safe(description)}</p></div>${action}</header>`;
}

function emptyState(icon, title, body, action = "") {
  return `<div class="empty-state"><span class="empty-state-icon">${safe(icon)}</span><h3>${safe(title)}</h3><p>${safe(body)}</p>${action ? `<div class="button-row" style="justify-content:center;margin-top:16px">${action}</div>` : ""}</div>`;
}

function badge(value) {
  return `<span class="badge ${safe(value || "")}">${safe(titleCase(value || "unknown"))}</span>`;
}

function priority(value) {
  return `<span class="g3-priority ${safe(value || "normal")}">${safe(value || "normal")}</span>`;
}

function personName(uid) {
  if (!uid) return "Unassigned";
  return g3.directory.find((entry) => (entry.uid || entry.id) === uid)?.displayName || (uid === g3.authUser?.uid ? g3.directorySelf?.displayName : "") || uid.slice(0, 10);
}

function departmentOptions(selected = "") {
  return DEPARTMENTS.map((item) => `<option value="${safe(item.id)}" ${item.id === selected ? "selected" : ""}>${safe(item.name)}</option>`).join("");
}

function staffOptions(selected = "", targetDepartment = "") {
  return alphabetic(g3.directory.filter((entry) => {
    if (!["active", "training", "on_leave"].includes(entry.status)) return false;
    return !targetDepartment || entry.departmentId === targetDepartment;
  })).map((entry) => {
    const uid = entry.uid || entry.id;
    return `<option value="${safe(uid)}" ${uid === selected ? "selected" : ""}>${safe(entry.displayName)} · ${safe(entry.employeeId || getRank(entry.rank).label)}</option>`;
  }).join("");
}

function validHttpsUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
}

async function writeActivity(action, targetType, targetId, summary, metadata = {}) {
  if (!g3.authUser || !g3.userRecord?.cognitusId) return;
  try {
    const ref = newFirestoreDoc("auditLogs");
    await g3.Fire.setDoc(ref, {
      id: ref.id,
      cognitusId: createCognitusId("AUD"),
      actorUid: g3.authUser.uid,
      actorCognitusId: g3.userRecord.cognitusId,
      actorRole: g3.userRecord.role,
      action: clean(action).slice(0, 80),
      targetType: clean(targetType).slice(0, 80),
      targetId: targetId || null,
      summary: clean(summary).slice(0, 500),
      metadata,
      createdAt: g3.Fire.serverTimestamp()
    });
  } catch (error) {
    console.warn("Generation 3 audit write unavailable", error);
  }
}

async function notify(recipientUid, kind, title, message, href = null) {
  if (!recipientUid || recipientUid === g3.authUser?.uid) return;
  try {
    const ref = newFirestoreDoc("staffInbox");
    const now = g3.Fire.serverTimestamp();
    await g3.Fire.setDoc(ref, {
      id: ref.id,
      recipientUid,
      senderUid: g3.authUser.uid,
      kind: clean(kind).slice(0, 50),
      title: clean(title).slice(0, 120),
      message: clean(message).slice(0, 1000),
      href,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
  } catch (error) {
    console.warn("Generation 3 notification unavailable", error);
  }
}

async function createRecord(collectionName, data, auditAction, summary) {
  const ref = newFirestoreDoc(collectionName);
  const now = g3.Fire.serverTimestamp();
  await g3.Fire.setDoc(ref, { id: ref.id, ...data, createdAt: now, updatedAt: now });
  if (auditAction) await writeActivity(auditAction, collectionName, ref.id, summary || auditAction);
  return ref.id;
}

async function updateRecord(collectionName, id, patch, auditAction, summary) {
  await g3.Fire.updateDoc(g3.Fire.doc(g3.db, collectionName, id), { ...patch, updatedAt: g3.Fire.serverTimestamp() });
  if (auditAction) await writeActivity(auditAction, collectionName, id, summary || auditAction);
}

async function refreshIdentity(user) {
  g3.authUser = user || null;
  if (!user) {
    g3.userRecord = null;
    g3.staffAccess = null;
    g3.directorySelf = null;
    g3.directory = [];
    return;
  }
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null),
    readDoc("staffDirectory", user.uid).catch(() => null)
  ]);
  g3.userRecord = userRecord;
  g3.staffAccess = staffAccess;
  g3.directorySelf = directorySelf;
  if (userRecord?.status === "active" && isActiveStaff(staffAccess)) {
    g3.directory = alphabetic(await readCollection("staffDirectory").catch(() => directorySelf ? [directorySelf] : []));
  }
}

function allowedPage(entry) {
  const permission = entry[4];
  if (!permission) return true;
  if (Array.isArray(permission)) return canAny(permission);
  return can(permission);
}

function navSection(label, items) {
  const allowed = items.filter((item) => !item.permission || (Array.isArray(item.permission) ? canAny(item.permission) : can(item.permission)));
  if (!allowed.length) return "";
  return `<section class="sidebar-group g3-nav-group" data-g3-nav><span class="sidebar-label">${safe(label)}</span>${allowed.map((item) => `<a class="sidebar-link ${route() === item.path || route().startsWith(`${item.path}/`) ? "active" : ""}" href="#${safe(item.path)}"><span class="sidebar-link-icon">${safe(item.icon)}</span><span>${safe(item.label)}</span></a>`).join("")}</section>`;
}

function augmentChrome() {
  if (!activeStaff() || !sidebar || !sidebar.children.length) return;
  sidebar.querySelector("[data-g3-nav-holder]")?.remove();
  const holder = document.createElement("div");
  holder.setAttribute("data-g3-nav-holder", "");
  holder.innerHTML = [
    navSection("Command", [
      { path: "/command", label: "Command Overview", icon: "CM" },
      { path: "/command/reports", label: "Reports", icon: "RP", permission: PERMISSIONS.REPORTS_REVIEW },
      { path: "/command/claims", label: "Claims", icon: "CL", permission: PERMISSIONS.CLAIMS_REVIEW },
      { path: "/command/appeals", label: "Appeals", icon: "AP", permission: PERMISSIONS.APPEALS_REVIEW },
      { path: "/command/organizations", label: "Organization Review", icon: "OR", permission: [PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW] },
      { path: "/command/cases", label: "Case Files", icon: "CF", permission: [PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE] },
      { path: "/command/evidence", label: "Evidence", icon: "EV", permission: [PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE] },
      { path: "/command/accreditation", label: "Accreditation", icon: "AC", permission: PERMISSIONS.ACCREDITATION_MANAGE },
      { path: "/command/escalations", label: "Escalations", icon: "ES", permission: PERMISSIONS.ESCALATIONS_MANAGE },
      { path: "/command/incidents", label: "Incidents", icon: "IC", permission: PERMISSIONS.INCIDENTS_MANAGE }
    ]),
    navSection("Department Command", [
      { path: "/department-command", label: "Department Dashboard", icon: "DP" },
      { path: "/quality", label: "Quality Assurance", icon: "QA", permission: [PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT] },
      { path: "/public-relations", label: "Public Relations", icon: "PR", permission: [PERMISSIONS.PR_MANAGE, PERMISSIONS.PR_APPROVE] },
      { path: "/customer-service", label: "Customer Service", icon: "CS", permission: [PERMISSIONS.CS_MANAGE, PERMISSIONS.TICKETS_MANAGE] }
    ]),
    navSection("Executive", [
      { path: "/executive", label: "Executive Command", icon: "EX", permission: [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ] },
      { path: "/executive/accounts", label: "All Accounts", icon: "UA", permission: PERMISSIONS.ACCOUNTS_READ_ALL },
      { path: "/executive/approvals", label: "Approvals", icon: "EA", permission: PERMISSIONS.SYSTEM_MANAGE },
      { path: "/executive/audit", label: "Audit Center", icon: "AU", permission: PERMISSIONS.AUDIT_READ }
    ])
  ].join("");
  const divider = sidebar.querySelector(".sidebar-divider");
  if (divider) sidebar.insertBefore(holder, divider);
  else sidebar.appendChild(holder);
  const build = sidebar.querySelector(".sidebar-profile span:last-child");
  if (build) build.textContent = BUILD;
}

function injectStyles() {
  if (document.querySelector("#cognitus-g3-styles")) return;
  const style = document.createElement("style");
  style.id = "cognitus-g3-styles";
  style.textContent = `
    .g3-page-header{align-items:flex-end}.g3-nav-group:first-child{margin-top:6px}.g3-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.g3-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.g3-stack{display:grid;gap:14px}.g3-card{border:1px solid #e5e5e5;background:#fff;padding:16px}.g3-card.dark{background:#111;color:#fff;border-color:#111}.g3-card h3{margin:0;font-size:14px;letter-spacing:-.02em}.g3-card p{font-size:10px;line-height:1.6;color:#666;margin:7px 0 0}.g3-card.dark p{color:#c7c7c7}.g3-card-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;font-size:9px;color:#777}.g3-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:13px;padding-top:12px;border-top:1px solid #eee}.g3-card.dark .g3-card-actions{border-color:#333}.g3-priority{font-size:8px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;padding:4px 6px;border:1px solid #ddd}.g3-priority.high,.g3-priority.critical{background:#111;color:#fff;border-color:#111}.g3-priority.low{color:#777}.g3-queue{display:grid}.g3-queue-item{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(100px,.55fr) auto;gap:14px;align-items:center;padding:15px 17px;border-bottom:1px solid #eee}.g3-queue-item:last-child{border-bottom:0}.g3-queue-copy strong{display:block;font-size:11px}.g3-queue-copy p{font-size:9px;line-height:1.55;color:#666;margin:5px 0}.g3-queue-copy small{font-size:8px;color:#888}.g3-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.g3-split{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.7fr);gap:18px;align-items:start}.g3-sticky{position:sticky;top:calc(var(--topbar-height) + 18px)}.g3-kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.g3-kpi article{border:1px solid #e8e8e8;padding:14px;background:#fff}.g3-kpi span{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#777}.g3-kpi strong{display:block;font-size:22px;margin-top:6px}.g3-command-label{margin:7px 12px 4px;font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#999}.g3-command-result{width:calc(100% - 16px);margin:2px 8px}.g3-officer{display:flex;gap:11px;align-items:center;padding:12px 0;border-bottom:1px solid #eee}.g3-officer:last-child{border-bottom:0}.g3-officer-copy{min-width:0}.g3-officer-copy strong,.g3-officer-copy span{display:block}.g3-officer-copy strong{font-size:10px}.g3-officer-copy span{font-size:8px;color:#777;margin-top:3px}.g3-meter{height:6px;background:#ededed;overflow:hidden;margin-top:8px}.g3-meter span{display:block;height:100%;background:#111}.g3-detail{border:1px solid #eee;padding:13px}.g3-detail span{font-size:8px;color:#777;text-transform:uppercase;letter-spacing:.08em}.g3-detail strong{display:block;font-size:11px;margin-top:5px}.g3-callout{border:1px solid #111;padding:16px;background:#fafafa;font-size:10px;line-height:1.7}.g3-callout strong{display:block;font-size:11px;margin-bottom:4px}.g3-form-wrap{margin-bottom:14px}.g3-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px}.g3-score{font-size:24px;font-weight:900;letter-spacing:-.04em}.g3-hero{background:#0d0d0d;color:#fff;border:0}.g3-hero p{color:#bdbdbd}.g3-hero .eyebrow{color:#bdbdbd}.g3-hero h1{color:#fff}.g3-hero .button{border-color:#fff}.g3-hero .button:not(.button-dark){background:#fff;color:#111}.g3-hero .button-dark{background:#111;color:#fff}.g3-danger{border-left:3px solid #111}.g3-muted{opacity:.68}
    .registry-tabs{display:flex;gap:8px;align-items:center;margin:18px 0 12px}.registry-count{opacity:.65;margin-left:5px}.registry-toolbar{display:grid;grid-template-columns:minmax(250px,1fr) repeat(3,minmax(145px,.35fr));gap:8px;margin-bottom:14px}.registry-list{border:1px solid #eee}.registry-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(220px,.65fr) auto;gap:14px;align-items:center;padding:15px 16px;border-bottom:1px solid #eee;background:#fff}.registry-row:last-child{border-bottom:0}.registry-main{min-width:0}.registry-main strong{font-size:12px}.registry-main p{font-size:9px;color:#666;margin:5px 0}.registry-main small{display:block;font-size:8px;color:#888;overflow-wrap:anywhere}.registry-name{display:flex;align-items:center;gap:7px}.registry-staff{font-size:7px;font-weight:900;letter-spacing:.08em;border:1px solid #111;padding:2px 4px}.registry-badges,.registry-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.registry-actions{justify-content:flex-end}.registry-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.46);z-index:140}.registry-drawer{position:fixed;top:0;right:0;bottom:0;width:min(620px,94vw);background:#fff;z-index:141;overflow:auto;box-shadow:-18px 0 50px rgba(0,0,0,.16);padding:22px}.registry-drawer-open{overflow:hidden}.registry-drawer-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid #e8e8e8}.registry-drawer-header h2{margin:3px 0 7px;font-size:24px;letter-spacing:-.04em}.registry-drawer-header p:not(.eyebrow){font-size:10px;line-height:1.6;color:#666;max-width:470px}.registry-form{display:grid;gap:14px;margin-top:14px}.registry-section{border:1px solid #e7e7e7;padding:16px}.registry-section-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:13px}.registry-section-title strong{font-size:11px}.registry-section-title span{font-size:8px;color:#888}.registry-check{display:flex!important;flex-direction:row!important;align-items:flex-start;gap:10px;border:1px solid #e7e7e7;padding:12px;margin-top:12px}.registry-check input{width:auto!important;margin-top:2px}.registry-check span,.registry-check strong,.registry-check small{display:block}.registry-check small{margin-top:3px;color:#777}.registry-dl{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;margin:0}.registry-dl dt{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#777}.registry-dl dd{margin:0;font-size:9px;overflow-wrap:anywhere}.registry-savebar{position:sticky;bottom:-22px;background:#fff;border-top:1px solid #ddd;padding:14px 0 2px;display:flex;align-items:center;gap:12px;z-index:2}.registry-savebar span{font-size:8px;color:#777}.registry-danger{margin-top:18px;border:1px solid #111;padding:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}.registry-danger strong{font-size:11px}.registry-danger p{font-size:9px;color:#666;line-height:1.55;margin:5px 0 0;max-width:390px}.registry-readonly{background:#fafafa}
    @media(max-width:1080px){.g3-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.g3-split{grid-template-columns:1fr}.g3-sticky{position:static}.g3-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:720px){.g3-grid,.g3-grid.two,.g3-kpi{grid-template-columns:1fr}.g3-queue-item{grid-template-columns:1fr}.g3-actions{justify-content:flex-start}.g3-page-header{align-items:flex-start}.registry-toolbar{grid-template-columns:1fr}.registry-row{grid-template-columns:1fr;gap:9px}.registry-actions{justify-content:flex-start}.registry-drawer{width:100vw;padding:16px}.registry-drawer-header{position:sticky;top:-16px;background:#fff;z-index:3;padding-top:16px}.registry-danger{align-items:flex-start;flex-direction:column}.registry-savebar{bottom:-16px}.registry-dl{grid-template-columns:95px minmax(0,1fr)}}
  `;
  document.head.appendChild(style);
}

async function commandCounts() {
  const result = { reports: 0, claims: 0, appeals: 0, organizations: 0, cases: 0, escalations: 0, incidents: 0, qa: 0 };
  const jobs = [];
  if (can(PERMISSIONS.REPORTS_REVIEW)) jobs.push(readQuery("reports", [g3.Fire.where("status", "==", "pending_review")]).then((rows) => result.reports = rows.length).catch(() => {}));
  if (can(PERMISSIONS.CLAIMS_REVIEW)) jobs.push(readQuery("claims", [g3.Fire.where("status", "==", "pending_review")]).then((rows) => result.claims = rows.length).catch(() => {}));
  if (can(PERMISSIONS.APPEALS_REVIEW)) jobs.push(readQuery("appeals", [g3.Fire.where("status", "==", "pending_review")]).then((rows) => result.appeals = rows.length).catch(() => {}));
  if (canAny([PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW])) jobs.push(readQuery("organizations", [g3.Fire.where("verificationStatus", "==", "pending_verification")]).then((rows) => result.organizations = rows.length).catch(() => {}));
  if (canAny([PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE])) jobs.push(readCollection("commandCases").then((rows) => result.cases = rows.filter((row) => !["closed", "archived"].includes(row.status)).length).catch(() => {}));
  if (can(PERMISSIONS.ESCALATIONS_MANAGE)) jobs.push(readCollection("commandEscalations").then((rows) => result.escalations = rows.filter((row) => !["resolved", "closed"].includes(row.status)).length).catch(() => {}));
  if (can(PERMISSIONS.INCIDENTS_MANAGE)) jobs.push(readCollection("commandIncidents").then((rows) => result.incidents = rows.filter((row) => !["resolved", "closed"].includes(row.status)).length).catch(() => {}));
  if (canAny([PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT])) jobs.push(readCollection("commandQaReviews").then((rows) => result.qa = rows.filter((row) => row.status !== "closed").length).catch(() => {}));
  await Promise.all(jobs);
  return result;
}

async function commandOverviewPage() {
  setTitle("Command Overview");
  const counts = await commandCounts();
  const available = COMMAND_PAGES.filter(allowedPage).filter((entry) => entry[2] !== "#/command").slice(0, 12);
  root.innerHTML = `<div class="page-inner" data-g3-page="command">
    <section class="hero-card g3-hero"><div><p class="eyebrow">Cognitus Command</p><h1>Human judgment, only where it belongs.</h1><p>Command handles submitted records, appeals, claims, investigations, quality, accreditation, and exceptional situations. Background checks remain automatic and never wait for staff approval.</p><div class="button-row hero-actions"><a class="button" href="#/command/cases">Open Case Files</a><a class="button button-dark" href="#/department-command">Department Command</a></div></div><aside class="hero-identity"><div><span>Command identity</span><strong>${safe(g3.directorySelf?.employeeId || "ACTIVE")}</strong><small>${safe(g3.directorySelf?.title || getRank(g3.staffAccess?.rank).label)}<br>${safe(department().name)}</small></div></aside></section>
    <section class="g3-kpi" style="margin:18px 0"><article><span>Pending Reports</span><strong>${counts.reports}</strong></article><article><span>Claims</span><strong>${counts.claims}</strong></article><article><span>Appeals</span><strong>${counts.appeals}</strong></article><article><span>Organization Review</span><strong>${counts.organizations}</strong></article><article><span>Open Cases</span><strong>${counts.cases}</strong></article><article><span>Escalations</span><strong>${counts.escalations}</strong></article><article><span>Incidents</span><strong>${counts.incidents}</strong></article><article><span>QA Work</span><strong>${counts.qa}</strong></article></section>
    <section class="panel"><header class="panel-header"><div><p class="eyebrow">Authorized workspaces</p><h2>Your Command surface</h2></div><span>${available.length} available</span></header><div class="panel-body"><div class="g3-grid">${available.map(([title, subtitle, href, icon]) => `<a class="quick-card" href="${safe(href)}"><strong>${safe(title)}</strong><span>${safe(subtitle)}</span><span class="quick-card-arrow">${safe(icon)} →</span></a>`).join("")}</div></div></section>
  </div>`;
}

async function reportsPage() {
  setTitle("Report Review");
  if (!can(PERMISSIONS.REPORTS_REVIEW)) return forbidden("Report Review");
  const [pending, underway] = await Promise.all([
    readQuery("reports", [g3.Fire.where("status", "==", "pending_review")]).catch(() => []),
    readQuery("reports", [g3.Fire.where("status", "==", "under_review")]).catch(() => [])
  ]);
  const reports = newestFirst([...pending, ...underway]);
  root.innerHTML = `<div class="page-inner" data-g3-page="reports">${pageHeader("Command · Records", "Report review.", "Review submitted reports without rewriting the original submission. Decisions control status and screening visibility.")}
    <section class="stats-grid"><article class="stat-card"><span>Pending</span><strong>${pending.length}</strong><small>Awaiting human review</small></article><article class="stat-card"><span>Under Review</span><strong>${underway.length}</strong><small>Work has started</small></article><article class="stat-card"><span>Automation</span><strong>0</strong><small>Background checks awaiting approval</small></article><article class="stat-card"><span>Authority</span><strong>RP</strong><small>reports.review</small></article></section>
    <section class="panel">${reports.length ? `<div class="g3-queue">${reports.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.summary || item.cognitusId || item.id)}</strong><p>${safe(item.details || "No details supplied.")}</p><small>${safe(item.category || "Report")} · ${safe(item.severity || "Informational")} · ${safe(formatTimestamp(item.createdAt))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${item.status === "pending_review" ? `<button class="button button-small" data-report-action="start" data-id="${safe(item.id)}">Start</button>` : ""}<button class="button button-small button-dark" data-report-action="approve" data-id="${safe(item.id)}">Approve</button><button class="button button-small" data-report-action="deny" data-id="${safe(item.id)}">Deny</button></div></article>`).join("")}</div>` : emptyState("RP", "Queue clear", "There are no pending or active report reviews.")}</section>
  </div>`;
  root.querySelectorAll("[data-report-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const action = button.dataset.reportAction;
      const patch = action === "start"
        ? { status: "under_review", visibility: "private_review", reviewedByUid: g3.authUser.uid, reviewedAt: g3.Fire.serverTimestamp(), decisionNotes: "Review started in Cognitus Command." }
        : action === "approve"
          ? { status: "approved", visibility: "screening", reviewedByUid: g3.authUser.uid, reviewedAt: g3.Fire.serverTimestamp(), decisionNotes: "Approved for screening visibility in Cognitus Command." }
          : { status: "denied", visibility: "private_review", reviewedByUid: g3.authUser.uid, reviewedAt: g3.Fire.serverTimestamp(), decisionNotes: "Denied in Cognitus Command." };
      await updateRecord("reports", button.dataset.id, patch, "COMMAND_REPORT_DECISION", `Report ${action} action completed.`);
      toast(`Report ${action} action completed.`);
      await reportsPage();
    } catch (error) {
      alert(error?.message || "Report action failed.");
      button.disabled = false;
    }
  }));
}

async function claimsPage() {
  setTitle("Claims");
  if (!can(PERMISSIONS.CLAIMS_REVIEW)) return forbidden("Claims");
  const [claims, profileClaims] = await Promise.all([
    readQuery("claims", [g3.Fire.where("status", "==", "pending_review")]).catch(() => []),
    readQuery("externalProfileClaims", [g3.Fire.where("status", "==", "pending")]).catch(() => [])
  ]);
  root.innerHTML = `<div class="page-inner" data-g3-page="claims">${pageHeader("Command · Identity", "Claims.", "Review identity claims and employer-created profile claims against the underlying Cognitus record.")}
    <section class="content-grid equal"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Standard claims</p><h2>${claims.length} pending</h2></div></header>${claims.length ? `<div class="g3-queue">${newestFirst(claims).map((item) => claimRow(item, "standard")).join("")}</div>` : emptyState("CL", "No standard claims", "Nothing is waiting in this queue.")}</section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Profile claims</p><h2>${profileClaims.length} pending</h2></div></header>${profileClaims.length ? `<div class="g3-queue">${newestFirst(profileClaims, "submittedAt").map((item) => claimRow(item, "external")).join("")}</div>` : emptyState("PC", "No profile claims", "No employer-created profile claims are pending.")}</section></section>
  </div>`;
  root.querySelectorAll("[data-claim-action]").forEach((button) => button.addEventListener("click", () => decideClaim(button)));
}

function claimRow(item, kind) {
  const title = item.applicantDisplayName || item.cognitusId || item.id;
  const body = item.statement || item.claimReason || item.profileId || "Identity claim";
  return `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(title)}</strong><p>${safe(body)}</p><small>${safe(item.profileId || "No profile")}</small></div><div>${badge(item.status)}</div><div class="g3-actions"><button class="button button-small button-dark" data-claim-action="approve" data-kind="${kind}" data-id="${safe(item.id)}">Approve</button><button class="button button-small" data-claim-action="deny" data-kind="${kind}" data-id="${safe(item.id)}">Deny</button></div></article>`;
}

async function decideClaim(button) {
  button.disabled = true;
  const action = button.dataset.claimAction;
  const kind = button.dataset.kind;
  const id = button.dataset.id;
  try {
    const collection = kind === "external" ? "externalProfileClaims" : "claims";
    const claim = await readDoc(collection, id);
    if (!claim) throw new Error("Claim record no longer exists.");
    const batch = g3.Fire.writeBatch(g3.db);
    if (kind === "external") {
      batch.update(g3.Fire.doc(g3.db, collection, id), {
        status: action === "approve" ? "approved" : "denied",
        reviewedByUid: g3.authUser.uid,
        reviewerNotes: action === "approve" ? "Profile claim approved in Cognitus Command." : "Profile claim denied in Cognitus Command.",
        reviewedAt: g3.Fire.serverTimestamp(),
        updatedAt: g3.Fire.serverTimestamp()
      });
      if (action === "approve" && claim.profileId && claim.applicantUid) {
        batch.update(g3.Fire.doc(g3.db, "profiles", claim.profileId), {
          linkedUserId: claim.applicantUid,
          claimedByUid: claim.applicantUid,
          identityStatus: "claimed",
          updatedAt: g3.Fire.serverTimestamp()
        });
      }
    } else {
      batch.update(g3.Fire.doc(g3.db, collection, id), {
        status: action === "approve" ? "approved" : "denied",
        reviewedByUid: g3.authUser.uid,
        decisionNotes: action === "approve" ? "Claim approved in Cognitus Command." : "Claim denied in Cognitus Command.",
        closedAt: g3.Fire.serverTimestamp(),
        updatedAt: g3.Fire.serverTimestamp()
      });
      if (action === "approve" && claim.profileId && claim.submittedByUid) {
        batch.update(g3.Fire.doc(g3.db, "profiles", claim.profileId), {
          claimedByUid: claim.submittedByUid,
          identityStatus: "claimed_unverified",
          updatedAt: g3.Fire.serverTimestamp()
        });
      }
    }
    await batch.commit();
    await writeActivity("COMMAND_CLAIM_DECISION", collection, id, `Claim ${action}d in Cognitus Command.`);
    toast(`Claim ${action}d.`);
    await claimsPage();
  } catch (error) {
    alert(error?.message || "Claim decision failed.");
    button.disabled = false;
  }
}

async function appealsPage() {
  setTitle("Appeals");
  if (!can(PERMISSIONS.APPEALS_REVIEW)) return forbidden("Appeals");
  const [pending, underway] = await Promise.all([
    readQuery("appeals", [g3.Fire.where("status", "==", "pending_review")]).catch(() => []),
    readQuery("appeals", [g3.Fire.where("status", "==", "under_review")]).catch(() => [])
  ]);
  const appeals = newestFirst([...pending, ...underway]);
  root.innerHTML = `<div class="page-inner" data-g3-page="appeals">${pageHeader("Command · Corrections", "Appeals.", "Evaluate challenges to reviewed records and preserve the submitted appeal, decision, and resulting report state.")}
    <section class="panel">${appeals.length ? `<div class="g3-queue">${appeals.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.reason || item.cognitusId || item.id)}</strong><p>${safe(item.statement || "No statement.")}</p><small>Report ${safe(item.reportId || "—")} · ${safe(formatTimestamp(item.createdAt))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${item.status === "pending_review" ? `<button class="button button-small" data-appeal-action="start" data-id="${safe(item.id)}">Start</button>` : ""}<button class="button button-small button-dark" data-appeal-action="accept" data-id="${safe(item.id)}">Accept</button><button class="button button-small" data-appeal-action="deny" data-id="${safe(item.id)}">Deny</button></div></article>`).join("")}</div>` : emptyState("AP", "Appeals clear", "No appeals are pending review.")}</section>
  </div>`;
  root.querySelectorAll("[data-appeal-action]").forEach((button) => button.addEventListener("click", () => decideAppeal(button)));
}

async function decideAppeal(button) {
  button.disabled = true;
  const action = button.dataset.appealAction;
  const id = button.dataset.id;
  try {
    const appeal = await readDoc("appeals", id);
    if (!appeal) throw new Error("Appeal record no longer exists.");
    if (action === "start") {
      await updateRecord("appeals", id, { status: "under_review", reviewedByUid: g3.authUser.uid, decision: null, decisionNotes: "Review started in Cognitus Command.", closedAt: null }, "COMMAND_APPEAL_STARTED", "Appeal review started.");
    } else {
      const accepted = action === "accept";
      const batch = g3.Fire.writeBatch(g3.db);
      batch.update(g3.Fire.doc(g3.db, "appeals", id), {
        status: accepted ? "accepted" : "denied",
        reviewedByUid: g3.authUser.uid,
        decision: accepted ? "accepted" : "denied",
        decisionNotes: accepted ? "Appeal accepted in Cognitus Command; linked report moved to disputed/private review." : "Appeal denied in Cognitus Command.",
        closedAt: g3.Fire.serverTimestamp(),
        updatedAt: g3.Fire.serverTimestamp()
      });
      if (accepted && appeal.reportId) {
        batch.update(g3.Fire.doc(g3.db, "reports", appeal.reportId), {
          status: "disputed",
          visibility: "private_review",
          appealStatus: "accepted",
          reviewedByUid: g3.authUser.uid,
          reviewedAt: g3.Fire.serverTimestamp(),
          updatedAt: g3.Fire.serverTimestamp()
        });
      }
      await batch.commit();
      await writeActivity("COMMAND_APPEAL_DECISION", "appeal", id, `Appeal ${accepted ? "accepted" : "denied"}.`);
    }
    toast(`Appeal ${action} action completed.`);
    await appealsPage();
  } catch (error) {
    alert(error?.message || "Appeal action failed.");
    button.disabled = false;
  }
}

async function organizationsPage() {
  setTitle("Organization Review");
  if (!canAny([PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW])) return forbidden("Organization Review");
  const [organizations, employerRequests] = await Promise.all([
    readQuery("organizations", [g3.Fire.where("verificationStatus", "==", "pending_verification")]).catch(() => []),
    can(PERMISSIONS.VERIFICATION_REVIEW) ? readQuery("employerStatusRequests", [g3.Fire.where("status", "==", "pending")]).catch(() => []) : Promise.resolve([])
  ]);
  root.innerHTML = `<div class="page-inner" data-g3-page="organizations">${pageHeader("Command · Organizations", "Organization review.", "Review organization records and employer-status requests. Background checks are not part of this queue.")}
    <section class="content-grid equal"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Organizations</p><h2>${organizations.length} pending</h2></div></header>${organizations.length ? `<div class="g3-queue">${organizations.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.name)}</strong><p>${safe(item.organizationType || "Organization")} · ${safe(item.country || "Region not listed")}</p><small>${safe(item.cognitusId || item.id)}</small></div><div>${badge(item.verificationStatus)}</div><div class="g3-actions"><button class="button button-small button-dark" data-org-action="verified" data-id="${safe(item.id)}">Verify</button><button class="button button-small" data-org-action="unverified" data-id="${safe(item.id)}">Decline</button></div></article>`).join("")}</div>` : emptyState("OR", "No organizations pending", "The organization verification queue is clear.")}</section>
    <section class="panel"><header class="panel-header"><div><p class="eyebrow">Employer status</p><h2>${employerRequests.length} pending</h2></div></header>${employerRequests.length ? `<div class="g3-queue">${employerRequests.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.applicantDisplayName || item.cognitusId || item.id)}</strong><p>${safe(item.positionTitle || "Employer member")} · ${safe(item.organizationName || item.organizationId)}</p><small>${safe(item.reason || "No reason supplied")}</small></div><div>${badge(item.status)}</div><div class="g3-actions"><button class="button button-small button-dark" data-employer-action="approved" data-id="${safe(item.id)}">Approve</button><button class="button button-small" data-employer-action="denied" data-id="${safe(item.id)}">Deny</button></div></article>`).join("")}</div>` : emptyState("VR", "No employer requests", "There are no employer-status requests waiting.")}</section></section>
  </div>`;
  root.querySelectorAll("[data-org-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await updateRecord("organizations", button.dataset.id, { verificationStatus: button.dataset.orgAction, trustLevel: button.dataset.orgAction === "verified" ? "good" : "unreviewed" }, "COMMAND_ORG_REVIEW", `Organization marked ${button.dataset.orgAction}.`);
      toast("Organization review saved.");
      await organizationsPage();
    } catch (error) { alert(error?.message || "Organization review failed."); button.disabled = false; }
  }));
  root.querySelectorAll("[data-employer-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const action = button.dataset.employerAction;
      const requestRecord = await readDoc("employerStatusRequests", button.dataset.id);
      if (!requestRecord) throw new Error("Employer-status request no longer exists.");
      const batch = g3.Fire.writeBatch(g3.db);
      const now = g3.Fire.serverTimestamp();
      batch.update(g3.Fire.doc(g3.db, "employerStatusRequests", button.dataset.id), {
        status: action,
        reviewedAt: now,
        reviewedByUid: g3.authUser.uid,
        reviewerNotes: `Decision completed in Cognitus Command: ${action}.`,
        updatedAt: now
      });
      if (action === "approved") {
        batch.update(g3.Fire.doc(g3.db, "users", requestRecord.applicantUid), {
          role: "verified_employer_member",
          organizationId: requestRecord.organizationId,
          updatedAt: now
        });
      }
      await batch.commit();
      await writeActivity("COMMAND_EMPLOYER_STATUS", "employerStatusRequests", button.dataset.id, `Employer status ${action}.`);
      toast("Employer-status decision saved.");
      await organizationsPage();
    } catch (error) { alert(error?.message || "Employer request decision failed."); button.disabled = false; }
  }));
}

async function casesPage() {
  setTitle("Case Files");
  if (!canAny([PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE])) return forbidden("Case Files");
  const cases = newestFirst(await readCollection("commandCases").catch(() => []), "updatedAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="cases">${pageHeader("Command · Intelligence", "Case files.", "Create and manage internal Cognitus casework that links operational issues without turning ordinary background checks into approval workflows.", can(PERMISSIONS.CASES_MANAGE) ? `<button class="button button-dark" id="new-case" type="button">New Case</button>` : "")}
    <div id="case-form-wrap" class="g3-form-wrap" hidden></div><section class="g3-grid">${cases.length ? cases.map(caseCard).join("") : emptyState("CF", "No case files", "Casework created by authorized staff will appear here.")}</section>
  </div>`;
  root.querySelector("#new-case")?.addEventListener("click", renderCaseForm);
  root.querySelectorAll("[data-case-status]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await updateRecord("commandCases", button.dataset.id, { status: button.dataset.caseStatus }, "COMMAND_CASE_STATUS", `Case moved to ${button.dataset.caseStatus}.`);
      toast("Case updated."); await casesPage();
    } catch (error) { alert(error?.message || "Case update failed."); }
  }));
}

function caseCard(item) {
  return `<article class="g3-card ${item.priority === "critical" ? "g3-danger" : ""}"><div class="g3-card-top"><h3>${safe(item.title)}</h3>${priority(item.priority)}</div><p>${safe(item.summary || "No case summary.")}</p><div class="g3-card-meta"><span>${safe(item.cognitusId || item.id)}</span><span>•</span><span>${safe(getDepartment(item.departmentId).shortName)}</span><span>•</span><span>${safe(personName(item.assignedToUid))}</span><span>•</span><span>${safe(formatTimestamp(item.updatedAt))}</span></div><div class="g3-card-actions">${badge(item.status)}${can(PERMISSIONS.CASES_MANAGE) && item.status !== "closed" ? `<button class="button button-small" data-case-status="active" data-id="${safe(item.id)}">Active</button><button class="button button-small button-dark" data-case-status="closed" data-id="${safe(item.id)}">Close</button>` : ""}</div></article>`;
}

function renderCaseForm() {
  const wrap = root.querySelector("#case-form-wrap");
  if (!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card"><header class="panel-header"><div><p class="eyebrow">New case</p><h2>Open operational case</h2></div><button class="button button-small" id="close-case-form">Close</button></header><div id="case-message" class="notice" hidden></div><form id="case-form" class="form-stack"><label>Case title<input name="title" maxlength="140" required></label><label>Summary<textarea name="summary" rows="4" maxlength="3000" required></textarea></label><div class="form-row"><label>Type<select name="type"><option value="investigation">Investigation</option><option value="data_quality">Data Quality</option><option value="abuse">Abuse Concern</option><option value="organization">Organization Matter</option><option value="support_escalation">Support Escalation</option><option value="other">Other</option></select></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label></div><div class="form-row"><label>Department<select name="departmentId">${departmentOptions(departmentId())}</select></label><label>Assigned to<select name="assignedToUid"><option value="">Unassigned</option>${staffOptions("", "")}</select></label></div><div class="form-row"><label>Subject type<select name="subjectType"><option value="none">None</option><option value="profile">Profile</option><option value="organization">Organization</option><option value="report">Report</option><option value="ticket">Ticket</option></select></label><label>Subject ID<input name="subjectId" maxlength="140"></label></div><button class="button button-dark" type="submit">Open Case</button></form></section>`;
  wrap.querySelector("#close-case-form")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#case-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const message = wrap.querySelector("#case-message");
    const button = form.querySelector("button[type=submit]");
    try {
      setBusy(button, true, "Opening…", "Open Case");
      const id = await createRecord("commandCases", {
        cognitusId: createCognitusId("CAS"),
        title: clean(data.title).slice(0, 140),
        type: clean(data.type),
        status: "open",
        priority: clean(data.priority),
        departmentId: clean(data.departmentId),
        subjectType: clean(data.subjectType),
        subjectId: clean(data.subjectId).slice(0, 140) || null,
        assignedToUid: clean(data.assignedToUid) || null,
        summary: clean(data.summary).slice(0, 3000),
        createdByUid: g3.authUser.uid
      }, "COMMAND_CASE_CREATED", "Opened an operational case.");
      if (clean(data.assignedToUid)) await notify(clean(data.assignedToUid), "case", "Case assigned", `You were assigned ${clean(data.title).slice(0, 140)}.`, "#/command/cases");
      toast(`Case opened: ${id}`); await casesPage();
    } catch (error) { showNotice(message, error?.message || "Case could not be opened.", "error"); }
    finally { setBusy(button, false, "Opening…", "Open Case"); }
  });
}

async function evidencePage() {
  setTitle("Evidence Register");
  if (!canAny([PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE])) return forbidden("Evidence Register");
  const evidence = newestFirst(await readCollection("commandEvidence").catch(() => []), "createdAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="evidence">${pageHeader("Command · Intelligence", "Evidence register.", "Record source material linked to internal casework. Command stores references and notes—not unrestricted file uploads.", can(PERMISSIONS.EVIDENCE_MANAGE) ? `<button class="button button-dark" id="new-evidence">Add Evidence</button>` : "")}
    <div id="evidence-form-wrap" class="g3-form-wrap" hidden></div><section class="panel">${evidence.length ? `<div class="g3-queue">${evidence.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.label)}</strong><p>${safe(item.notes || "No notes.")}</p><small>Case ${safe(item.caseId)} · ${safe(item.type)} · ${safe(formatTimestamp(item.createdAt))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${item.sourceUrl ? `<a class="button button-small" href="${safe(item.sourceUrl)}" target="_blank" rel="noopener">Open Source</a>` : ""}</div></article>`).join("")}</div>` : emptyState("EV", "No evidence records", "Evidence references added to casework will appear here.")}</section>
  </div>`;
  root.querySelector("#new-evidence")?.addEventListener("click", () => {
    const wrap = root.querySelector("#evidence-form-wrap"); wrap.hidden = false;
    wrap.innerHTML = `<section class="form-card"><div id="evidence-message" class="notice" hidden></div><form id="evidence-form" class="form-stack"><div class="form-row"><label>Case ID<input name="caseId" required></label><label>Type<select name="type"><option value="link">Link</option><option value="statement">Statement</option><option value="record">Record Reference</option><option value="other">Other</option></select></label></div><label>Label<input name="label" maxlength="140" required></label><label>HTTPS source link<input name="sourceUrl" type="url" placeholder="https://..."></label><label>Notes<textarea name="notes" maxlength="2500" rows="4"></textarea></label><button class="button button-dark">Register Evidence</button></form></section>`;
    wrap.querySelector("#evidence-form")?.addEventListener("submit", async (event) => {
      event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#evidence-message");
      const sourceUrl = validHttpsUrl(data.sourceUrl); if (clean(data.sourceUrl) && !sourceUrl) return showNotice(message, "Evidence links must use HTTPS.", "error");
      try {
        await createRecord("commandEvidence", { cognitusId: createCognitusId("EVD"), caseId: clean(data.caseId).slice(0, 140), type: clean(data.type), label: clean(data.label).slice(0, 140), sourceUrl: sourceUrl || null, notes: clean(data.notes).slice(0, 2500), status: "unverified", createdByUid: g3.authUser.uid }, "COMMAND_EVIDENCE_CREATED", "Registered case evidence.");
        toast("Evidence registered."); await evidencePage();
      } catch (error) { showNotice(message, error?.message || "Evidence could not be registered.", "error"); }
    });
  });
}

async function accreditationPage() {
  setTitle("Accreditation");
  if (!can(PERMISSIONS.ACCREDITATION_MANAGE)) return forbidden("Accreditation");
  const rows = newestFirst(await readCollection("commandAccreditations").catch(() => []), "updatedAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="accreditation">${pageHeader("Command · Accreditation", "Accreditation.", "Track organization accreditation from preliminary review through conditions, approval, denial, and renewal.", `<button class="button button-dark" id="new-accreditation">New Review</button>`)}<div id="accreditation-form-wrap" class="g3-form-wrap" hidden></div><section class="g3-grid">${rows.length ? rows.map((item) => `<article class="g3-card"><h3>${safe(item.organizationName)}</h3><p>${safe(item.conditions || "No conditions recorded.")}</p><div class="g3-card-meta"><span>${safe(item.organizationId)}</span><span>•</span><span>${safe(item.level || "standard")}</span><span>•</span><span>${safe(formatTimestamp(item.updatedAt))}</span></div><div class="g3-card-actions">${badge(item.status)}${!['accredited','denied'].includes(item.status) ? `<button class="button button-small button-dark" data-accreditation="accredited" data-id="${safe(item.id)}">Accredit</button><button class="button button-small" data-accreditation="denied" data-id="${safe(item.id)}">Deny</button>` : ""}</div></article>`).join("") : emptyState("AC", "No accreditation reviews", "Create a review when an organization enters the accreditation process.")}</section></div>`;
  root.querySelector("#new-accreditation")?.addEventListener("click", () => {
    const wrap = root.querySelector("#accreditation-form-wrap"); wrap.hidden = false;
    wrap.innerHTML = `<section class="form-card"><div id="accreditation-message" class="notice" hidden></div><form id="accreditation-form" class="form-stack"><div class="form-row"><label>Organization ID<input name="organizationId" required></label><label>Organization name<input name="organizationName" maxlength="120" required></label></div><div class="form-row"><label>Level<select name="level"><option value="standard">Standard</option><option value="enhanced">Enhanced</option><option value="conditional">Conditional</option></select></label><label>Initial stage<select name="status"><option value="preliminary_review">Preliminary Review</option><option value="documentation_review">Documentation Review</option><option value="risk_assessment">Risk Assessment</option><option value="final_review">Final Review</option></select></label></div><label>Conditions / review notes<textarea name="conditions" maxlength="2500" rows="4"></textarea></label><button class="button button-dark">Create Accreditation Review</button></form></section>`;
    wrap.querySelector("#accreditation-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#accreditation-message"); try { await createRecord("commandAccreditations", { cognitusId: createCognitusId("ACR"), organizationId: clean(data.organizationId).slice(0,140), organizationName: clean(data.organizationName).slice(0,120), level: clean(data.level), status: clean(data.status), conditions: clean(data.conditions).slice(0,2500), reviewerUid: g3.authUser.uid, expiresAt: null, createdByUid: g3.authUser.uid }, "COMMAND_ACCREDITATION_CREATED", "Opened accreditation review."); toast("Accreditation review created."); await accreditationPage(); } catch (error) { showNotice(message, error?.message || "Accreditation review could not be created.", "error"); } });
  });
  root.querySelectorAll("[data-accreditation]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandAccreditations", button.dataset.id, { status: button.dataset.accreditation, reviewerUid: g3.authUser.uid }, "COMMAND_ACCREDITATION_DECISION", `Accreditation ${button.dataset.accreditation}.`); toast("Accreditation updated."); await accreditationPage(); } catch (error) { alert(error?.message || "Accreditation update failed."); } }));
}

async function escalationsPage() {
  setTitle("Escalations");
  if (!can(PERMISSIONS.ESCALATIONS_MANAGE)) return forbidden("Escalations");
  const rows = newestFirst(await readCollection("commandEscalations").catch(() => []), "updatedAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="escalations">${pageHeader("Command · Escalation", "Escalations.", "Route matters that require a different department, higher authority, or specialized handling.", `<button class="button button-dark" id="new-escalation">New Escalation</button>`)}<div id="escalation-form-wrap" class="g3-form-wrap" hidden></div><section class="panel">${rows.length ? `<div class="g3-queue">${rows.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.title)}</strong><p>${safe(item.reason)}</p><small>${safe(getDepartment(item.fromDepartmentId).shortName)} → ${safe(getDepartment(item.toDepartmentId).shortName)} · ${safe(item.sourceType)} ${safe(item.sourceId || "")}</small></div><div>${priority(item.severity)} ${badge(item.status)}</div><div class="g3-actions">${!['resolved','closed'].includes(item.status) ? `<button class="button button-small button-dark" data-escalation-status="resolved" data-id="${safe(item.id)}">Resolve</button>` : ""}</div></article>`).join("")}</div>` : emptyState("ES", "No escalations", "There are no recorded escalations.")}</section></div>`;
  root.querySelector("#new-escalation")?.addEventListener("click", () => {
    const wrap = root.querySelector("#escalation-form-wrap"); wrap.hidden = false; wrap.innerHTML = `<section class="form-card"><div id="escalation-message" class="notice" hidden></div><form id="escalation-form" class="form-stack"><label>Title<input name="title" maxlength="140" required></label><label>Reason<textarea name="reason" maxlength="2500" rows="4" required></textarea></label><div class="form-row"><label>From department<select name="fromDepartmentId">${departmentOptions(departmentId())}</select></label><label>To department<select name="toDepartmentId">${departmentOptions("")}</select></label></div><div class="form-row"><label>Source type<select name="sourceType"><option value="case">Case</option><option value="ticket">Ticket</option><option value="report">Report</option><option value="incident">Incident</option><option value="other">Other</option></select></label><label>Source ID<input name="sourceId" maxlength="140"></label></div><label>Severity<select name="severity"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label><button class="button button-dark">Create Escalation</button></form></section>`;
    wrap.querySelector("#escalation-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#escalation-message"); try { await createRecord("commandEscalations", { cognitusId: createCognitusId("ESC"), title: clean(data.title).slice(0,140), reason: clean(data.reason).slice(0,2500), fromDepartmentId: clean(data.fromDepartmentId), toDepartmentId: clean(data.toDepartmentId), sourceType: clean(data.sourceType), sourceId: clean(data.sourceId).slice(0,140) || null, severity: clean(data.severity), status: "open", assignedToUid: null, createdByUid: g3.authUser.uid }, "COMMAND_ESCALATION_CREATED", "Created an operational escalation."); toast("Escalation created."); await escalationsPage(); } catch (error) { showNotice(message, error?.message || "Escalation could not be created.", "error"); } });
  });
  root.querySelectorAll("[data-escalation-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandEscalations", button.dataset.id, { status: button.dataset.escalationStatus }, "COMMAND_ESCALATION_RESOLVED", "Resolved an operational escalation."); toast("Escalation resolved."); await escalationsPage(); } catch (error) { alert(error?.message || "Escalation update failed."); } }));
}

async function incidentsPage() {
  setTitle("Incidents");
  if (!can(PERMISSIONS.INCIDENTS_MANAGE)) return forbidden("Incidents");
  const rows = newestFirst(await readCollection("commandIncidents").catch(() => []), "updatedAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="incidents">${pageHeader("Command · Incident Management", "Incidents.", "Coordinate exceptional operational, security, data, or organization-wide incidents from one controlled record.", `<button class="button button-dark" id="new-incident">Declare Incident</button>`)}<div id="incident-form-wrap" class="g3-form-wrap" hidden></div><section class="g3-grid">${rows.length ? rows.map((item) => `<article class="g3-card ${item.severity === "critical" ? "dark" : ""}"><h3>${safe(item.title)}</h3><p>${safe(item.summary)}</p><div class="g3-card-meta"><span>${safe(item.category)}</span><span>•</span><span>${safe(personName(item.commanderUid))}</span><span>•</span><span>${safe(formatTimestamp(item.updatedAt))}</span></div><div class="g3-card-actions">${priority(item.severity)}${badge(item.status)}${!['resolved','closed'].includes(item.status) ? `<button class="button button-small" data-incident-status="resolved" data-id="${safe(item.id)}">Resolve</button>` : ""}</div></article>`).join("") : emptyState("IC", "No incidents", "No major Cognitus incidents are active or recorded.")}</section></div>`;
  root.querySelector("#new-incident")?.addEventListener("click", () => {
    const wrap = root.querySelector("#incident-form-wrap"); wrap.hidden = false; wrap.innerHTML = `<section class="form-card"><div id="incident-message" class="notice" hidden></div><form id="incident-form" class="form-stack"><label>Incident title<input name="title" maxlength="140" required></label><label>Summary<textarea name="summary" maxlength="3000" rows="5" required></textarea></label><div class="form-row"><label>Category<select name="category"><option value="security">Security</option><option value="data_integrity">Data Integrity</option><option value="coordinated_abuse">Coordinated Abuse</option><option value="organization_dispute">Organization Dispute</option><option value="system">System</option><option value="other">Other</option></select></label><label>Severity<select name="severity"><option value="high">High</option><option value="critical">Critical</option><option value="normal">Normal</option></select></label></div><label>Incident commander<select name="commanderUid"><option value="${safe(g3.authUser.uid)}">${safe(g3.directorySelf?.displayName || "Me")}</option>${staffOptions(g3.authUser.uid)}</select></label><button class="button button-dark">Declare Incident</button></form></section>`;
    wrap.querySelector("#incident-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#incident-message"); try { const id = await createRecord("commandIncidents", { cognitusId: createCognitusId("INC"), title: clean(data.title).slice(0,140), category: clean(data.category), severity: clean(data.severity), status: "active", summary: clean(data.summary).slice(0,3000), commanderUid: clean(data.commanderUid) || g3.authUser.uid, departmentId: departmentId(), createdByUid: g3.authUser.uid }, "COMMAND_INCIDENT_DECLARED", "Declared a Cognitus operational incident."); await notify(clean(data.commanderUid), "incident", "Incident command assignment", `You are assigned as incident commander for ${clean(data.title).slice(0,140)}.`, "#/command/incidents"); toast(`Incident declared: ${id}`); await incidentsPage(); } catch (error) { showNotice(message, error?.message || "Incident could not be declared.", "error"); } });
  });
  root.querySelectorAll("[data-incident-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandIncidents", button.dataset.id, { status: button.dataset.incidentStatus }, "COMMAND_INCIDENT_RESOLVED", "Resolved an operational incident."); toast("Incident resolved."); await incidentsPage(); } catch (error) { alert(error?.message || "Incident update failed."); } }));
}

async function departmentCommandPage() {
  setTitle("Department Command");
  const dept = department();
  const roster = g3.directory.filter((entry) => entry.departmentId === dept.id && ["active", "training", "on_leave"].includes(entry.status));
  const [tasks, tickets, requests, projects] = await Promise.all([
    readQuery("commandTasks", [g3.Fire.where("departmentId", "==", dept.id)]).catch(() => []),
    readQuery("commandTickets", [g3.Fire.where("departmentId", "==", dept.id)]).catch(() => []),
    readQuery("commandRequests", [g3.Fire.where("departmentId", "==", dept.id)]).catch(() => []),
    readQuery("commandProjects", [g3.Fire.where("departmentId", "==", dept.id)]).catch(() => [])
  ]);
  const chief = roster.find((entry) => entry.rank === "chief-officer") || (dept.id === "executive-office" ? roster.find((entry) => entry.rank === "owner") : null);
  const specialist = dept.id === "public-relations" ? ["PR Command", "Campaigns, publications, media, partnerships", "#/public-relations"] : dept.id === "customer-service" ? ["Customer Service", "Service queue, analytics, response library", "#/customer-service"] : dept.id === "quality-assurance" ? ["Quality Assurance", "QA reviews, findings, corrective action", "#/quality"] : dept.id === "finance" ? ["Finance", "Finance ledger, payroll, approvals", "#/finance"] : dept.id === "human-resources" ? ["Human Resources", "Employee lifecycle, leave, people operations", "#/hr/lifecycle"] : ["Executive Command", "Company-wide operating and Board overview", "#/executive"];
  root.innerHTML = `<div class="page-inner" data-g3-page="department-command">${pageHeader(`${dept.code} · Live department`, `${dept.name} Command.`, "A department-level operating view that brings people, work, service, requests, and department-specific systems together.")}
    <section class="g3-kpi"><article><span>Roster</span><strong>${roster.length}</strong></article><article><span>Open Tasks</span><strong>${tasks.filter((row) => !['done','cancelled'].includes(row.status)).length}</strong></article><article><span>Open Tickets</span><strong>${tickets.filter((row) => !['resolved','closed'].includes(row.status)).length}</strong></article><article><span>Pending Requests</span><strong>${requests.filter((row) => ['submitted','pending','under_review'].includes(row.status)).length}</strong></article></section>
    <section class="content-grid" style="margin-top:18px"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Leadership</p><h2>${safe(dept.shortName)}</h2></div></header><div class="panel-body"><div class="g3-officer"><span class="avatar">${safe(initials(chief?.displayName || "Unassigned"))}</span><span class="g3-officer-copy"><strong>${safe(chief?.displayName || "Chief Officer unassigned")}</strong><span>${safe(dept.chiefTitle)}</span></span></div><div class="permission-list" style="margin-top:14px">${dept.focus.map((focus) => `<span class="permission-chip">${safe(focus)}</span>`).join("")}</div></div></section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Department system</p><h2>${safe(specialist[0])}</h2></div><a class="button button-small button-dark" href="${safe(specialist[2])}">Open</a></header><div class="panel-body"><p class="g3-note">${safe(specialist[1])}</p><div class="quick-grid" style="margin-top:14px"><a class="quick-card" href="#/tasks"><strong>Tasks</strong><span>${tasks.length} department records</span><span class="quick-card-arrow">→</span></a><a class="quick-card" href="#/requests"><strong>Requests</strong><span>${requests.length} department records</span><span class="quick-card-arrow">→</span></a><a class="quick-card" href="#/projects"><strong>Projects</strong><span>${projects.length} department records</span><span class="quick-card-arrow">→</span></a><a class="quick-card" href="#/tickets"><strong>Service Desk</strong><span>${tickets.length} department tickets</span><span class="quick-card-arrow">→</span></a></div></div></section></section>
  </div>`;
}

async function qualityPage() {
  setTitle("Quality Assurance");
  if (!canAny([PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT])) return forbidden("Quality Assurance");
  const [reviews, corrective] = await Promise.all([
    readCollection("commandQaReviews").catch(() => []),
    readCollection("commandCorrectiveActions").catch(() => [])
  ]);
  const scores = reviews.filter((item) => Number.isFinite(Number(item.score))).map((item) => Number(item.score));
  const average = scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : 0;
  root.innerHTML = `<div class="page-inner" data-g3-page="quality">${pageHeader("Department Command · QA", "Quality Assurance.", "Sample completed work, document findings, identify process weaknesses, and track corrective action without turning QA into an approval bottleneck.", canAny([PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT]) ? `<button class="button button-dark" id="new-qa">New QA Review</button>` : "")}
    <section class="g3-kpi"><article><span>Reviews</span><strong>${reviews.length}</strong></article><article><span>Average Score</span><strong>${average}%</strong></article><article><span>Open Findings</span><strong>${reviews.filter((row) => row.status === 'finding_open').length}</strong></article><article><span>Corrective Actions</span><strong>${corrective.filter((row) => !['completed','closed'].includes(row.status)).length}</strong></article></section><div id="qa-form-wrap" class="g3-form-wrap" hidden style="margin-top:14px"></div>
    <section class="content-grid" style="margin-top:18px"><section class="panel"><header class="panel-header"><div><p class="eyebrow">QA reviews</p><h2>Recent work</h2></div></header>${reviews.length ? `<div class="g3-queue">${newestFirst(reviews).map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.subjectType)} · ${safe(item.subjectId)}</strong><p>${safe(item.findings || "No findings recorded.")}</p><small>${safe(getDepartment(item.departmentId).shortName)} · ${safe(personName(item.employeeUid))}</small></div><div class="g3-score">${Number(item.score || 0)}%</div><div>${badge(item.status)}</div></article>`).join("")}</div>` : emptyState("QA", "No QA reviews", "QA sampling and audits will appear here.")}</section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Corrective action</p><h2>Open actions</h2></div></header>${corrective.length ? `<div class="g3-queue">${newestFirst(corrective).map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.title)}</strong><p>${safe(item.plan || "No remediation plan recorded.")}</p><small>${safe(getDepartment(item.departmentId).shortName)} · ${safe(personName(item.ownerUid))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${can(PERMISSIONS.QA_MANAGE) && !['completed','closed'].includes(item.status) ? `<button class="button button-small button-dark" data-corrective-complete data-id="${safe(item.id)}">Complete</button>` : ""}</div></article>`).join("")}</div>` : emptyState("CA", "No corrective actions", "No remediation work is currently recorded.")}</section></section></div>`;
  root.querySelector("#new-qa")?.addEventListener("click", () => {
    const wrap = root.querySelector("#qa-form-wrap"); wrap.hidden = false; wrap.innerHTML = `<section class="form-card"><div id="qa-message" class="notice" hidden></div><form id="qa-form" class="form-stack"><div class="form-row"><label>Subject type<select name="subjectType"><option value="ticket">Ticket</option><option value="report_review">Report Review</option><option value="appeal_review">Appeal Review</option><option value="case">Case</option><option value="department_process">Department Process</option><option value="other">Other</option></select></label><label>Subject ID<input name="subjectId" maxlength="140" required></label></div><div class="form-row"><label>Department<select name="departmentId">${departmentOptions(departmentId())}</select></label><label>Employee<select name="employeeUid"><option value="">Not employee-specific</option>${staffOptions()}</select></label></div><label>Score (0–100)<input name="score" type="number" min="0" max="100" value="100" required></label><label>Findings<textarea name="findings" maxlength="3000" rows="5"></textarea></label><label><input type="checkbox" name="requiresCorrective" value="yes"> Requires corrective action</label><button class="button button-dark">Save QA Review</button></form></section>`;
    wrap.querySelector("#qa-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#qa-message"); try { const score = Math.max(0, Math.min(100, Number(data.score || 0))); const reviewId = await createRecord("commandQaReviews", { cognitusId: createCognitusId("QAR"), subjectType: clean(data.subjectType), subjectId: clean(data.subjectId).slice(0,140), departmentId: clean(data.departmentId), employeeUid: clean(data.employeeUid) || null, score, status: data.requiresCorrective === "yes" ? "finding_open" : "closed", findings: clean(data.findings).slice(0,3000), reviewerUid: g3.authUser.uid, createdByUid: g3.authUser.uid }, "COMMAND_QA_REVIEW", "Created QA review."); if (data.requiresCorrective === "yes") await createRecord("commandCorrectiveActions", { cognitusId: createCognitusId("CAR"), qaReviewId: reviewId, departmentId: clean(data.departmentId), title: `Corrective action for ${clean(data.subjectType)} ${clean(data.subjectId).slice(0,80)}`, ownerUid: clean(data.employeeUid) || null, status: "open", plan: clean(data.findings).slice(0,3000), createdByUid: g3.authUser.uid }, "COMMAND_CORRECTIVE_ACTION", "Opened QA corrective action."); toast("QA review saved."); await qualityPage(); } catch (error) { showNotice(message, error?.message || "QA review could not be saved.", "error"); } });
  });
  root.querySelectorAll("[data-corrective-complete]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandCorrectiveActions", button.dataset.id, { status: "completed" }, "COMMAND_CORRECTIVE_COMPLETE", "Completed QA corrective action."); toast("Corrective action completed."); await qualityPage(); } catch (error) { alert(error?.message || "Corrective action update failed."); } }));
}

async function publicRelationsPage() {
  setTitle("Public Relations");
  if (!canAny([PERMISSIONS.PR_MANAGE, PERMISSIONS.PR_APPROVE])) return forbidden("Public Relations");
  const [campaigns, items] = await Promise.all([readCollection("commandPrCampaigns").catch(() => []), readCollection("commandPrItems").catch(() => [])]);
  root.innerHTML = `<div class="page-inner" data-g3-page="public-relations">${pageHeader("Department Command · Public Relations", "Public Relations Command.", "Manage campaigns, publications, partnerships, media requests, brand work, and crisis communication from a single PR workspace.", can(PERMISSIONS.PR_MANAGE) ? `<button class="button button-dark" id="new-pr-item">New PR Item</button>` : "")}
    <section class="g3-kpi"><article><span>Campaigns</span><strong>${campaigns.filter((row) => row.status === 'active').length}</strong></article><article><span>Drafts</span><strong>${items.filter((row) => row.status === 'draft').length}</strong></article><article><span>Awaiting Approval</span><strong>${items.filter((row) => row.status === 'pending_approval').length}</strong></article><article><span>Published / Closed</span><strong>${items.filter((row) => ['published','closed'].includes(row.status)).length}</strong></article></section><div id="pr-form-wrap" class="g3-form-wrap" hidden style="margin-top:14px"></div>
    <section class="content-grid" style="margin-top:18px"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Campaigns</p><h2>Active strategy</h2></div>${can(PERMISSIONS.PR_MANAGE) ? `<button class="button button-small" id="new-campaign">New Campaign</button>` : ""}</header>${campaigns.length ? `<div class="g3-grid" style="padding:14px">${newestFirst(campaigns).map((item) => `<article class="g3-card"><h3>${safe(item.title)}</h3><p>${safe(item.objective)}</p><div class="g3-card-meta"><span>${safe(item.audience)}</span><span>•</span><span>${safe(personName(item.ownerUid))}</span></div><div class="g3-card-actions">${badge(item.status)}</div></article>`).join("")}</div>` : emptyState("PR", "No campaigns", "PR campaigns will appear here.")}</section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Publication & media queue</p><h2>PR work</h2></div></header>${items.length ? `<div class="g3-queue">${newestFirst(items).map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.title)}</strong><p>${safe(item.body || item.notes || "")}</p><small>${safe(titleCase(item.type))} · ${safe(personName(item.ownerUid))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${can(PERMISSIONS.PR_APPROVE) && item.status === 'pending_approval' ? `<button class="button button-small button-dark" data-pr-approve data-id="${safe(item.id)}">Approve</button>` : ""}${item.url ? `<a class="button button-small" href="${safe(item.url)}" target="_blank" rel="noopener">Open</a>` : ""}</div></article>`).join("")}</div>` : emptyState("PB", "No PR items", "Publications, partnerships, media work, and crisis statements will appear here.")}</section></section></div>`;
  const renderPrForm = (kind) => {
    const wrap = root.querySelector("#pr-form-wrap"); wrap.hidden = false;
    if (kind === "campaign") wrap.innerHTML = `<section class="form-card"><div id="pr-message" class="notice" hidden></div><form id="campaign-form" class="form-stack"><label>Campaign title<input name="title" maxlength="140" required></label><label>Objective<textarea name="objective" maxlength="2500" rows="4" required></textarea></label><label>Audience<input name="audience" maxlength="140" required></label><label>Owner<select name="ownerUid">${staffOptions(g3.authUser.uid, "public-relations")}</select></label><button class="button button-dark">Create Campaign</button></form></section>`;
    else wrap.innerHTML = `<section class="form-card"><div id="pr-message" class="notice" hidden></div><form id="pr-item-form" class="form-stack"><div class="form-row"><label>Type<select name="type"><option value="publication">Publication</option><option value="partnership">Partnership</option><option value="media_inquiry">Media Inquiry</option><option value="brand_resource">Brand Resource</option><option value="crisis_communication">Crisis Communication</option></select></label><label>Status<select name="status"><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option></select></label></div><label>Title<input name="title" maxlength="140" required></label><label>Body / notes<textarea name="body" maxlength="4000" rows="5"></textarea></label><label>HTTPS resource link<input name="url" type="url"></label><label>Owner<select name="ownerUid">${staffOptions(g3.authUser.uid, "public-relations")}</select></label><button class="button button-dark">Create PR Item</button></form></section>`;
    wrap.querySelector("#campaign-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#pr-message"); try { await createRecord("commandPrCampaigns", { cognitusId: createCognitusId("CAM"), title: clean(data.title).slice(0,140), objective: clean(data.objective).slice(0,2500), audience: clean(data.audience).slice(0,140), ownerUid: clean(data.ownerUid), status: "active", createdByUid: g3.authUser.uid }, "COMMAND_PR_CAMPAIGN", "Created PR campaign."); toast("Campaign created."); await publicRelationsPage(); } catch (error) { showNotice(message, error?.message || "Campaign could not be created.", "error"); } });
    wrap.querySelector("#pr-item-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#pr-message"); const url = validHttpsUrl(data.url); if (clean(data.url) && !url) return showNotice(message, "Resource links must use HTTPS.", "error"); try { const id = await createRecord("commandPrItems", { cognitusId: createCognitusId("PRI"), type: clean(data.type), title: clean(data.title).slice(0,140), status: clean(data.status), body: clean(data.body).slice(0,4000), url: url || null, ownerUid: clean(data.ownerUid), approvedByUid: null, approvedAt: null, createdByUid: g3.authUser.uid }, "COMMAND_PR_ITEM", "Created PR work item."); if (clean(data.status) === "pending_approval") await notify(clean(data.ownerUid), "pr", "PR item awaiting approval", `${clean(data.title).slice(0,140)} is pending approval.`, "#/public-relations"); toast(`PR item created: ${id}`); await publicRelationsPage(); } catch (error) { showNotice(message, error?.message || "PR item could not be created.", "error"); } });
  };
  root.querySelector("#new-campaign")?.addEventListener("click", () => renderPrForm("campaign")); root.querySelector("#new-pr-item")?.addEventListener("click", () => renderPrForm("item"));
  root.querySelectorAll("[data-pr-approve]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandPrItems", button.dataset.id, { status: "approved", approvedByUid: g3.authUser.uid, approvedAt: g3.Fire.serverTimestamp() }, "COMMAND_PR_APPROVED", "Approved PR work item."); toast("PR item approved."); await publicRelationsPage(); } catch (error) { alert(error?.message || "PR approval failed."); } }));
}

async function customerServicePage() {
  setTitle("Customer Service");
  if (!canAny([PERMISSIONS.CS_MANAGE, PERMISSIONS.TICKETS_MANAGE])) return forbidden("Customer Service");
  const [tickets, macros] = await Promise.all([
    readQuery("commandTickets", [g3.Fire.where("departmentId", "==", "customer-service")]).catch(() => []),
    readCollection("commandCsMacros").catch(() => [])
  ]);
  const open = tickets.filter((row) => !["resolved", "closed"].includes(row.status));
  const unresolvedHigh = open.filter((row) => ["high", "critical"].includes(row.priority));
  root.innerHTML = `<div class="page-inner" data-g3-page="customer-service">${pageHeader("Department Command · Customer Service", "Customer Service Command.", "Run the Cognitus service desk, monitor support health, route escalations, and maintain reusable response guidance without giving support staff record-edit authority they do not need.", can(PERMISSIONS.CS_MANAGE) ? `<button class="button button-dark" id="new-macro">New Saved Response</button>` : "")}
    <section class="g3-kpi"><article><span>Open Tickets</span><strong>${open.length}</strong></article><article><span>High Priority</span><strong>${unresolvedHigh.length}</strong></article><article><span>Waiting</span><strong>${open.filter((row) => String(row.status).startsWith('waiting')).length}</strong></article><article><span>Saved Responses</span><strong>${macros.filter((row) => row.status === 'active').length}</strong></article></section><div id="macro-form-wrap" class="g3-form-wrap" hidden style="margin-top:14px"></div>
    <section class="content-grid" style="margin-top:18px"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Service queue</p><h2>Customer Service tickets</h2></div><a class="button button-small" href="#/tickets">Open Service Desk</a></header>${tickets.length ? `<div class="g3-queue">${newestFirst(tickets).slice(0,20).map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.subject)}</strong><p>${safe(item.description || "")}</p><small>${safe(item.ticketNumber || item.cognitusId || item.id)} · ${safe(personName(item.assignedToUid))}</small></div><div>${priority(item.priority)} ${badge(item.status)}</div><div></div></article>`).join("")}</div>` : emptyState("CS", "Service queue clear", "Customer Service has no tickets in the visible queue.")}</section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Response library</p><h2>Saved guidance</h2></div></header>${macros.length ? `<div class="g3-queue">${alphabetic(macros, "title").map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.title)}</strong><p>${safe(item.body)}</p><small>${safe(item.category)}</small></div><div>${badge(item.status)}</div><div></div></article>`).join("")}</div>` : emptyState("SR", "No saved responses", "Create reusable guidance for common service situations.")}</section></section></div>`;
  root.querySelector("#new-macro")?.addEventListener("click", () => { const wrap = root.querySelector("#macro-form-wrap"); wrap.hidden = false; wrap.innerHTML = `<section class="form-card"><div id="macro-message" class="notice" hidden></div><form id="macro-form" class="form-stack"><div class="form-row"><label>Title<input name="title" maxlength="140" required></label><label>Category<select name="category"><option value="account">Account</option><option value="background_check_help">Background Check Help</option><option value="reports">Reports</option><option value="appeals">Appeals</option><option value="organizations">Organizations</option><option value="promotional_access">Promotional Access</option><option value="technical">Technical</option><option value="general">General</option></select></label></div><label>Response guidance<textarea name="body" maxlength="4000" rows="6" required></textarea></label><button class="button button-dark">Save Response</button></form></section>`; wrap.querySelector("#macro-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#macro-message"); try { await createRecord("commandCsMacros", { cognitusId: createCognitusId("CSR"), title: clean(data.title).slice(0,140), category: clean(data.category), body: clean(data.body).slice(0,4000), status: "active", createdByUid: g3.authUser.uid }, "COMMAND_CS_RESPONSE", "Created Customer Service saved response."); toast("Saved response created."); await customerServicePage(); } catch (error) { showNotice(message, error?.message || "Saved response could not be created.", "error"); } }); });
}

async function accountsPage() {
  setTitle("Executive Registry");
  if (!can(PERMISSIONS.ACCOUNTS_READ_ALL)) return forbidden("Executive Registry");

  const [accountsRaw, organizationsRaw] = await Promise.all([
    readCollection("users"),
    readCollection("organizations").catch(() => [])
  ]);
  const accounts = alphabetic(accountsRaw, "displayName");
  const organizations = alphabetic(organizationsRaw, "name");
  const staffIds = new Set(g3.directory.map((entry) => entry.uid || entry.id));
  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const canManageRegistry = owner();

  const activeCount = accounts.filter((entry) => entry.status === "active").length;
  const verifiedCount = accounts.filter((entry) => entry.identityVerified === true).length;
  const organizationCount = accounts.filter((entry) => entry.organizationId).length;
  const staffCount = accounts.filter((entry) => staffIds.has(entry.uid || entry.id)).length;

  root.innerHTML = `<div class="page-inner" data-g3-page="accounts" data-executive-registry-v2>
    ${pageHeader("Executive · Registry", "Accounts & organizations.", "A faster executive workspace for finding, reviewing, and—when authorized—editing Cognitus accounts and organizations. Chief Officers have company-wide visibility; Owner and Co-Owner have management controls.")}
    <section class="g3-kpi"><article><span>Total Accounts</span><strong>${accounts.length}</strong></article><article><span>Active</span><strong>${activeCount}</strong></article><article><span>Verified</span><strong>${verifiedCount}</strong></article><article><span>Staff Accounts</span><strong>${staffCount}</strong></article></section>
    <div class="registry-tabs" role="tablist" aria-label="Executive registry">
      <button class="button button-dark" type="button" data-registry-tab="accounts">Accounts</button>
      <button class="button" type="button" data-registry-tab="organizations">Organizations <span class="registry-count">${organizations.length}</span></button>
    </div>
    <section id="registry-surface"></section>
    <div id="registry-drawer-host"></div>
  </div>`;

  const surface = root.querySelector("#registry-surface");
  const drawerHost = root.querySelector("#registry-drawer-host");
  let activeTab = "accounts";

  const closeDrawer = () => {
    drawerHost.innerHTML = "";
    document.body.classList.remove("registry-drawer-open");
  };

  const showDrawer = (html) => {
    drawerHost.innerHTML = `<div class="registry-backdrop" data-registry-close></div><aside class="registry-drawer" role="dialog" aria-modal="true" aria-label="Executive registry editor">${html}</aside>`;
    document.body.classList.add("registry-drawer-open");
    drawerHost.querySelectorAll("[data-registry-close]").forEach((node) => node.addEventListener("click", closeDrawer));
  };

  const organizationOptions = (selected = "") => `<option value="">No organization</option>${organizations.map((org) => `<option value="${safe(org.id)}" ${org.id === selected ? "selected" : ""}>${safe(org.name || org.cognitusId || org.id)}</option>`).join("")}`;

  const openAccount = async (uid) => {
    const account = accounts.find((entry) => (entry.uid || entry.id) === uid);
    if (!account) return;
    const profile = await readDoc("profiles", uid).catch(() => null);
    const isTrueOwner = account.role === "owner";
    const editable = canManageRegistry && !isTrueOwner;
    const isStaffAccount = staffIds.has(uid);
    const verificationStatuses = ["self_declared", "claimed_unverified", "claimed", "employer_supplied", "verified", "unverified", "disputed"];
    const standings = ["unreviewed", "good_standing", "watch", "concern", "restricted", "disqualified"];
    const riskLevels = ["unreviewed", "low", "moderate", "high", "critical"];
    const roles = ["user", "verified_employer_member", "org_admin", "reviewer", "admin"];
    const statuses = ["active", "pending_verification", "suspended", "restricted", "banned", "password_reset_required"];
    const disabled = editable ? "" : "disabled";

    showDrawer(`<header class="registry-drawer-header"><div><p class="eyebrow">Account · ${safe(account.cognitusId || uid)}</p><h2>${safe(account.displayName || account.discordUsername || "Cognitus Account")}</h2><p>${isTrueOwner ? "The primary Owner account is protected from registry edits." : editable ? "Edit account access, verification, trust, standing, risk, and organization membership." : "Read-only executive account view."}</p></div><button class="button button-small" type="button" data-registry-close>Close</button></header>
      <div id="registry-editor-message" class="notice" hidden></div>
      <form id="registry-account-form" class="registry-form">
        <section class="registry-section"><div class="registry-section-title"><strong>Account</strong><span>${safe(account.discordId || "No Discord ID")}</span></div>
          <div class="form-row"><label>Display name<input name="displayName" value="${safe(account.displayName || "")}" maxlength="120" ${disabled}></label><label>Discord username<input name="discordUsername" value="${safe(account.discordUsername || "")}" maxlength="100" ${disabled}></label></div>
          <div class="form-row"><label>Role<select name="role" ${disabled}>${roles.map((value) => `<option value="${value}" ${value === account.role ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}${isTrueOwner ? `<option value="owner" selected>Owner</option>` : ""}</select></label><label>Account status<select name="status" ${disabled}>${statuses.map((value) => `<option value="${value}" ${value === account.status ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div>
          <label>Organization<select name="organizationId" ${disabled}>${organizationOptions(account.organizationId || "")}</select></label>
          <label class="registry-check"><input name="identityVerified" type="checkbox" ${account.identityVerified === true ? "checked" : ""} ${disabled}><span><strong>Verified account</strong><small>Controls the account-level identityVerified flag.</small></span></label>
        </section>
        <section class="registry-section"><div class="registry-section-title"><strong>Trust & standing</strong><span>${profile ? safe(profile.cognitusId || "Profile linked") : "No linked profile"}</span></div>
          ${profile ? `<div class="form-row"><label>Verification status<select name="identityStatus" ${disabled}>${verificationStatuses.map((value) => `<option value="${value}" ${value === profile.identityStatus ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Trust rating<input name="identityConfidence" type="number" min="0" max="100" step="1" value="${safe(Number.isFinite(Number(profile.identityConfidence)) ? Number(profile.identityConfidence) : 0)}" ${disabled}><small>0–100 identity confidence.</small></label></div><div class="form-row"><label>Standing<select name="professionalStanding" ${disabled}>${standings.map((value) => `<option value="${value}" ${value === profile.professionalStanding ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Risk level<select name="riskLevel" ${disabled}>${riskLevels.map((value) => `<option value="${value}" ${value === profile.riskLevel ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div>` : `<div class="g3-callout"><strong>No profile record.</strong>This account can still be managed, but trust, standing, and profile verification are unavailable until a profile exists.</div>`}
        </section>
        <section class="registry-section registry-readonly"><div class="registry-section-title"><strong>Identifiers</strong><span>Protected</span></div><dl class="registry-dl"><dt>Cognitus ID</dt><dd>${safe(account.cognitusId || "—")}</dd><dt>UID</dt><dd>${safe(uid)}</dd><dt>Discord ID</dt><dd>${safe(account.discordId || "—")}</dd><dt>Staff</dt><dd>${isStaffAccount ? "Yes" : "No"}</dd></dl></section>
        ${editable ? `<div class="registry-savebar"><button class="button button-dark" type="submit">Save Account</button><span>Changes are written to the shared Cognitus records immediately.</span></div>` : ""}
      </form>
      ${editable ? `<section class="registry-danger"><div><strong>Delete account</strong><p>Removes the Cognitus user record and immediately blocks product access. Historical reports and profile records are retained for referential integrity. Firebase Authentication credentials cannot be physically removed from this static client portal.</p></div><button class="button" type="button" id="registry-delete-account" ${isStaffAccount ? "disabled" : ""}>${isStaffAccount ? "Staff Account Protected" : "Delete Account"}</button></section>` : ""}`);

    const form = drawerHost.querySelector("#registry-account-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editable) return;
      const message = drawerHost.querySelector("#registry-editor-message");
      const data = formObject(form);
      const trust = Math.max(0, Math.min(100, Number(data.identityConfidence || 0)));
      const button = form.querySelector('button[type="submit"]');
      try {
        setBusy(button, true, "Saving…", "Save Account");
        await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "users", uid), {
          displayName: clean(data.displayName).slice(0, 120),
          discordUsername: clean(data.discordUsername).slice(0, 100),
          role: clean(data.role),
          status: clean(data.status),
          organizationId: clean(data.organizationId) || null,
          identityVerified: Boolean(form.querySelector('[name="identityVerified"]')?.checked),
          updatedAt: g3.Fire.serverTimestamp()
        });
        if (profile) {
          await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "profiles", uid), {
            displayName: clean(data.displayName).slice(0, 120),
            identityStatus: clean(data.identityStatus),
            identityConfidence: trust,
            professionalStanding: clean(data.professionalStanding),
            riskLevel: clean(data.riskLevel),
            lastReviewedAt: g3.Fire.serverTimestamp(),
            updatedAt: g3.Fire.serverTimestamp()
          });
        }
        await writeActivity("EXEC_ACCOUNT_UPDATED", "user", uid, `Executive updated account ${account.cognitusId || uid}.`, { role: clean(data.role), status: clean(data.status), organizationId: clean(data.organizationId) || null, identityVerified: Boolean(form.querySelector('[name="identityVerified"]')?.checked), trustRating: profile ? trust : null });
        toast("Account updated.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        showNotice(message, error?.message || "Account could not be updated.", "error");
      } finally {
        setBusy(button, false, "Saving…", "Save Account");
      }
    });

    drawerHost.querySelector("#registry-delete-account")?.addEventListener("click", async () => {
      if (!editable || isStaffAccount) return;
      if (!confirm(`Delete ${account.displayName || account.cognitusId || "this account"}? This removes the Cognitus user record and blocks product access.`)) return;
      if (prompt('Type DELETE to confirm this account deletion.') !== 'DELETE') return;
      try {
        await writeActivity("EXEC_ACCOUNT_DELETED", "user", uid, `Executive deleted account ${account.cognitusId || uid}.`);
        await g3.Fire.deleteDoc(g3.Fire.doc(g3.db, "users", uid));
        toast("Account deleted.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        alert(error?.message || "Account deletion failed.");
      }
    });
  };

  const openOrganization = (orgId) => {
    const org = organizations.find((entry) => entry.id === orgId);
    if (!org) return;
    const editable = canManageRegistry;
    const linkedAccounts = accounts.filter((account) => account.organizationId === orgId);
    const verification = ["pending_verification", "verified", "unverified", "suspended", "restricted"];
    const trust = ["unreviewed", "good", "watch", "concern", "high_risk"];
    const disabled = editable ? "" : "disabled";

    showDrawer(`<header class="registry-drawer-header"><div><p class="eyebrow">Organization · ${safe(org.cognitusId || org.id)}</p><h2>${safe(org.name || "Unnamed Organization")}</h2><p>${editable ? "Edit organization identity, verification, trust, and public metadata." : "Read-only executive organization view."}</p></div><button class="button button-small" type="button" data-registry-close>Close</button></header>
      <div id="registry-editor-message" class="notice" hidden></div>
      <form id="registry-org-form" class="registry-form">
        <section class="registry-section"><div class="form-row"><label>Name<input name="name" value="${safe(org.name || "")}" maxlength="140" ${disabled}></label><label>Type<input name="organizationType" value="${safe(org.organizationType || "")}" maxlength="100" ${disabled}></label></div><label>Country<input name="country" value="${safe(org.country || "")}" maxlength="100" ${disabled}></label><div class="form-row"><label>Verification<select name="verificationStatus" ${disabled}>${verification.map((value) => `<option value="${value}" ${value === org.verificationStatus ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Trust level<select name="trustLevel" ${disabled}>${trust.map((value) => `<option value="${value}" ${value === org.trustLevel ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div><label>Public notes<textarea name="publicNotes" rows="5" maxlength="3000" ${disabled}>${safe(org.publicNotes || "")}</textarea></label></section>
        <section class="registry-section registry-readonly"><dl class="registry-dl"><dt>Linked accounts</dt><dd>${linkedAccounts.length}</dd><dt>Stored member count</dt><dd>${safe(org.memberCount ?? 0)}</dd><dt>Document ID</dt><dd>${safe(org.id)}</dd></dl></section>
        ${editable ? `<div class="registry-savebar"><button class="button button-dark" type="submit">Save Organization</button><span>Verification and trust changes are reflected throughout Cognitus.</span></div>` : ""}
      </form>
      ${editable ? `<section class="registry-danger"><div><strong>Delete organization</strong><p>Linked accounts are detached first. Historical records keep their original organization references for audit and reporting continuity.</p></div><button class="button" type="button" id="registry-delete-org">Delete Organization</button></section>` : ""}`);

    const form = drawerHost.querySelector("#registry-org-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editable) return;
      const data = formObject(form);
      const message = drawerHost.querySelector("#registry-editor-message");
      const button = form.querySelector('button[type="submit"]');
      try {
        setBusy(button, true, "Saving…", "Save Organization");
        await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "organizations", orgId), {
          name: clean(data.name).slice(0, 140),
          searchableName: lower(data.name),
          organizationType: clean(data.organizationType).slice(0, 100),
          country: clean(data.country).slice(0, 100),
          verificationStatus: clean(data.verificationStatus),
          trustLevel: clean(data.trustLevel),
          publicNotes: clean(data.publicNotes).slice(0, 3000),
          updatedAt: g3.Fire.serverTimestamp()
        });
        await writeActivity("EXEC_ORG_UPDATED", "organization", orgId, `Executive updated organization ${org.cognitusId || orgId}.`, { verificationStatus: clean(data.verificationStatus), trustLevel: clean(data.trustLevel) });
        toast("Organization updated.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        showNotice(message, error?.message || "Organization could not be updated.", "error");
      } finally {
        setBusy(button, false, "Saving…", "Save Organization");
      }
    });

    drawerHost.querySelector("#registry-delete-org")?.addEventListener("click", async () => {
      if (!editable) return;
      if (!confirm(`Delete ${org.name || org.cognitusId || "this organization"}? ${linkedAccounts.length} linked account(s) will be detached.`)) return;
      if (prompt('Type DELETE to confirm this organization deletion.') !== 'DELETE') return;
      try {
        for (let index = 0; index < linkedAccounts.length; index += 400) {
          const batch = g3.Fire.writeBatch(g3.db);
          linkedAccounts.slice(index, index + 400).forEach((account) => {
            const uid = account.uid || account.id;
            batch.update(g3.Fire.doc(g3.db, "users", uid), { organizationId: null, updatedAt: g3.Fire.serverTimestamp() });
          });
          await batch.commit();
        }
        await writeActivity("EXEC_ORG_DELETED", "organization", orgId, `Executive deleted organization ${org.cognitusId || orgId}.`, { detachedAccounts: linkedAccounts.length });
        await g3.Fire.deleteDoc(g3.Fire.doc(g3.db, "organizations", orgId));
        toast("Organization deleted.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        alert(error?.message || "Organization deletion failed.");
      }
    });
  };

  const renderAccounts = () => {
    activeTab = "accounts";
    root.querySelectorAll("[data-registry-tab]").forEach((button) => button.classList.toggle("button-dark", button.dataset.registryTab === "accounts"));
    surface.innerHTML = `<section class="panel"><header class="panel-header"><div><p class="eyebrow">Account directory</p><h2>Every account</h2></div><span>${canManageRegistry ? "Owner controls enabled" : "Executive read-only"}</span></header><div class="panel-body"><div class="registry-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="executive-account-search" type="search" placeholder="Name, Discord, Cognitus ID, UID, organization…" autocomplete="off"></div><select id="executive-account-role"><option value="">All roles</option><option value="user">User</option><option value="verified_employer_member">Verified Employer Member</option><option value="org_admin">Organization Admin</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option><option value="owner">Owner</option></select><select id="executive-account-status"><option value="">All statuses</option><option value="active">Active</option><option value="pending_verification">Pending Verification</option><option value="restricted">Restricted</option><option value="suspended">Suspended</option><option value="banned">Banned</option><option value="password_reset_required">Password Reset Required</option></select><select id="executive-account-verified"><option value="">Any verification</option><option value="verified">Verified</option><option value="unverified">Not verified</option></select></div><div id="executive-account-results"></div></div></section>`;
    const search = surface.querySelector("#executive-account-search");
    const roleFilter = surface.querySelector("#executive-account-role");
    const statusFilter = surface.querySelector("#executive-account-status");
    const verifiedFilter = surface.querySelector("#executive-account-verified");
    const results = surface.querySelector("#executive-account-results");
    const render = () => {
      const query = lower(search?.value || "");
      const selectedRole = roleFilter?.value || "";
      const selectedStatus = statusFilter?.value || "";
      const selectedVerified = verifiedFilter?.value || "";
      const filtered = accounts.filter((account) => {
        if (selectedRole && account.role !== selectedRole) return false;
        if (selectedStatus && account.status !== selectedStatus) return false;
        if (selectedVerified === "verified" && account.identityVerified !== true) return false;
        if (selectedVerified === "unverified" && account.identityVerified === true) return false;
        if (!query) return true;
        const orgName = orgById.get(account.organizationId)?.name || "";
        return [account.displayName, account.discordUsername, account.discordId, account.cognitusId, account.uid || account.id, account.role, account.organizationId, orgName, account.status].some((value) => lower(String(value || "")).includes(query));
      });
      results.innerHTML = filtered.length ? `<div class="registry-list">${filtered.map((account) => {
        const uid = account.uid || account.id;
        const org = orgById.get(account.organizationId);
        return `<article class="registry-row"><div class="registry-main"><div class="registry-name"><strong>${safe(account.displayName || account.discordUsername || "Cognitus Account")}</strong>${staffIds.has(uid) ? `<span class="registry-staff">STAFF</span>` : ""}</div><p>${safe(account.discordUsername || "No Discord username")} · ${safe(account.discordId || "No Discord ID")}</p><small>${safe(account.cognitusId || uid)}${org ? ` · ${safe(org.name)}` : account.organizationId ? ` · Org ${safe(account.organizationId)}` : ""}</small></div><div class="registry-badges">${badge(account.role)} ${badge(account.status)} ${account.identityVerified === true ? `<span class="badge active">Verified</span>` : `<span class="badge">Unverified</span>`}</div><div class="registry-actions"><button class="button button-small ${canManageRegistry && account.role !== 'owner' ? 'button-dark' : ''}" type="button" data-open-account="${safe(uid)}">${canManageRegistry && account.role !== 'owner' ? "Edit" : "View"}</button>${staffIds.has(uid) ? `<a class="button button-small" href="#/staff/${safe(uid)}">Staff</a>` : ""}</div></article>`;
      }).join("")}</div>` : emptyState("UA", "No accounts matched", "Change the search or filters to see other Cognitus accounts.");
      results.querySelectorAll("[data-open-account]").forEach((button) => button.addEventListener("click", () => openAccount(button.dataset.openAccount)));
    };
    [search, roleFilter, statusFilter, verifiedFilter].forEach((node) => node?.addEventListener(node?.tagName === "INPUT" ? "input" : "change", debounce(render, 70)));
    render();
  };

  const renderOrganizations = () => {
    activeTab = "organizations";
    root.querySelectorAll("[data-registry-tab]").forEach((button) => button.classList.toggle("button-dark", button.dataset.registryTab === "organizations"));
    surface.innerHTML = `<section class="panel"><header class="panel-header"><div><p class="eyebrow">Organization registry</p><h2>Every organization</h2></div><span>${organizations.length} organizations</span></header><div class="panel-body"><div class="registry-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="executive-org-search" type="search" placeholder="Organization name, Cognitus ID, type, country…" autocomplete="off"></div><select id="executive-org-verification"><option value="">All verification</option><option value="pending_verification">Pending Verification</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="suspended">Suspended</option><option value="restricted">Restricted</option></select><select id="executive-org-trust"><option value="">All trust levels</option><option value="unreviewed">Unreviewed</option><option value="good">Good</option><option value="watch">Watch</option><option value="concern">Concern</option><option value="high_risk">High Risk</option></select></div><div id="executive-org-results"></div></div></section>`;
    const search = surface.querySelector("#executive-org-search");
    const verificationFilter = surface.querySelector("#executive-org-verification");
    const trustFilter = surface.querySelector("#executive-org-trust");
    const results = surface.querySelector("#executive-org-results");
    const render = () => {
      const query = lower(search?.value || "");
      const verificationValue = verificationFilter?.value || "";
      const trustValue = trustFilter?.value || "";
      const filtered = organizations.filter((org) => {
        if (verificationValue && org.verificationStatus !== verificationValue) return false;
        if (trustValue && org.trustLevel !== trustValue) return false;
        return !query || [org.name, org.cognitusId, org.id, org.organizationType, org.country, org.verificationStatus, org.trustLevel].some((value) => lower(String(value || "")).includes(query));
      });
      results.innerHTML = filtered.length ? `<div class="registry-list">${filtered.map((org) => {
        const linked = accounts.filter((account) => account.organizationId === org.id).length;
        return `<article class="registry-row"><div class="registry-main"><strong>${safe(org.name || "Unnamed Organization")}</strong><p>${safe(org.organizationType || "Organization")}${org.country ? ` · ${safe(org.country)}` : ""}</p><small>${safe(org.cognitusId || org.id)} · ${linked} linked account${linked === 1 ? "" : "s"}</small></div><div class="registry-badges">${badge(org.verificationStatus)} ${badge(org.trustLevel)}</div><div class="registry-actions"><button class="button button-small ${canManageRegistry ? 'button-dark' : ''}" type="button" data-open-org="${safe(org.id)}">${canManageRegistry ? "Edit" : "View"}</button></div></article>`;
      }).join("")}</div>` : emptyState("OR", "No organizations matched", "Change the search or filters to see other organizations.");
      results.querySelectorAll("[data-open-org]").forEach((button) => button.addEventListener("click", () => openOrganization(button.dataset.openOrg)));
    };
    [search, verificationFilter, trustFilter].forEach((node) => node?.addEventListener(node?.tagName === "INPUT" ? "input" : "change", debounce(render, 70)));
    render();
  };

  root.querySelectorAll("[data-registry-tab]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.registryTab === activeTab) return;
    button.dataset.registryTab === "organizations" ? renderOrganizations() : renderAccounts();
  }));
  renderAccounts();
}

async function executivePage() {
  setTitle("Executive Command");
  if (!(owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.AUDIT_READ))) return forbidden("Executive Command");
  const [tasks, tickets, cases, incidents, escalations, approvals, qa, lifecycle] = await Promise.all([
    readCollection("commandTasks").catch(() => []), readCollection("commandTickets").catch(() => []), readCollection("commandCases").catch(() => []), readCollection("commandIncidents").catch(() => []), readCollection("commandEscalations").catch(() => []), readCollection("commandExecutiveApprovals").catch(() => []), readCollection("commandQaReviews").catch(() => []), readCollection("commandLifecycle").catch(() => [])
  ]);
  const officers = DEPARTMENTS.map((dept) => ({ dept, person: g3.directory.find((entry) => entry.departmentId === dept.id && (entry.rank === "chief-officer" || (dept.id === "executive-office" && entry.rank === "owner"))) }));
  root.innerHTML = `<div class="page-inner" data-g3-page="executive">${pageHeader("Board of Directors · Executive Office", "Executive Command.", "A company-wide operating picture for Cognitus leadership: people, service, casework, incidents, quality, approvals, and department health.")}
    <section class="g3-kpi"><article><span>Active Staff</span><strong>${g3.directory.filter((row) => row.status === 'active').length}</strong></article><article><span>Open Tasks</span><strong>${tasks.filter((row) => !['done','cancelled'].includes(row.status)).length}</strong></article><article><span>Open Cases</span><strong>${cases.filter((row) => !['closed','archived'].includes(row.status)).length}</strong></article><article><span>Open Tickets</span><strong>${tickets.filter((row) => !['resolved','closed'].includes(row.status)).length}</strong></article><article><span>Active Incidents</span><strong>${incidents.filter((row) => !['resolved','closed'].includes(row.status)).length}</strong></article><article><span>Escalations</span><strong>${escalations.filter((row) => !['resolved','closed'].includes(row.status)).length}</strong></article><article><span>Approvals</span><strong>${approvals.filter((row) => row.status === 'pending').length}</strong></article><article><span>Lifecycle Actions</span><strong>${lifecycle.filter((row) => !['completed','closed'].includes(row.status)).length}</strong></article></section>
    <section class="content-grid" style="margin-top:18px"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Board leadership</p><h2>Chief Officers</h2></div></header><div class="panel-body">${officers.map(({dept,person}) => `<div class="g3-officer"><span class="avatar">${safe(initials(person?.displayName || dept.code))}</span><span class="g3-officer-copy"><strong>${safe(person?.displayName || "Unassigned")}</strong><span>${safe(dept.chiefTitle)} · ${safe(dept.name)}</span></span></div>`).join("")}</div></section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Company health</p><h2>Department workload</h2></div></header><div class="panel-body">${DEPARTMENTS.map((dept) => { const deptTasks = tasks.filter((row) => row.departmentId === dept.id && !['done','cancelled'].includes(row.status)).length; const deptTickets = tickets.filter((row) => row.departmentId === dept.id && !['resolved','closed'].includes(row.status)).length; const value = Math.min(100, (deptTasks + deptTickets) * 8); return `<div class="g3-detail" style="margin-bottom:8px"><span>${safe(dept.name)}</span><strong>${deptTasks} tasks · ${deptTickets} tickets</strong><div class="g3-meter"><span style="width:${value}%"></span></div></div>`; }).join("")}</div></section></section>
    <section class="g3-grid" style="margin-top:18px"><a class="quick-card" href="#/executive/approvals"><strong>Executive Approvals</strong><span>${approvals.filter((row) => row.status === 'pending').length} pending</span><span class="quick-card-arrow">→</span></a><a class="quick-card" href="#/executive/audit"><strong>Audit Center</strong><span>Search recent authenticated activity</span><span class="quick-card-arrow">→</span></a><a class="quick-card" href="#/quality"><strong>Quality Assurance</strong><span>${qa.filter((row) => row.status !== 'closed').length} open QA records</span><span class="quick-card-arrow">→</span></a></section>
  </div>`;
}

async function approvalsPage() {
  setTitle("Executive Approvals");
  if (!(owner() || can(PERMISSIONS.SYSTEM_MANAGE))) return forbidden("Executive Approvals");
  const approvals = newestFirst(await readCollection("commandExecutiveApprovals").catch(() => []), "updatedAt");
  root.innerHTML = `<div class="page-inner" data-g3-page="approvals">${pageHeader("Executive · Governance", "Approval center.", "Centralize consequential cross-company approvals without conflating them with routine tickets or automated background checks.", `<button class="button button-dark" id="new-approval">New Approval</button>`)}<div id="approval-form-wrap" class="g3-form-wrap" hidden></div><section class="panel">${approvals.length ? `<div class="g3-queue">${approvals.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.title)}</strong><p>${safe(item.reason)}</p><small>${safe(titleCase(item.type))} · ${safe(getDepartment(item.departmentId).shortName)} · requested by ${safe(personName(item.requestedByUid))}</small></div><div>${badge(item.status)}</div><div class="g3-actions">${item.status === 'pending' ? `<button class="button button-small button-dark" data-approval="approved" data-id="${safe(item.id)}">Approve</button><button class="button button-small" data-approval="denied" data-id="${safe(item.id)}">Deny</button>` : ""}</div></article>`).join("")}</div>` : emptyState("EA", "No approvals", "No executive approvals are recorded.")}</section></div>`;
  root.querySelector("#new-approval")?.addEventListener("click", () => { const wrap = root.querySelector("#approval-form-wrap"); wrap.hidden = false; wrap.innerHTML = `<section class="form-card"><div id="approval-message" class="notice" hidden></div><form id="approval-form" class="form-stack"><div class="form-row"><label>Type<select name="type"><option value="policy_exception">Policy Exception</option><option value="access_change">Access Change</option><option value="staffing">Staffing</option><option value="financial">Financial</option><option value="operational">Operational</option><option value="other">Other</option></select></label><label>Department<select name="departmentId">${departmentOptions(departmentId())}</select></label></div><label>Title<input name="title" maxlength="140" required></label><label>Reason<textarea name="reason" maxlength="2500" rows="5" required></textarea></label><button class="button button-dark">Create Approval Record</button></form></section>`; wrap.querySelector("#approval-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); const message = wrap.querySelector("#approval-message"); try { await createRecord("commandExecutiveApprovals", { cognitusId: createCognitusId("APR"), type: clean(data.type), departmentId: clean(data.departmentId), title: clean(data.title).slice(0,140), reason: clean(data.reason).slice(0,2500), status: "pending", requestedByUid: g3.authUser.uid, decidedByUid: null, decidedAt: null, createdByUid: g3.authUser.uid }, "COMMAND_EXEC_APPROVAL_CREATED", "Created executive approval record."); toast("Approval record created."); await approvalsPage(); } catch (error) { showNotice(message, error?.message || "Approval could not be created.", "error"); } }); });
  root.querySelectorAll("[data-approval]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandExecutiveApprovals", button.dataset.id, { status: button.dataset.approval, decidedByUid: g3.authUser.uid, decidedAt: g3.Fire.serverTimestamp() }, "COMMAND_EXEC_APPROVAL_DECISION", `Executive approval ${button.dataset.approval}.`); toast("Approval decision saved."); await approvalsPage(); } catch (error) { alert(error?.message || "Approval decision failed."); } }));
}

async function auditPage() {
  setTitle("Audit Center");
  if (!(owner() || can(PERMISSIONS.AUDIT_READ))) return forbidden("Audit Center");
  const activity = newestFirst(await readCollection("auditLogs").catch(() => [])).slice(0, 250);
  root.innerHTML = `<div class="page-inner" data-g3-page="audit">${pageHeader("Executive · Traceability", "Audit Center.", "Search recent authenticated Cognitus activity by action, actor, target, or summary. These are client-authenticated activity events, not a server-tamper-evident ledger.")}
    <div class="g3-toolbar" style="margin-bottom:14px"><div class="input-shell"><span class="input-icon">⌕</span><input id="audit-search" type="search" placeholder="Search action, actor, target, summary…"></div></div><section class="panel"><div id="audit-results"></div></section></div>`;
  const input = root.querySelector("#audit-search"); const results = root.querySelector("#audit-results");
  const renderResults = () => { const q = lower(input.value); const filtered = activity.filter((item) => !q || lower(`${item.action} ${item.actorCognitusId} ${item.actorUid} ${item.targetType} ${item.targetId} ${item.summary}`).includes(q)).slice(0,100); results.innerHTML = filtered.length ? `<div class="g3-queue">${filtered.map((item) => `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(item.action || "ACTION")}</strong><p>${safe(item.summary || "")}</p><small>${safe(item.actorCognitusId || item.actorUid || "Unknown")} · ${safe(item.targetType || "record")} ${safe(item.targetId || "")} · ${safe(formatTimestamp(item.createdAt))}</small></div><div>${safe(item.actorRole || "")}</div><div></div></article>`).join("")}</div>` : emptyState("AU", "No matches", "No audit activity matches this search."); };
  input.addEventListener("input", debounce(renderResults, 80)); renderResults();
}

function forbidden(area) {
  root.innerHTML = `<div class="page-inner" data-g3-page="forbidden">${emptyState("!", "Permission required", `Your active Cognitus staff identity does not have permission to open ${area}.`, `<a class="button" href="#/command">Return to Command</a>`)}</div>`;
}

async function renderRoute() {
  if (!g3.ready || g3.rendering || !G3_ROUTES.has(route())) return;
  if (!activeStaff()) return;
  g3.rendering = true;
  try {
    augmentChrome();
    const current = route();
    if (current === "/command") await commandOverviewPage();
    else if (current === "/command/reports") await reportsPage();
    else if (current === "/command/claims") await claimsPage();
    else if (current === "/command/appeals") await appealsPage();
    else if (current === "/command/organizations") await organizationsPage();
    else if (current === "/command/cases") await casesPage();
    else if (current === "/command/evidence") await evidencePage();
    else if (current === "/command/accreditation") await accreditationPage();
    else if (current === "/command/escalations") await escalationsPage();
    else if (current === "/command/incidents") await incidentsPage();
    else if (current === "/department-command") await departmentCommandPage();
    else if (current === "/quality") await qualityPage();
    else if (current === "/public-relations") await publicRelationsPage();
    else if (current === "/customer-service") await customerServicePage();
    else if (current === "/executive") await executivePage();
    else if (current === "/executive/accounts") await accountsPage();
    else if (current === "/executive/approvals") await approvalsPage();
    else if (current === "/executive/audit") await auditPage();
  } catch (error) {
    console.error("Generation 3 route error", error);
    root.innerHTML = `<div class="page-inner" data-g3-page="error">${emptyState("!", "Command could not load", error?.message || "This Command workspace could not be loaded.", `<a class="button" href="#/command">Command Overview</a>`)}</div>`;
  } finally {
    g3.rendering = false;
  }
}

function appendCommandPages() {
  if (!activeStaff() || commandOverlay?.hidden || !commandResults) return;
  commandResults.querySelectorAll("[data-g3-command], .g3-command-label").forEach((node) => node.remove());
  const q = lower(commandInput?.value || "");
  const allowed = COMMAND_PAGES.filter(allowedPage).filter(([title, subtitle]) => !q || lower(`${title} ${subtitle}`).includes(q));
  if (!allowed.length) return;
  const label = document.createElement("div"); label.className = "g3-command-label"; label.textContent = "Command operations"; commandResults.appendChild(label);
  allowed.slice(0, 10).forEach(([title, subtitle, href, icon]) => { const button = document.createElement("button"); button.type = "button"; button.className = "command-result g3-command-result"; button.dataset.g3Command = href; button.innerHTML = `<span class="avatar">${safe(icon)}</span><span class="command-result-copy"><strong>${safe(title)}</strong><span>${safe(subtitle)}</span></span><span class="command-result-type">G3</span>`; button.addEventListener("click", () => { commandOverlay.hidden = true; location.hash = href; }); commandResults.appendChild(button); });
}

async function dashboardSnapshot() {
  if (!activeStaff() || route() !== "/dashboard" || root.querySelector(".g3-dashboard")) return;
  const counts = await commandCounts();
  if (route() !== "/dashboard" || root.querySelector(".g3-dashboard")) return;
  const anchor = root.querySelector(".stats-grid") || root.firstElementChild;
  const section = document.createElement("section"); section.className = "panel g3-dashboard"; section.style.margin = "18px 0"; section.innerHTML = `<header class="panel-header"><div><p class="eyebrow">Command operations</p><h2>Human-review workload</h2></div><a class="button button-small button-dark" href="#/command">Open Command</a></header><div class="panel-body"><div class="g3-kpi"><article><span>Reports</span><strong>${counts.reports}</strong></article><article><span>Claims</span><strong>${counts.claims}</strong></article><article><span>Appeals</span><strong>${counts.appeals}</strong></article><article><span>Open Cases</span><strong>${counts.cases}</strong></article></div><div class="g3-callout" style="margin-top:12px"><strong>Background checks remain self-service.</strong>Command surfaces only work that genuinely needs Cognitus staff judgment, investigation, support, quality review, or executive action.</div></div>`;
  if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling); else root.appendChild(section);
}

function scheduleRender(delay = 0) {
  window.setTimeout(() => { augmentChrome(); if (G3_ROUTES.has(route())) renderRoute(); else if (route() === "/dashboard") dashboardSnapshot(); }, delay);
}

async function waitForFirebase() {
  const started = Date.now();
  while (!firebaseState().ready && Date.now() - started < 10000) await new Promise((resolve) => window.setTimeout(resolve, 50));
  const services = firebaseState();
  if (!services.ready) throw new Error("Cognitus Firebase did not initialize in time.");
  return services;
}

async function init() {
  injectStyles();
  try {
    const services = await waitForFirebase();
    ({ auth: g3.auth, db: g3.db, Auth: g3.Auth, Fire: g3.Fire } = services);
    g3.Auth.onAuthStateChanged(g3.auth, async (user) => {
      try { await refreshIdentity(user); } catch (error) { console.warn("Generation 3 identity refresh unavailable", error); }
      g3.ready = true;
      scheduleRender(50);
    });
  } catch (error) {
    console.warn("Generation 3 extension did not initialize", error);
  }
  window.addEventListener("hashchange", () => scheduleRender(0));
  commandInput?.addEventListener("input", debounce(() => window.setTimeout(appendCommandPages, 130), 20));
  if (commandOverlay) new MutationObserver(() => window.setTimeout(appendCommandPages, 130)).observe(commandOverlay, { attributes: true, attributeFilter: ["hidden"] });
  if (sidebar) new MutationObserver(() => { if (activeStaff()) window.setTimeout(augmentChrome, 10); }).observe(sidebar, { childList: true });
  if (root) new MutationObserver(() => {
    const current = route();
    if (G3_ROUTES.has(current) && !root.querySelector("[data-g3-page]") && g3.ready) scheduleRender(0);
    if (current === "/dashboard" && !root.querySelector(".g3-dashboard") && g3.ready) window.setTimeout(dashboardSnapshot, 50);
  }).observe(root, { childList: true });
}

init();
