import { firebaseState, readDoc, readCollection, readQuery } from "./firebase.js";
import { DEPARTMENTS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import { safe, clean, lower, route, formatTimestamp, newestFirst, alphabetic, titleCase, debounce, initials } from "./utils.js";

const BUILD = "command-ux-department-overhaul-2026-09-07";
const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const commandOverlay = document.querySelector("#command-overlay");
const commandInput = document.querySelector("#command-input");
const commandResults = document.querySelector("#command-results");

const ux = {
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
  rendering: false,
  dashboardLoading: false
};

const DEPARTMENT_TOOLS = Object.freeze({
  "executive-office": [
    ["Executive Command", "Company-wide operating picture", "#/executive", "EX"],
    ["Accounts & Organizations", "Executive registry and controls", "#/executive/accounts", "AC"],
    ["Approvals", "Cross-company approval queue", "#/executive/approvals", "AP"],
    ["Audit Center", "Recent authenticated activity", "#/executive/audit", "AU"]
  ],
  "public-relations": [
    ["PR Command", "Campaigns, media, partnerships, publications", "#/public-relations", "PR"],
    ["Projects", "Campaign and initiative delivery", "#/projects", "PJ"],
    ["Announcements", "Company and department communications", "#/announcements", "AN"],
    ["Documents", "Brand, policy, and reference resources", "#/documents", "DC"]
  ],
  "customer-service": [
    ["Customer Service Command", "Service analytics and response library", "#/customer-service", "CS"],
    ["Service Desk", "Tickets and customer support work", "#/tickets", "TS"],
    ["Requests", "Internal routing and approvals", "#/requests", "RQ"],
    ["Escalations", "Cross-department escalated work", "#/command/escalations", "ES"]
  ],
  "finance": [
    ["Finance", "Ledger, expenses, reimbursements, approvals", "#/finance", "FN"],
    ["Payroll", "Payroll statements and payroll operations", "#/payroll", "PY"],
    ["Requests", "Purchase and finance requests", "#/requests", "RQ"],
    ["Documents", "Financial procedures and references", "#/documents", "DC"]
  ],
  "human-resources": [
    ["Employee Lifecycle", "Onboarding, transfer, promotion, offboarding", "#/hr/lifecycle", "HR"],
    ["Leave", "Time-away requests and review", "#/leave", "LV"],
    ["Staff Directory", "People and department directory", "#/directory", "SD"],
    ["Staff Administration", "Provisioning and staff authority", "#/admin/staff", "SA"]
  ],
  "quality-assurance": [
    ["Quality Assurance", "Reviews, audits, findings, corrective action", "#/quality", "QA"],
    ["Report Review", "Human review of submitted records", "#/command/reports", "RP"],
    ["Case Files", "Operational investigation casework", "#/command/cases", "CF"],
    ["Documents", "Standards, policy, and review resources", "#/documents", "DC"]
  ]
});

function params() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

function timestampMs(value) {
  try {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  } catch {
    return 0;
  }
}

function nowMs() {
  return Date.now();
}

function owner() {
  return Boolean(
    ux.userRecord?.status === "active" && (
      ux.userRecord?.role === "owner" ||
      (isActiveStaff(ux.staffAccess) && ux.staffAccess?.rank === "co-owner")
    )
  );
}

function executive() {
  return Boolean(
    owner() ||
    (ux.userRecord?.status === "active" && isActiveStaff(ux.staffAccess) && ux.staffAccess?.rank === "chief-officer")
  );
}

function can(permission) {
  return owner() || hasPermission(ux.staffAccess, permission);
}

function activeStaff() {
  return Boolean(ux.authUser && ux.userRecord?.status === "active" && isActiveStaff(ux.staffAccess));
}

function ownDepartmentId() {
  return ux.staffAccess?.departmentId || ux.directorySelf?.departmentId || "";
}

function selectedDepartmentId() {
  const requested = clean(params().get("department"));
  const valid = DEPARTMENTS.some((item) => item.id === requested);
  if (valid && owner()) return requested;
  if (valid && requested === ownDepartmentId()) return requested;
  return ownDepartmentId();
}

function personName(uid) {
  if (!uid) return "Unassigned";
  const person = ux.directory.find((row) => (row.uid || row.id) === uid);
  return person?.displayName || person?.discordUsername || uid.slice(0, 10);
}

function rankLevel(rank) {
  return Number(getRank(rank).level || 0);
}

function departmentRoster(id) {
  return [...ux.directory]
    .filter((row) => row.departmentId === id && ["active", "training", "on_leave"].includes(row.status))
    .sort((a, b) => rankLevel(b.rank) - rankLevel(a.rank) || clean(a.displayName).localeCompare(clean(b.displayName)));
}

function leaderFor(id) {
  const roster = departmentRoster(id);
  if (id === "executive-office") {
    return roster.find((row) => ["owner", "co-owner"].includes(row.rank)) || roster[0] || null;
  }
  return roster.find((row) => row.rank === "chief-officer") || roster[0] || null;
}

function badge(value) {
  const raw = clean(value || "unknown");
  return `<span class="badge ${safe(raw)}">${safe(titleCase(raw))}</span>`;
}

function priority(value) {
  const raw = clean(value || "normal");
  return `<span class="dept-priority ${safe(raw)}">${safe(titleCase(raw))}</span>`;
}

function pageHeader(eyebrow, title, description, actions = "") {
  return `<header class="dept-page-header"><div><p class="eyebrow">${safe(eyebrow)}</p><h1>${safe(title)}</h1><p>${safe(description)}</p></div>${actions ? `<div class="dept-page-actions">${actions}</div>` : ""}</header>`;
}

function emptyState(title, body) {
  return `<div class="dept-empty"><strong>${safe(title)}</strong><p>${safe(body)}</p></div>`;
}

function statusOpen(status, closed = ["done", "completed", "cancelled", "closed", "resolved", "archived", "declined"]) {
  return !closed.includes(lower(status));
}

function dueMs(item) {
  return timestampMs(item.dueAt || item.dueDate || item.dueOn || item.deadline || null);
}

function meetingMs(item) {
  return timestampMs(item.startsAt || item.startAt || item.scheduledFor || item.meetingAt || item.date || item.createdAt);
}

function departmentTools(id) {
  const specialized = DEPARTMENT_TOOLS[id] || [];
  const general = [
    ["Tasks", "Assignments and work queue", "#/tasks", "TK"],
    ["Projects", "Department initiatives", "#/projects", "PJ"],
    ["Meetings", "Schedule and agendas", "#/meetings", "MT"],
    ["Documents", "Policies and resources", "#/documents", "DC"]
  ];
  const seen = new Set();
  return [...specialized, ...general].filter((item) => {
    if (seen.has(item[2])) return false;
    seen.add(item[2]);
    return true;
  }).slice(0, 8);
}

function operationalAccess(id) {
  return owner() || id === ownDepartmentId();
}

async function refreshIdentity(user) {
  ux.authUser = user || null;
  if (!user) {
    ux.userRecord = null;
    ux.staffAccess = null;
    ux.directorySelf = null;
    ux.directory = [];
    return;
  }
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null),
    readDoc("staffDirectory", user.uid).catch(() => null)
  ]);
  ux.userRecord = userRecord;
  ux.staffAccess = staffAccess;
  ux.directorySelf = directorySelf;
  if (userRecord?.status === "active" && isActiveStaff(staffAccess)) {
    ux.directory = alphabetic(await readCollection("staffDirectory").catch(() => directorySelf ? [directorySelf] : []));
  } else {
    ux.directory = directorySelf ? [directorySelf] : [];
  }
}

async function readDepartmentData(id) {
  if (!operationalAccess(id)) {
    return { tasks: [], tickets: [], requests: [], projects: [], meetings: [], announcements: [], documents: [], limited: true };
  }
  const queryDepartment = (collection) => readQuery(collection, [ux.Fire.where("departmentId", "==", id)]).catch(() => []);
  const [tasks, tickets, requests, projects, meetings, announcements, documents] = await Promise.all([
    queryDepartment("commandTasks"),
    queryDepartment("commandTickets"),
    queryDepartment("commandRequests"),
    queryDepartment("commandProjects"),
    queryDepartment("commandMeetings"),
    queryDepartment("commandAnnouncements"),
    queryDepartment("commandDocuments")
  ]);
  return { tasks, tickets, requests, projects, meetings, announcements, documents, limited: false };
}

function healthSignal(roster, data) {
  const openTasks = data.tasks.filter((row) => statusOpen(row.status));
  const overdue = openTasks.filter((row) => dueMs(row) && dueMs(row) < nowMs()).length;
  const blocked = openTasks.filter((row) => lower(row.status) === "blocked").length;
  const criticalTickets = data.tickets.filter((row) => statusOpen(row.status) && lower(row.priority) === "critical").length;
  const chiefMissing = roster.length && !roster.some((row) => row.rank === "chief-officer") ? 1 : 0;
  let score = 100 - overdue * 9 - blocked * 7 - criticalTickets * 12 - chiefMissing * 10;
  if (!roster.length) score -= 25;
  score = Math.max(0, Math.min(100, score));
  const label = score >= 85 ? "Stable" : score >= 65 ? "Watch" : score >= 45 ? "Strained" : "Critical";
  return { score, label, overdue, blocked, criticalTickets };
}

function renderDepartmentDirectory() {
  document.title = "Departments · Cognitus Staff / Command";
  const activePeople = ux.directory.filter((row) => ["active", "training", "on_leave"].includes(row.status));
  const chiefs = DEPARTMENTS.filter((dept) => Boolean(leaderFor(dept.id))).length;
  const own = getDepartment(ownDepartmentId());

  root.innerHTML = `<div class="page-inner dept-overhaul" data-overhaul-page="departments">
    ${pageHeader("Cognitus Company", "Departments.", "Every Cognitus department has one clear home for its people, priorities, work queues, meetings, resources, and specialized operating tools.", `<a class="button button-dark" href="#/department-command">Open ${safe(own.shortName)}</a>`)}
    <section class="dept-kpis"><article><span>Departments</span><strong>${DEPARTMENTS.length}</strong><small>Company operating units</small></article><article><span>Active staff</span><strong>${activePeople.length}</strong><small>Active, training, or on leave</small></article><article><span>Leadership assigned</span><strong>${chiefs}/${DEPARTMENTS.length}</strong><small>Department leadership coverage</small></article><article><span>Your department</span><strong>${safe(own.code)}</strong><small>${safe(own.name)}</small></article></section>
    ${executive() ? `<div class="dept-executive-note"><strong>Leadership view</strong><span>${owner() ? "Owner / Co-Owner can open every department's operational workspace." : "Chief Officers can browse every department and operate their assigned department."}</span></div>` : ""}
    <section class="dept-directory-grid">${DEPARTMENTS.map((dept) => {
      const roster = departmentRoster(dept.id);
      const leader = leaderFor(dept.id);
      const isOwn = dept.id === ownDepartmentId();
      const canOperate = operationalAccess(dept.id);
      return `<article class="dept-directory-card ${isOwn ? "current" : ""}">
        <div class="dept-card-top"><span class="dept-code">${safe(dept.code)}</span>${isOwn ? `<span class="dept-current">Your department</span>` : ""}</div>
        <h2>${safe(dept.name)}</h2><p>${safe(dept.description)}</p>
        <div class="dept-focus">${dept.focus.map((item) => `<span>${safe(item)}</span>`).join("")}</div>
        <div class="dept-leader"><span class="avatar">${safe(initials(leader?.displayName || dept.code))}</span><div><strong>${safe(leader?.displayName || "Leadership unassigned")}</strong><span>${safe(dept.chiefTitle)}</span></div></div>
        <div class="dept-card-meta"><span><strong>${roster.length}</strong> staff</span><span><strong>${roster.filter((row) => row.status === "active").length}</strong> active</span></div>
        <a class="button ${canOperate ? "button-dark" : ""}" href="#/department-command?department=${encodeURIComponent(dept.id)}">${canOperate ? "Open workspace" : "View department"}</a>
      </article>`;
    }).join("")}</section>
  </div>`;
}

function workItem(row, kind, href) {
  const title = row.title || row.subject || row.summary || row.cognitusId || row.id;
  const detail = row.description || row.body || row.reason || row.objective || "";
  return `<a class="dept-work-row" href="${safe(href)}"><div><strong>${safe(title)}</strong><p>${safe(clean(detail).slice(0, 180))}</p><small>${safe(kind)} · ${safe(formatTimestamp(row.updatedAt || row.createdAt))}</small></div><div>${row.priority ? priority(row.priority) : ""}${badge(row.status || "open")}</div></a>`;
}

async function renderDepartmentWorkspace() {
  const id = selectedDepartmentId();
  const dept = getDepartment(id);
  const roster = departmentRoster(id);
  const leader = leaderFor(id);
  const data = await readDepartmentData(id);
  const canOperate = !data.limited;
  const health = healthSignal(roster, data);

  const openTasks = data.tasks.filter((row) => statusOpen(row.status));
  const openTickets = data.tickets.filter((row) => statusOpen(row.status, ["closed", "resolved"]));
  const pendingRequests = data.requests.filter((row) => ["pending", "submitted", "open", "awaiting_review"].includes(lower(row.status)));
  const activeProjects = data.projects.filter((row) => statusOpen(row.status, ["completed", "closed", "cancelled", "archived"]));
  const upcomingMeetings = data.meetings.filter((row) => {
    const ms = meetingMs(row);
    return lower(row.status) !== "cancelled" && (!ms || ms >= nowMs() - 3600000);
  }).sort((a, b) => meetingMs(a) - meetingMs(b)).slice(0, 5);
  const currentAnnouncements = newestFirst(data.announcements).filter((row) => lower(row.status || "published") !== "archived").slice(0, 4);
  const recentDocs = newestFirst(data.documents).slice(0, 5);

  const priorityFeed = [
    ...openTickets.filter((row) => ["critical", "high"].includes(lower(row.priority))).map((row) => ({ row, kind: "Ticket", href: "#/tickets", weight: lower(row.priority) === "critical" ? 10 : 8 })),
    ...openTasks.filter((row) => lower(row.status) === "blocked" || ["critical", "high"].includes(lower(row.priority))).map((row) => ({ row, kind: "Task", href: "#/tasks", weight: lower(row.status) === "blocked" ? 9 : 7 })),
    ...pendingRequests.map((row) => ({ row, kind: "Request", href: "#/requests", weight: 5 }))
  ].sort((a, b) => b.weight - a.weight || timestampMs(b.row.createdAt) - timestampMs(a.row.createdAt)).slice(0, 7);

  const switcher = owner() ? `<select id="dept-workspace-switch" aria-label="Switch department">${DEPARTMENTS.map((item) => `<option value="${safe(item.id)}" ${item.id === id ? "selected" : ""}>${safe(item.name)}</option>`).join("")}</select>` : "";

  document.title = `${dept.name} · Cognitus Staff / Command`;
  root.innerHTML = `<div class="page-inner dept-overhaul" data-overhaul-page="department-command" data-g3-page="department-command">
    <section class="dept-hero">
      <div class="dept-hero-copy"><div class="dept-hero-top"><span class="dept-code dark">${safe(dept.code)}</span><span>${safe(dept.chiefTitle)}</span></div><h1>${safe(dept.name)}</h1><p>${safe(dept.description)}</p><div class="dept-focus dark">${dept.focus.map((item) => `<span>${safe(item)}</span>`).join("")}</div><div class="dept-hero-actions"><a class="button" href="#/departments">All Departments</a>${canOperate ? `<a class="button button-dark inverse" href="#/tasks">Open Work Queue</a>` : ""}${switcher}</div></div>
      <aside class="dept-leadership-card"><span>Department leadership</span><div class="dept-leadership-person"><span class="avatar">${safe(initials(leader?.displayName || dept.code))}</span><div><strong>${safe(leader?.displayName || "Unassigned")}</strong><small>${safe(leader?.title || dept.chiefTitle)}</small></div></div><div class="dept-leadership-meta"><span>${roster.length} people</span><span>${roster.filter((row) => row.status === "active").length} active</span></div></aside>
    </section>

    ${!canOperate ? `<div class="dept-readonly"><strong>Directory view</strong><span>You can see this department's purpose, leadership, and staff. Operational queues remain restricted to that department and Owner / Co-Owner leadership.</span></div>` : `
    <section class="dept-kpis workspace"><article><span>Open tasks</span><strong>${openTasks.length}</strong><small>${health.overdue} overdue · ${health.blocked} blocked</small></article><article><span>Open tickets</span><strong>${openTickets.length}</strong><small>${health.criticalTickets} critical</small></article><article><span>Pending requests</span><strong>${pendingRequests.length}</strong><small>Awaiting action</small></article><article><span>Active projects</span><strong>${activeProjects.length}</strong><small>Department initiatives</small></article><article class="health"><span>Workload signal</span><strong>${health.score}</strong><small>${safe(health.label)} · operational indicator</small><div class="dept-meter"><span style="width:${health.score}%"></span></div></article></section>`}

    <section class="dept-tools"><div class="dept-section-heading"><div><p class="eyebrow">Department tools</p><h2>Everything ${safe(dept.shortName)} needs.</h2></div><span>Role-aware shortcuts</span></div><div class="dept-tools-grid">${departmentTools(id).map(([title, description, href, icon]) => `<a class="dept-tool-card" href="${safe(href)}"><span>${safe(icon)}</span><div><strong>${safe(title)}</strong><p>${safe(description)}</p></div><b>→</b></a>`).join("")}</div></section>

    <section class="dept-main-grid">
      <div class="dept-main-column">
        ${canOperate ? `<section class="panel dept-panel"><header><div><p class="eyebrow">Priority queue</p><h2>Needs attention</h2></div><a href="#/tasks">All work →</a></header>${priorityFeed.length ? `<div class="dept-work-list">${priorityFeed.map((item) => workItem(item.row, item.kind, item.href)).join("")}</div>` : emptyState("Queue clear", "No high-priority tickets, blocked work, or pending requests are visible right now.")}</section>` : ""}
        <section class="panel dept-panel"><header><div><p class="eyebrow">People</p><h2>${safe(dept.shortName)} team</h2></div><a href="#/directory">Staff Directory →</a></header>${roster.length ? `<div class="dept-roster">${roster.map((person) => `<a href="#/staff/${safe(person.uid || person.id)}" class="dept-person"><span class="avatar">${safe(initials(person.displayName || person.discordUsername || "CS"))}</span><div><strong>${safe(person.displayName || person.discordUsername || "Cognitus Staff")}</strong><small>${safe(person.title || getRank(person.rank).label)} · ${safe(person.employeeId || "")}</small></div>${badge(person.status)}</a>`).join("")}</div>` : emptyState("No staff assigned", "This department does not currently have active staff in the directory.")}</section>
      </div>
      <aside class="dept-side-column">
        ${canOperate ? `<section class="panel dept-panel compact"><header><div><p class="eyebrow">Schedule</p><h2>Upcoming meetings</h2></div><a href="#/meetings">Open →</a></header>${upcomingMeetings.length ? `<div class="dept-mini-list">${upcomingMeetings.map((item) => `<a href="#/meetings"><strong>${safe(item.title || "Department meeting")}</strong><span>${safe(formatTimestamp(item.startsAt || item.startAt || item.scheduledFor || item.meetingAt || item.date || item.createdAt))}</span></a>`).join("")}</div>` : emptyState("Nothing scheduled", "No upcoming department meetings are visible.")}</section>
        <section class="panel dept-panel compact"><header><div><p class="eyebrow">Communications</p><h2>Latest announcements</h2></div><a href="#/announcements">Open →</a></header>${currentAnnouncements.length ? `<div class="dept-mini-list">${currentAnnouncements.map((item) => `<a href="#/announcements"><strong>${safe(item.title || "Announcement")}</strong><span>${safe(clean(item.body || item.message || "").slice(0, 100))}</span></a>`).join("")}</div>` : emptyState("No announcements", "No department announcements are visible.")}</section>
        <section class="panel dept-panel compact"><header><div><p class="eyebrow">Resources</p><h2>Recent documents</h2></div><a href="#/documents">Library →</a></header>${recentDocs.length ? `<div class="dept-mini-list">${recentDocs.map((item) => `<a href="${safe(item.url || "#/documents")}" ${item.url ? 'target="_blank" rel="noopener"' : ""}><strong>${safe(item.title || "Document")}</strong><span>${safe(item.category || item.type || "Department resource")}</span></a>`).join("")}</div>` : emptyState("No documents", "No department resources are visible.")}</section>` : ""}
      </aside>
    </section>
  </div>`;

  root.querySelector("#dept-workspace-switch")?.addEventListener("change", (event) => {
    location.hash = `#/department-command?department=${encodeURIComponent(event.currentTarget.value)}`;
  });
}

async function injectDashboardDepartment() {
  if (!ux.ready || !activeStaff() || route() !== "/dashboard" || ux.dashboardLoading) return;
  if (root.querySelector("[data-department-dashboard-card]")) return;
  ux.dashboardLoading = true;
  try {
    const id = ownDepartmentId();
    const dept = getDepartment(id);
    const roster = departmentRoster(id);
    const [tasks, tickets, projects] = await Promise.all([
      readQuery("commandTasks", [ux.Fire.where("departmentId", "==", id)]).catch(() => []),
      readQuery("commandTickets", [ux.Fire.where("departmentId", "==", id)]).catch(() => []),
      readQuery("commandProjects", [ux.Fire.where("departmentId", "==", id)]).catch(() => [])
    ]);
    if (route() !== "/dashboard" || root.querySelector("[data-department-dashboard-card]")) return;
    const openTasks = tasks.filter((row) => statusOpen(row.status)).length;
    const openTickets = tickets.filter((row) => statusOpen(row.status, ["closed", "resolved"])).length;
    const activeProjects = projects.filter((row) => statusOpen(row.status, ["completed", "closed", "cancelled", "archived"])).length;
    const section = document.createElement("section");
    section.className = "dept-dashboard-card";
    section.setAttribute("data-department-dashboard-card", "");
    section.innerHTML = `<div><p class="eyebrow">Your department</p><h2>${safe(dept.name)}</h2><p>${safe(dept.description)}</p><div class="dept-dashboard-focus">${dept.focus.map((item) => `<span>${safe(item)}</span>`).join("")}</div></div><div class="dept-dashboard-stats"><span><strong>${roster.length}</strong> people</span><span><strong>${openTasks}</strong> tasks</span><span><strong>${openTickets}</strong> tickets</span><span><strong>${activeProjects}</strong> projects</span></div><a class="button button-dark" href="#/department-command">Open Department</a>`;
    const anchor = root.querySelector(".g3-dashboard") || root.querySelector(".g2-dashboard") || root.querySelector(".stats-grid") || root.firstElementChild;
    if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor.nextSibling);
    else root.appendChild(section);
  } finally {
    ux.dashboardLoading = false;
  }
}

function ensureSidebarDepartmentNav() {
  if (!activeStaff() || !sidebar?.children.length) return;
  sidebar.querySelectorAll('a.sidebar-link[href="#/departments"], a.sidebar-link[href="#/department-command"]').forEach((link) => {
    if (!link.closest("[data-overhaul-nav-holder]")) link.hidden = true;
  });
  if (sidebar.querySelector("[data-overhaul-nav-holder]")) return;
  const dept = getDepartment(ownDepartmentId());
  const holder = document.createElement("section");
  holder.className = "sidebar-group dept-nav-group";
  holder.setAttribute("data-overhaul-nav-holder", "");
  holder.innerHTML = `<span class="sidebar-label">Department</span><a class="sidebar-link ${route() === "/department-command" ? "active" : ""}" href="#/department-command"><span class="sidebar-link-icon">${safe(dept.code.slice(0, 2))}</span><span>${safe(dept.shortName)} Home</span></a><a class="sidebar-link ${route() === "/departments" ? "active" : ""}" href="#/departments"><span class="sidebar-link-icon">DP</span><span>All Departments</span></a>`;
  const groups = sidebar.querySelectorAll(":scope > .sidebar-group");
  if (groups.length) groups[0].insertAdjacentElement("afterend", holder);
  else sidebar.prepend(holder);
}

function ensureMobileDock() {
  let dock = document.querySelector("#portal-mobile-dock");
  if (!activeStaff()) {
    dock?.remove();
    return;
  }
  if (!dock) {
    dock = document.createElement("nav");
    dock.id = "portal-mobile-dock";
    dock.className = "portal-mobile-dock";
    dock.setAttribute("aria-label", "Quick navigation");
    document.body.appendChild(dock);
  }
  const items = [
    ["#/dashboard", "Home", "⌂"],
    ["#/department-command", "Department", "DP"],
    ["#/tasks", "Tasks", "TK"],
    ["#/inbox", "Inbox", "IN"]
  ];
  dock.innerHTML = items.map(([href, label, icon]) => `<a href="${href}" class="${route() === href.replace(/^#/, "") ? "active" : ""}"><span>${safe(icon)}</span><small>${safe(label)}</small></a>`).join("");
}

function appendCommandItems() {
  if (!activeStaff() || commandOverlay?.hidden || !commandResults) return;
  commandResults.querySelectorAll("[data-overhaul-command], .dept-command-label").forEach((node) => node.remove());
  const q = lower(commandInput?.value || "");
  const dept = getDepartment(ownDepartmentId());
  const items = [
    [`${dept.shortName} Home`, "Your department workspace", "#/department-command", dept.code.slice(0, 2)],
    ["Department Directory", "Browse Cognitus departments and leadership", "#/departments", "DP"]
  ].filter(([title, description]) => !q || lower(`${title} ${description}`).includes(q));
  if (!items.length) return;
  const label = document.createElement("div");
  label.className = "dept-command-label";
  label.textContent = "Department";
  commandResults.appendChild(label);
  items.forEach(([title, description, href, icon]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "command-result";
    button.setAttribute("data-overhaul-command", href);
    button.innerHTML = `<span class="avatar">${safe(icon)}</span><span class="command-result-copy"><strong>${safe(title)}</strong><span>${safe(description)}</span></span><span class="command-result-type">Dept</span>`;
    button.addEventListener("click", () => {
      commandOverlay.hidden = true;
      location.hash = href;
    });
    commandResults.appendChild(button);
  });
}

async function renderCurrent() {
  if (!ux.ready || ux.rendering || !activeStaff()) return;
  ux.rendering = true;
  try {
    ensureSidebarDepartmentNav();
    ensureMobileDock();
    if (route() === "/departments") renderDepartmentDirectory();
    else if (route() === "/department-command") await renderDepartmentWorkspace();
    else if (route() === "/dashboard") await injectDashboardDepartment();
  } catch (error) {
    console.error("Portal department overhaul failed", error);
    if (["/departments", "/department-command"].includes(route())) {
      root.innerHTML = `<div class="page-inner dept-overhaul" data-overhaul-page="error" ${route() === "/department-command" ? 'data-g3-page="department-command"' : ""}>${pageHeader("Department", "Department workspace unavailable.", error?.message || "Cognitus could not load this department workspace.", `<a class="button" href="#/dashboard">Dashboard</a>`)}</div>`;
    }
  } finally {
    ux.rendering = false;
  }
}

function scheduleRender(delay = 30) {
  window.setTimeout(() => renderCurrent(), delay);
}

async function waitForFirebase() {
  const started = Date.now();
  while (!firebaseState().ready && Date.now() - started < 10000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  const services = firebaseState();
  if (!services.ready) throw new Error("Cognitus Firebase did not initialize in time.");
  return services;
}

async function init() {
  document.body.classList.add("portal-overhaul-active");
  try {
    const services = await waitForFirebase();
    ({ auth: ux.auth, db: ux.db, Auth: ux.Auth, Fire: ux.Fire } = services);
    ux.Auth.onAuthStateChanged(ux.auth, async (user) => {
      try {
        await refreshIdentity(user);
      } catch (error) {
        console.warn("Department overhaul identity refresh unavailable", error);
      }
      ux.ready = true;
      scheduleRender(120);
    });
  } catch (error) {
    console.warn("Portal overhaul did not initialize", error);
  }

  window.addEventListener("hashchange", () => scheduleRender(80));
  commandInput?.addEventListener("input", debounce(() => window.setTimeout(appendCommandItems, 160), 40));
  if (commandOverlay) new MutationObserver(() => window.setTimeout(appendCommandItems, 160)).observe(commandOverlay, { attributes: true, attributeFilter: ["hidden"] });
  if (sidebar) new MutationObserver(() => {
    if (ux.ready && activeStaff()) window.setTimeout(ensureSidebarDepartmentNav, 30);
  }).observe(sidebar, { childList: true, subtree: false });
  if (root) new MutationObserver(() => {
    if (!ux.ready || ux.rendering || !activeStaff()) return;
    const current = route();
    if (current === "/departments" && !root.querySelector('[data-overhaul-page="departments"]')) scheduleRender(20);
    if (current === "/department-command" && !root.querySelector('[data-overhaul-page="department-command"]')) scheduleRender(20);
    if (current === "/dashboard" && !root.querySelector("[data-department-dashboard-card]")) scheduleRender(80);
  }).observe(root, { childList: true });
}

init();
