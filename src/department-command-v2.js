import { firebaseState, readDoc, readCollection, readQuery } from "./firebase.js";
import { DEPARTMENTS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import { safe, clean, lower, route, params, formatTimestamp, newestFirst, alphabetic, titleCase, initials } from "./utils.js";

const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");

const state = {
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

function owner() {
  return Boolean(
    state.userRecord?.status === "active" && (
      state.userRecord?.role === "owner" ||
      (isActiveStaff(state.staffAccess) && state.staffAccess?.rank === "co-owner")
    )
  );
}

function can(permission) {
  return owner() || hasPermission(state.staffAccess, permission);
}

function activeStaff() {
  return Boolean(state.authUser && state.userRecord?.status === "active" && isActiveStaff(state.staffAccess));
}

function ownDepartmentId() {
  return state.staffAccess?.departmentId || state.directorySelf?.departmentId || "";
}

function selectedDepartmentId() {
  const requested = clean(params().get("department"));
  if (requested && DEPARTMENTS.some((d) => d.id === requested) && owner()) return requested;
  return ownDepartmentId();
}

function timestampMs(value) {
  try {
    const d = value?.toDate?.() || (value ? new Date(value) : null);
    return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
  } catch {
    return 0;
  }
}

function openStatus(value, closed = ["done", "completed", "complete", "closed", "resolved", "cancelled", "declined", "archived"]) {
  return !closed.includes(lower(value));
}

function badge(value) {
  const raw = clean(value || "open");
  return `<span class="badge ${safe(raw)}">${safe(titleCase(raw))}</span>`;
}

function priority(value) {
  const raw = clean(value || "normal");
  return `<span class="g3-priority ${safe(raw)}">${safe(titleCase(raw))}</span>`;
}

function mergeUnique(...groups) {
  const seen = new Set();
  return groups.flat().filter((item) => {
    const id = item?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function personName(uid) {
  if (!uid) return "Unassigned";
  const person = state.directory.find((row) => (row.uid || row.id) === uid);
  return person?.displayName || person?.discordUsername || uid.slice(0, 10);
}

function departmentRoster(id) {
  return [...state.directory]
    .filter((row) => row.departmentId === id && ["active", "training", "on_leave"].includes(row.status))
    .sort((a, b) => Number(getRank(b.rank).level || 0) - Number(getRank(a.rank).level || 0) || clean(a.displayName).localeCompare(clean(b.displayName)));
}

function leaderFor(id) {
  const roster = departmentRoster(id);
  if (id === "executive-office") return roster.find((row) => ["owner", "co-owner"].includes(row.rank)) || roster[0] || null;
  return roster.find((row) => row.rank === "chief-officer") || roster[0] || null;
}

async function safeQuery(collectionName, constraints = []) {
  try {
    return await readQuery(collectionName, constraints);
  } catch {
    return [];
  }
}

async function safeCollection(collectionName) {
  try {
    return await readCollection(collectionName);
  } catch {
    return [];
  }
}

async function refreshIdentity(user) {
  state.authUser = user || null;
  if (!user) {
    state.userRecord = null;
    state.staffAccess = null;
    state.directorySelf = null;
    state.directory = [];
    return;
  }
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null),
    readDoc("staffDirectory", user.uid).catch(() => null)
  ]);
  state.userRecord = userRecord;
  state.staffAccess = staffAccess;
  state.directorySelf = directorySelf;
  if (userRecord?.status === "active" && isActiveStaff(staffAccess)) {
    state.directory = alphabetic(await safeCollection("staffDirectory"));
    if (!state.directory.length && directorySelf) state.directory = [directorySelf];
  }
}

function teamReadAllowed() {
  return owner() || can(PERMISSIONS.DEPARTMENT_MANAGE) || can(PERMISSIONS.TICKETS_ALL_READ) || can(PERMISSIONS.TICKETS_MANAGE);
}

async function loadWorkspace(id) {
  const uid = state.authUser.uid;
  const F = state.Fire;

  const personalTasks = mergeUnique(
    await safeQuery("commandTasks", [F.where("assignedToUid", "==", uid)]),
    await safeQuery("commandTasks", [F.where("createdByUid", "==", uid)])
  );
  const personalTickets = mergeUnique(
    await safeQuery("commandTickets", [F.where("requesterUid", "==", uid)]),
    await safeQuery("commandTickets", [F.where("assignedToUid", "==", uid)])
  );
  const personalRequests = await safeQuery("commandRequests", [F.where("requestorUid", "==", uid)]);
  const personalLeave = await safeQuery("commandLeave", [F.where("requestorUid", "==", uid)]);
  const payroll = await safeQuery("commandPayroll", [F.where("employeeUid", "==", uid)]);
  const inbox = await safeQuery("staffInbox", [F.where("recipientUid", "==", uid)]);

  const canReadDept = owner() || id === ownDepartmentId();
  const deptTasks = canReadDept && teamReadAllowed() ? await safeQuery("commandTasks", [F.where("departmentId", "==", id)]) : [];
  const deptTickets = canReadDept && teamReadAllowed() ? await safeQuery("commandTickets", [F.where("departmentId", "==", id)]) : [];
  const deptRequests = canReadDept && (owner() || can(PERMISSIONS.DEPARTMENT_MANAGE) || can(PERMISSIONS.HR_RECORDS_MANAGE) || can(PERMISSIONS.FINANCE_MANAGE) || can(PERMISSIONS.TICKETS_MANAGE))
    ? await safeQuery("commandRequests", [F.where("departmentId", "==", id)]) : [];

  const [projects, meetings, announcements, documents] = canReadDept ? await Promise.all([
    safeQuery("commandProjects", [F.where("departmentId", "==", id)]),
    safeQuery("commandMeetings", [F.where("departmentId", "==", id)]),
    safeQuery("commandAnnouncements", [F.where("departmentId", "==", id)]),
    safeQuery("commandDocuments", [F.where("departmentId", "==", id)])
  ]) : [[], [], [], []];

  return {
    personalTasks: newestFirst(personalTasks, "updatedAt"),
    personalTickets: newestFirst(personalTickets, "updatedAt"),
    personalRequests: newestFirst(personalRequests, "updatedAt"),
    personalLeave: newestFirst(personalLeave, "updatedAt"),
    payroll: newestFirst(payroll, "periodEnd"),
    inbox: newestFirst(inbox),
    deptTasks: newestFirst(deptTasks, "updatedAt"),
    deptTickets: newestFirst(deptTickets, "updatedAt"),
    deptRequests: newestFirst(deptRequests, "updatedAt"),
    projects: newestFirst(projects, "updatedAt"),
    meetings: [...meetings].sort((a, b) => timestampMs(a.startsAt || a.createdAt) - timestampMs(b.startsAt || b.createdAt)),
    announcements: newestFirst(announcements, "publishedAt"),
    documents: newestFirst(documents, "updatedAt")
  };
}

function row(item, type, href) {
  const title = item.title || item.subject || item.summary || item.periodLabel || item.cognitusId || item.id;
  const body = item.description || item.details || item.reason || item.body || item.notes || "";
  return `<a class="dcv2-row" href="${safe(href)}"><div><strong>${safe(title)}</strong><p>${safe(clean(body).slice(0, 160))}</p><small>${safe(type)} · ${safe(formatTimestamp(item.updatedAt || item.createdAt || item.periodEnd))}</small></div><div class="dcv2-row-meta">${item.priority ? priority(item.priority) : ""}${item.status ? badge(item.status) : ""}</div></a>`;
}

function empty(title, body) {
  return `<div class="dcv2-empty"><strong>${safe(title)}</strong><p>${safe(body)}</p></div>`;
}

function tile(title, description, href, icon, primary = false) {
  return `<a class="dcv2-tile ${primary ? "primary" : ""}" href="${safe(href)}"><span>${safe(icon)}</span><div><strong>${safe(title)}</strong><small>${safe(description)}</small></div><b>→</b></a>`;
}

function action(title, description, href, icon) {
  return `<a class="dcv2-command" href="${safe(href)}"><span>${safe(icon)}</span><div><strong>${safe(title)}</strong><small>${safe(description)}</small></div></a>`;
}

function staffServices() {
  return [
    ["My Profile", "Employee identity and employment profile", "#/profile", "ME"],
    ["Inbox", "Assignments, notices, and staff notifications", "#/inbox", "IN"],
    ["My Tasks", "Assignments and personal work queue", "#/tasks", "TK"],
    ["Requests", "Submit and track internal requests", "#/requests", "RQ"],
    ["Service Desk", "Open and track support tickets", "#/tickets", "TS"],
    ["Leave", "Request time away and track decisions", "#/leave", "LV"],
    ["Payroll", "View your payroll statements", "#/payroll", "PY"],
    ["Meetings", "Department and company schedule", "#/meetings", "MT"],
    ["Announcements", "Official company and department notices", "#/announcements", "AN"],
    ["Documents", "Policies, forms, guides, and resources", "#/documents", "DC"],
    ["Staff Directory", "Find Cognitus employees", "#/directory", "SD"],
    ["All Departments", "Browse company operating units", "#/departments", "DP"]
  ];
}

function departmentSystems(id) {
  const items = [];
  const add = (title, desc, href, icon, allowed = true) => { if (allowed) items.push([title, desc, href, icon]); };

  add("Projects", "Department initiatives and delivery", "#/projects", "PJ");
  add("Department Meetings", "Schedules, agendas, and meeting links", "#/meetings", "MT");
  add("Department Documents", "Policies and working resources", "#/documents", "DC");
  add("Department Announcements", "Internal department communication", "#/announcements", "AN");

  if (id === "public-relations") add("PR Command", "Campaigns, publications, media, and partnerships", "#/public-relations", "PR", can(PERMISSIONS.PR_MANAGE) || can(PERMISSIONS.PR_APPROVE));
  if (id === "customer-service") add("Customer Service Command", "Support health and response operations", "#/customer-service", "CS", can(PERMISSIONS.CS_MANAGE) || can(PERMISSIONS.TICKETS_MANAGE));
  if (id === "finance") {
    add("Finance", "Ledger, expenses, reimbursements, and approvals", "#/finance", "FN", can(PERMISSIONS.FINANCE_READ) || can(PERMISSIONS.FINANCE_MANAGE));
    add("Payroll Management", "Prepare and approve payroll statements", "#/payroll", "PY", can(PERMISSIONS.PAYROLL_READ) || can(PERMISSIONS.PAYROLL_MANAGE));
  }
  if (id === "human-resources") {
    add("Employee Lifecycle", "Onboarding, transfers, promotions, and offboarding", "#/hr/lifecycle", "HR", can(PERMISSIONS.HR_RECORDS_READ) || can(PERMISSIONS.HR_RECORDS_MANAGE));
    add("Staff Administration", "Provision staff and manage authority", "#/admin/staff", "SA", can(PERMISSIONS.STAFF_PROVISION) || can(PERMISSIONS.STAFF_MANAGE) || can(PERMISSIONS.PERMISSIONS_MANAGE));
  }
  if (id === "quality-assurance") {
    add("Quality Assurance", "Reviews, audits, findings, corrective action", "#/quality", "QA", can(PERMISSIONS.QA_READ) || can(PERMISSIONS.QA_MANAGE) || can(PERMISSIONS.QA_AUDIT));
    add("Report Review", "Human review of submitted reports", "#/command/reports", "RP", can(PERMISSIONS.REPORTS_REVIEW));
    add("Case Files", "Investigation and operational casework", "#/command/cases", "CF", can(PERMISSIONS.CASES_READ) || can(PERMISSIONS.CASES_MANAGE));
  }
  if (id === "executive-office" || owner()) {
    add("Executive Command", "Company-wide operating picture", "#/executive", "EX", can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.AUDIT_READ));
    add("Accounts & Organizations", "Executive registry and controls", "#/executive/accounts", "UA", owner() || can(PERMISSIONS.ACCOUNTS_READ_ALL));
    add("Approvals", "Cross-company executive approvals", "#/executive/approvals", "EA", can(PERMISSIONS.SYSTEM_MANAGE));
    add("Audit Center", "Authenticated activity and audit trail", "#/executive/audit", "AU", can(PERMISSIONS.AUDIT_READ));
  }
  return items;
}

function managementActions() {
  const actions = [];
  const add = (title, description, href, icon, allowed = true) => { if (allowed) actions.push([title, description, href, icon]); };
  add("Schedule Meeting", "Open the meeting scheduler", "#/meetings?action=new", "MT", owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE));
  add("New Project", "Start a department initiative", "#/projects?action=new", "PJ", owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE));
  add("Publish Announcement", "Post a department notice", "#/announcements?action=new", "AN", owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE));
  add("Add Document", "Add a resource to the library", "#/documents?action=new", "DC", owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE));
  return actions;
}

async function renderDepartmentCommand() {
  if (!state.ready || state.rendering || !activeStaff() || route() !== "/department-command") return;
  state.rendering = true;
  try {
    const id = selectedDepartmentId();
    const dept = getDepartment(id);
    const roster = departmentRoster(id);
    const leader = leaderFor(id);
    const data = await loadWorkspace(id);
    const uid = state.authUser.uid;

    const myOpenTasks = data.personalTasks.filter((x) => openStatus(x.status));
    const myOpenTickets = data.personalTickets.filter((x) => openStatus(x.status, ["closed", "resolved"]));
    const myOpenRequests = data.personalRequests.filter((x) => openStatus(x.status, ["approved", "declined", "closed", "cancelled"]));
    const unreadInbox = data.inbox.filter((x) => !x.readAt);
    const leavePending = data.personalLeave.filter((x) => lower(x.status) === "pending");
    const latestPayroll = data.payroll[0] || null;

    const teamTasks = mergeUnique(data.deptTasks, data.personalTasks).filter((x) => openStatus(x.status));
    const teamTickets = mergeUnique(data.deptTickets, data.personalTickets).filter((x) => openStatus(x.status, ["closed", "resolved"]));
    const teamRequests = mergeUnique(data.deptRequests, data.personalRequests).filter((x) => openStatus(x.status, ["approved", "declined", "closed", "cancelled"]));
    const activeProjects = data.projects.filter((x) => openStatus(x.status, ["completed", "complete", "closed", "cancelled", "archived"]));
    const upcomingMeetings = data.meetings.filter((x) => {
      const time = timestampMs(x.startsAt || x.startAt || x.createdAt);
      return lower(x.status) !== "cancelled" && (!time || time > Date.now() - 3600000);
    }).slice(0, 5);

    const attention = newestFirst([
      ...myOpenTasks.map((x) => ({ ...x, _kind: "Task", _href: "#/tasks", _weight: lower(x.status) === "blocked" ? 10 : ["critical", "high"].includes(lower(x.priority)) ? 8 : 5 })),
      ...myOpenTickets.map((x) => ({ ...x, _kind: "Ticket", _href: "#/tickets", _weight: ["critical", "high"].includes(lower(x.priority)) ? 9 : 5 })),
      ...myOpenRequests.map((x) => ({ ...x, _kind: "Request", _href: "#/requests", _weight: 4 }))
    ].sort((a, b) => b._weight - a._weight), "updatedAt").slice(0, 7);

    const teamAttention = [
      ...teamTickets.filter((x) => ["critical", "high"].includes(lower(x.priority))).map((x) => ({ ...x, _kind: "Ticket", _href: "#/tickets" })),
      ...teamTasks.filter((x) => lower(x.status) === "blocked" || ["critical", "high"].includes(lower(x.priority))).map((x) => ({ ...x, _kind: "Task", _href: "#/tasks" })),
      ...teamRequests.map((x) => ({ ...x, _kind: "Request", _href: "#/requests" }))
    ].slice(0, 7);

    const switcher = owner() ? `<select id="dcv2-department-switch" aria-label="Switch department">${DEPARTMENTS.map((d) => `<option value="${safe(d.id)}" ${d.id === id ? "selected" : ""}>${safe(d.name)}</option>`).join("")}</select>` : "";
    const quickActions = [
      ["New Task", "Create or delegate work", "#/tasks?action=new", "TK"],
      ["New Request", "Ask another team for help", "#/requests?action=new", "RQ"],
      ["Open Ticket", "Get operational support", "#/tickets?action=new", "TS"],
      ["Request Leave", "Submit a time-away request", "#/leave?action=new", "LV"],
      ...managementActions()
    ];

    const userRank = getRank(state.staffAccess?.rank).label;
    document.title = `${dept.name} Command · Cognitus Staff / Command`;
    root.innerHTML = `<div class="page-inner department-command-v2 dept-overhaul" data-overhaul-page="department-command" data-g3-page="department-command" data-department-command-v2>
      <section class="dcv2-hero"><div class="dcv2-hero-main"><div class="dcv2-hero-top"><span class="dcv2-code">${safe(dept.code)}</span><span>Department Command</span><span>•</span><span>${safe(userRank)}</span></div><h1>${safe(dept.name)} Command</h1><p>This is the working center for ${safe(dept.shortName)}. Staff can manage their day, submit requests, open tickets, access resources, view payroll and leave, follow department work, and launch every authorized department system from one place.</p><div class="dcv2-hero-actions"><a class="button" href="#/dashboard">Company Home</a><a class="button secondary" href="#/departments">All Departments</a>${switcher}</div></div><aside class="dcv2-hero-side"><span>Department leadership</span><div class="dcv2-leader"><span class="avatar">${safe(initials(leader?.displayName || dept.code))}</span><div><strong>${safe(leader?.displayName || "Leadership unassigned")}</strong><small>${safe(leader?.title || dept.chiefTitle)}</small></div></div><div class="dcv2-identity"><div>Your employee ID<strong>${safe(state.directorySelf?.employeeId || "Active")}</strong></div><div>Team size<strong>${roster.length}</strong></div><div>Your rank<strong>${safe(userRank)}</strong></div><div>Department<strong>${safe(dept.code)}</strong></div></div></aside></section>

      <section class="dcv2-commandbar" aria-label="Quick actions">${quickActions.map((x) => action(...x)).join("")}</section>

      <section class="dcv2-section"><div class="dcv2-section-head"><div><p class="eyebrow">My day</p><h2>Your staff workspace</h2></div><a href="#/profile">My profile →</a></div><div class="dcv2-kpis"><article><span>Open tasks</span><strong>${myOpenTasks.length}</strong><small>Assigned or created by you</small></article><article><span>Open tickets</span><strong>${myOpenTickets.length}</strong><small>Requested or assigned</small></article><article><span>Open requests</span><strong>${myOpenRequests.length}</strong><small>Still awaiting completion</small></article><article><span>Unread inbox</span><strong>${unreadInbox.length}</strong><small>Staff notifications</small></article><article><span>Leave</span><strong>${leavePending.length}</strong><small>Pending request${leavePending.length === 1 ? "" : "s"}</small></article><article class="dark"><span>Latest payroll</span><strong>${latestPayroll ? safe(latestPayroll.periodLabel || "Published") : "—"}</strong><small>${latestPayroll ? safe(titleCase(latestPayroll.status || "available")) : "No statement yet"}</small></article></div></section>

      <section class="dcv2-grid"><div class="dcv2-stack"><section class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Priority</p><h3>My attention queue</h3></div><a href="#/tasks">Open all work →</a></header>${attention.length ? `<div class="dcv2-list">${attention.map((x) => row(x, x._kind, x._href)).join("")}</div>` : empty("You are clear", "No open task, ticket, or request currently needs your attention.")}</section><section class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Department operations</p><h3>Team work in motion</h3></div><a href="#/projects">Projects →</a></header>${teamAttention.length ? `<div class="dcv2-list">${teamAttention.map((x) => row(x, x._kind, x._href)).join("")}</div>` : empty("No priority team work", "High-priority tickets, blocked tasks, and department requests will surface here when your role can view them.")}</section></div><aside class="dcv2-stack"><section class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Schedule</p><h3>Upcoming meetings</h3></div><a href="#/meetings">Calendar →</a></header>${upcomingMeetings.length ? `<div class="dcv2-list">${upcomingMeetings.map((x) => row(x, "Meeting", "#/meetings")).join("")}</div>` : empty("No meetings scheduled", "Upcoming department meetings will appear here.")}</section><section class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Team</p><h3>${safe(dept.shortName)} staff</h3></div><a href="#/directory">Directory →</a></header>${roster.length ? `<div class="dcv2-team">${roster.slice(0, 12).map((person) => `<a class="dcv2-person" href="#/staff/${safe(person.uid || person.id)}"><span class="avatar">${safe(initials(person.displayName || person.discordUsername || "CS"))}</span><div><strong>${safe(person.displayName || person.discordUsername || "Cognitus Staff")}</strong><small>${safe(person.title || getRank(person.rank).label)} · ${safe(person.employeeId || "")}</small></div>${badge(person.status)}</a>`).join("")}</div>` : empty("No staff assigned", "This department does not currently have active staff in the directory.")}</section></aside></section>

      <section class="dcv2-section"><div class="dcv2-section-head"><div><p class="eyebrow">Staff services</p><h2>Everything employees use</h2></div><span></span></div><div class="dcv2-services">${staffServices().map((x) => tile(...x)).join("")}</div></section>

      <section class="dcv2-section"><div class="dcv2-section-head"><div><p class="eyebrow">Department systems</p><h2>Run ${safe(dept.shortName)}</h2></div><span></span></div><div class="dcv2-systems">${departmentSystems(id).map((x, i) => tile(...x, i < 2)).join("")}</div></section>

      <section class="dcv2-grid"><div class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Communications</p><h3>Latest department announcements</h3></div><a href="#/announcements">All announcements →</a></header>${data.announcements.length ? `<div class="dcv2-list">${data.announcements.slice(0, 5).map((x) => row(x, "Announcement", "#/announcements")).join("")}</div>` : empty("No current announcements", "Department announcements will appear here.")}</div><aside class="dcv2-panel"><header class="dcv2-panel-head"><div><p class="eyebrow">Resources</p><h3>Recent department documents</h3></div><a href="#/documents">Library →</a></header>${data.documents.length ? `<div class="dcv2-list">${data.documents.slice(0, 5).map((x) => row(x, "Document", x.url || "#/documents")).join("")}</div>` : empty("No department resources", "Policies, forms, guides, and shared resources will appear here.")}</aside></section>
    </div>`;

    root.querySelector("#dcv2-department-switch")?.addEventListener("change", (event) => {
      location.hash = `#/department-command?department=${encodeURIComponent(event.currentTarget.value)}`;
    });
  } catch (error) {
    console.error("Department Command V2 failed", error);
  } finally {
    state.rendering = false;
  }
}

function fixNavigation() {
  if (!sidebar) return;
  sidebar.querySelectorAll('.g3-nav-group a[href="#/department-command"], .sidebar-group:not(.dept-nav-group) a[href="#/departments"]').forEach((node) => node.style.setProperty("display", "none", "important"));
  const dock = document.querySelector("#portal-mobile-dock");
  if (dock) dock.setAttribute("data-fixed-dock", "true");
}

const QUICK_OPEN = Object.freeze({
  "/tasks": "#new-task",
  "/requests": "#new-request",
  "/tickets": "#new-ticket",
  "/leave": "#new-leave",
  "/projects": "#new-project",
  "/meetings": "#new-meeting",
  "/announcements": "#new-announcement",
  "/documents": "#new-document"
});

function maybeOpenRequestedAction() {
  if (clean(params().get("action")) !== "new") return;
  const selector = QUICK_OPEN[route()];
  if (!selector) return;
  const started = Date.now();
  const timer = window.setInterval(() => {
    const button = root.querySelector(selector);
    if (button) {
      window.clearInterval(timer);
      button.click();
      const cleanHash = `#${route()}`;
      history.replaceState(null, "", cleanHash);
      window.setTimeout(() => root.querySelector("form input, form textarea, form select")?.focus(), 80);
    } else if (Date.now() - started > 3000) {
      window.clearInterval(timer);
    }
  }, 80);
}

function schedule() {
  window.setTimeout(() => {
    fixNavigation();
    if (route() === "/department-command") renderDepartmentCommand();
    else maybeOpenRequestedAction();
  }, 120);
}

async function init() {
  const started = Date.now();
  while (!firebaseState().ready && Date.now() - started < 10000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  const services = firebaseState();
  if (!services.ready) return;
  ({ auth: state.auth, db: state.db, Auth: state.Auth, Fire: state.Fire } = services);
  state.Auth.onAuthStateChanged(state.auth, async (user) => {
    await refreshIdentity(user);
    state.ready = true;
    schedule();
  });
  window.addEventListener("hashchange", schedule);
  if (sidebar) new MutationObserver(() => window.setTimeout(fixNavigation, 20)).observe(sidebar, { childList: true, subtree: true });
  if (root) new MutationObserver(() => {
    if (!state.ready || state.rendering) return;
    if (route() === "/department-command" && !root.querySelector("[data-department-command-v2]")) window.setTimeout(renderDepartmentCommand, 20);
    else maybeOpenRequestedAction();
  }).observe(root, { childList: true, subtree: false });
}

init();
