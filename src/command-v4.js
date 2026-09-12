import { firebaseState, readDoc, readCollection, readQuery, writeBatch } from "./firebase.js";
import { DEPARTMENTS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import { clean, lower, safe, route, formatTimestamp, formatDate, newestFirst, initials, relativeGreeting, titleCase } from "./utils.js";

const MAIN_URL = "https://cognitus-solutions.org/";
const CAREERS_URL = "https://careers.cognitus-solutions.org/";
const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const topbarActions = document.querySelector("#topbar-actions");

const v4 = {
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
  dashboardRendering: false,
  cache: new Map(),
  renderToken: 0,
  sidebarSyncing: false,
  topbarSyncing: false
};

const CLOSED = new Set(["done", "completed", "complete", "closed", "resolved", "cancelled", "declined", "archived", "accepted", "rejected"]);
const CREATE_TARGETS = Object.freeze({
  "/tasks": "#new-task",
  "/requests": "#new-request",
  "/projects": "#new-project",
  "/meetings": "#new-meeting",
  "/announcements": "#new-announcement",
  "/documents": "#new-document",
  "/tickets": "#new-ticket",
  "/leave": "#new-leave"
});

function owner() {
  return Boolean(v4.userRecord?.status === "active" && (v4.userRecord?.role === "owner" || (isActiveStaff(v4.staffAccess) && v4.staffAccess?.rank === "co-owner")));
}
function activeStaff() { return Boolean(v4.authUser && v4.userRecord?.status === "active" && isActiveStaff(v4.staffAccess)); }
function can(permission) { return owner() || hasPermission(v4.staffAccess, permission); }
function canAny(values = []) { return values.some(can); }
function ownDepartmentId() { return v4.staffAccess?.departmentId || v4.directorySelf?.departmentId || ""; }
function ownDepartment() { return getDepartment(ownDepartmentId()); }
function rankLabel() { return getRank(v4.staffAccess?.rank || v4.directorySelf?.rank).label; }
function currentHashPath() { return route(); }

function timestampMs(value) {
  try {
    const date = value?.toDate?.() || (value ? new Date(value) : null);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  } catch { return 0; }
}
function firstTime(item, fields) {
  for (const field of fields) {
    const value = timestampMs(item?.[field]);
    if (value) return value;
  }
  return 0;
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
function isOpen(value) { return !CLOSED.has(lower(value || "open")); }
function priorityWeight(value) {
  const key = lower(value);
  return key === "critical" ? 50 : key === "high" ? 32 : key === "urgent" ? 40 : key === "low" ? 2 : 10;
}
function sameDay(ms, date = new Date()) {
  if (!ms) return false;
  const value = new Date(ms);
  return value.getFullYear() === date.getFullYear() && value.getMonth() === date.getMonth() && value.getDate() === date.getDate();
}
function todayLabel() {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
}
function cacheKey() { return `${v4.authUser?.uid || "none"}:${ownDepartmentId() || "none"}`; }

async function safeQuery(collectionName, constraints = []) {
  try { return await readQuery(collectionName, constraints); }
  catch (error) {
    if (error?.code !== "permission-denied") console.warn(`V4 query unavailable: ${collectionName}`, error);
    return [];
  }
}
async function safeCollection(collectionName) {
  try { return await readCollection(collectionName); }
  catch (error) {
    if (error?.code !== "permission-denied") console.warn(`V4 collection unavailable: ${collectionName}`, error);
    return [];
  }
}

async function refreshIdentity(user) {
  v4.authUser = user || null;
  if (!user) {
    v4.userRecord = null; v4.staffAccess = null; v4.directorySelf = null; v4.directory = []; v4.cache.clear();
    return;
  }
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null),
    readDoc("staffDirectory", user.uid).catch(() => null)
  ]);
  v4.userRecord = userRecord;
  v4.staffAccess = staffAccess;
  v4.directorySelf = directorySelf;
  if (userRecord?.status === "active" && isActiveStaff(staffAccess)) {
    v4.directory = await safeCollection("staffDirectory");
    if (!v4.directory.length && directorySelf) v4.directory = [directorySelf];
  } else {
    v4.directory = directorySelf ? [directorySelf] : [];
  }
}

async function loadMyDay(force = false) {
  if (!activeStaff()) return null;
  const key = cacheKey();
  const existing = v4.cache.get(key);
  if (!force && existing && Date.now() - existing.loadedAt < 30000) return existing.data;
  const uid = v4.authUser.uid;
  const dept = ownDepartmentId();
  const F = v4.Fire;

  // Every query intentionally uses only one equality filter. Sorting and merging
  // happen client-side so Staff / Command does not require composite indexes.
  const [tasksAssigned, tasksCreated, ticketsRequested, ticketsAssigned, requests, leave, payroll, inbox, meetings, announcements] = await Promise.all([
    safeQuery("commandTasks", [F.where("assignedToUid", "==", uid)]),
    safeQuery("commandTasks", [F.where("createdByUid", "==", uid)]),
    safeQuery("commandTickets", [F.where("requesterUid", "==", uid)]),
    safeQuery("commandTickets", [F.where("assignedToUid", "==", uid)]),
    safeQuery("commandRequests", [F.where("requestorUid", "==", uid)]),
    safeQuery("commandLeave", [F.where("requestorUid", "==", uid)]),
    safeQuery("commandPayroll", [F.where("employeeUid", "==", uid)]),
    safeQuery("staffInbox", [F.where("recipientUid", "==", uid)]),
    dept ? safeQuery("commandMeetings", [F.where("departmentId", "==", dept)]) : Promise.resolve([]),
    dept ? safeQuery("commandAnnouncements", [F.where("departmentId", "==", dept)]) : Promise.resolve([])
  ]);

  const tasks = mergeUnique(tasksAssigned, tasksCreated);
  const tickets = mergeUnique(ticketsRequested, ticketsAssigned);
  const openTasks = tasks.filter((item) => isOpen(item.status));
  const openTickets = tickets.filter((item) => isOpen(item.status));
  const openRequests = requests.filter((item) => isOpen(item.status));
  const unread = inbox.filter((item) => !item.readAt);
  const now = Date.now();
  const dueFields = ["dueAt", "dueDate", "dueOn", "deadline"];
  const overdueTasks = openTasks.filter((item) => { const due = firstTime(item, dueFields); return due && due < now && !sameDay(due); });
  const dueToday = openTasks.filter((item) => sameDay(firstTime(item, dueFields)));
  const pendingLeave = leave.filter((item) => lower(item.status) === "pending");

  const attention = [
    ...openTasks.map((item) => {
      const due = firstTime(item, dueFields);
      const overdue = due && due < now && !sameDay(due);
      const weight = (overdue ? 100 : 0) + (lower(item.status) === "blocked" ? 70 : 0) + priorityWeight(item.priority);
      return { ...item, _kind: "Task", _icon: "TK", _href: "#/tasks", _due: due, _weight: weight, _urgent: overdue || lower(item.status) === "blocked" || ["critical", "high", "urgent"].includes(lower(item.priority)) };
    }),
    ...openTickets.map((item) => ({ ...item, _kind: "Ticket", _icon: "TS", _href: "#/tickets", _weight: 35 + priorityWeight(item.priority), _urgent: ["critical", "high", "urgent"].includes(lower(item.priority)) })),
    ...openRequests.map((item) => ({ ...item, _kind: "Request", _icon: "RQ", _href: "#/requests", _weight: 18 + priorityWeight(item.priority), _urgent: false }))
  ].sort((a, b) => b._weight - a._weight || firstTime(b, ["updatedAt", "createdAt"]) - firstTime(a, ["updatedAt", "createdAt"])).slice(0, 8);

  const upcomingMeetings = meetings
    .filter((item) => lower(item.status) !== "cancelled" && firstTime(item, ["startsAt", "startAt", "scheduledFor", "meetingAt", "date", "createdAt"]) >= now - 15 * 60 * 1000)
    .sort((a, b) => firstTime(a, ["startsAt", "startAt", "scheduledFor", "meetingAt", "date", "createdAt"]) - firstTime(b, ["startsAt", "startAt", "scheduledFor", "meetingAt", "date", "createdAt"]));

  const data = {
    tasks, tickets, requests, leave, payroll, inbox, meetings, announcements,
    openTasks, openTickets, openRequests, unread, overdueTasks, dueToday, pendingLeave,
    attention,
    nextMeeting: upcomingMeetings[0] || null,
    latestPayroll: newestFirst(payroll, "periodEnd")[0] || null,
    latestAnnouncements: newestFirst(announcements, "publishedAt").slice(0, 4)
  };
  v4.cache.set(key, { loadedAt: Date.now(), data });
  return data;
}

function workTitle(item) { return item.title || item.subject || item.summary || item.reason || item.cognitusId || item.id || "Work item"; }
function workDescription(item) { return item.description || item.details || item.body || item.notes || "Open this item for details."; }
function renderWorkItem(item) {
  const status = titleCase(item.status || "open");
  const priority = clean(item.priority || "");
  const due = item._due ? (item._due < Date.now() && !sameDay(item._due) ? `Overdue · ${formatDate(new Date(item._due))}` : sameDay(item._due) ? "Due today" : `Due ${formatDate(new Date(item._due))}`) : "";
  return `<a class="v4-work-item" href="${safe(item._href)}"><span class="v4-work-icon">${safe(item._icon)}</span><span class="v4-work-copy"><strong>${safe(workTitle(item))}</strong><span>${safe(clean(workDescription(item)).slice(0, 120))}</span><small>${safe(item._kind)}${due ? ` · ${safe(due)}` : ""}</small></span><span class="v4-work-meta">${item._urgent ? `<span class="v4-pill urgent">Needs attention</span>` : ""}${priority ? `<span class="v4-pill">${safe(priority)}</span>` : ""}<span class="v4-pill">${safe(status)}</span></span></a>`;
}
function emptyMini(title, body) { return `<div class="v4-empty"><strong>${safe(title)}</strong><p>${safe(body)}</p></div>`; }
function launch(title, description, href, icon, external = false) {
  return `<a class="v4-launch" href="${safe(href)}" ${external ? 'target="_blank" rel="noopener"' : ""}><span class="v4-launch-icon">${safe(icon)}</span><span><strong>${safe(title)}</strong><small>${safe(description)}</small></span><b>→</b></a>`;
}

async function renderDashboard(force = false) {
  if (!v4.ready || !activeStaff() || !["/", "/dashboard"].includes(route()) || v4.dashboardRendering) return;
  const token = ++v4.renderToken;
  v4.dashboardRendering = true;
  try {
    const data = await loadMyDay(force);
    if (token !== v4.renderToken || !["/", "/dashboard"].includes(route()) || !data) return;
    const dept = ownDepartment();
    const roster = v4.directory.filter((person) => person.departmentId === dept.id && ["active", "training", "on_leave"].includes(person.status));
    const displayName = v4.directorySelf?.displayName || v4.userRecord?.displayName || "Cognitus Staff";
    const firstName = clean(displayName).split(/\s+/)[0] || displayName;
    const meeting = data.nextMeeting;
    const meetingTime = meeting ? firstTime(meeting, ["startsAt", "startAt", "scheduledFor", "meetingAt", "date", "createdAt"]) : 0;
    const urgentCount = data.overdueTasks.length + data.openTickets.filter((item) => ["critical", "high", "urgent"].includes(lower(item.priority))).length;
    const executive = owner() || canAny([PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ]);

    root.innerHTML = `<div class="page-inner v4-day" data-v4-dashboard>
      <section class="v4-day-hero">
        <div class="v4-day-copy"><p class="eyebrow">${safe(dept.name)} · ${safe(rankLabel())}</p><h1>${safe(relativeGreeting())}, ${safe(firstName)}.</h1><p>${safe(todayLabel())}. Staff Command now starts with the work that needs you—not system statistics. Your tasks, tickets, requests, meetings, notices, and staff services are brought into one operating view.</p><div class="v4-day-actions"><a class="button button-dark" href="#/tasks?action=new">New Task</a><a class="button" href="#/tickets?action=new">Open Ticket</a><a class="button" href="#/department-command">My Department</a></div></div>
        <aside class="v4-day-side"><span>Next up</span><div>${meeting ? `<strong>${safe(meeting.title || meeting.subject || "Department meeting")}</strong><p>${safe(formatTimestamp(new Date(meetingTime)))}${meeting.location ? ` · ${safe(meeting.location)}` : ""}</p>` : `<strong>Your schedule is clear.</strong><p>No upcoming department meeting is currently on your Command schedule.</p>`}</div><div class="v4-side-bottom"><small>${safe(v4.directorySelf?.employeeId || v4.staffAccess?.employeeId || "Staff access active")} · ${safe(dept.code)}</small><button class="v4-refresh" id="v4-refresh-day" type="button">Refresh my day</button></div></aside>
      </section>

      <section class="v4-kpis">
        <article class="v4-kpi ${urgentCount ? "attention" : ""}"><span>Needs attention</span><strong>${urgentCount}</strong><small>Overdue work and high-priority tickets</small></article>
        <article class="v4-kpi"><span>Open tasks</span><strong>${data.openTasks.length}</strong><small>${data.dueToday.length} due today · ${data.overdueTasks.length} overdue</small></article>
        <article class="v4-kpi"><span>Tickets</span><strong>${data.openTickets.length}</strong><small>Requested by or assigned to you</small></article>
        <article class="v4-kpi"><span>Requests</span><strong>${data.openRequests.length}</strong><small>Internal requests still in motion</small></article>
        <article class="v4-kpi"><span>Inbox</span><strong>${data.unread.length}</strong><small>Unread Command notifications</small></article>
        <article class="v4-kpi"><span>Leave</span><strong>${data.pendingLeave.length}</strong><small>Pending time-away requests</small></article>
      </section>

      ${executive ? `<section class="v4-executive-callout"><div><h3>Leadership workspace</h3><p>Your account can open the company-wide operating picture, approvals, and audit tools.</p></div><div class="button-row"><a class="button" href="#/executive">Executive Command</a><a class="button" href="#/executive/approvals">Approvals</a></div></section>` : ""}

      <section class="v4-day-grid">
        <div class="v4-stack">
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Priority</p><h2>Needs your attention</h2></div><a href="#/tasks">Open all work →</a></header><div class="v4-panel-body">${data.attention.length ? `<div class="v4-attention-list">${data.attention.map(renderWorkItem).join("")}</div>` : emptyMini("You are clear", "No open task, ticket, or request currently needs your attention.")}</div></section>
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Quick launch</p><h3>Staff services</h3></div></header><div class="v4-panel-body"><div class="v4-launch-grid">
            ${launch("Tasks", "Assignments and work queue", "#/tasks", "TK")}${launch("Requests", "Internal requests and approvals", "#/requests", "RQ")}${launch("Service Desk", "Support and operational tickets", "#/tickets", "TS")}${launch("Meetings", "Company and department schedule", "#/meetings", "MT")}
            ${launch("Documents", "Policies, forms, and resources", "#/documents", "DC")}${launch("Leave", "Time-away requests", "#/leave", "LV")}${launch("Payroll", data.latestPayroll ? (data.latestPayroll.periodLabel || "Latest statement available") : "Statements and payroll records", "#/payroll", "PY")}${launch("Talent Gateway", "Hiring and applications", CAREERS_URL, "TG", true)}
          </div></div></section>
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Team</p><h3>${safe(dept.shortName)} at a glance</h3></div><a href="#/directory">Directory →</a></header>${roster.length ? `<div class="v4-team-strip">${roster.slice(0, 12).map((person) => `<a class="v4-person" href="#/staff/${safe(person.uid || person.id)}"><span class="avatar">${safe(initials(person.displayName || person.discordUsername || "CS"))}</span><span><strong>${safe(person.displayName || person.discordUsername || "Cognitus Staff")}</strong><small>${safe(person.title || getRank(person.rank).label)}</small></span></a>`).join("")}</div>` : emptyMini("No team records", "Department staff will appear here when directory records are available.")}</section>
        </div>
        <aside class="v4-stack">
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Schedule</p><h3>Next meeting</h3></div><a href="#/meetings">Calendar →</a></header><div class="v4-panel-body">${meeting ? `<div class="v4-meeting-card"><span>${safe(formatDate(new Date(meetingTime)))}</span><strong>${safe(meeting.title || meeting.subject || "Department meeting")}</strong><p>${safe(formatTimestamp(new Date(meetingTime)))}${meeting.location ? `<br>${safe(meeting.location)}` : ""}</p><a href="#/meetings">View schedule →</a></div>` : emptyMini("No meeting scheduled", "Your next department meeting will appear here automatically.")}</div></section>
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Company</p><h3>Announcements</h3></div><a href="#/announcements">View all →</a></header><div>${data.latestAnnouncements.length ? data.latestAnnouncements.map((item) => `<article class="v4-announcement"><strong>${safe(item.title || item.subject || "Announcement")}</strong><p>${safe(clean(item.body || item.message || item.description || "").slice(0, 180))}</p><small>${safe(formatTimestamp(item.publishedAt || item.createdAt))}</small></article>`).join("") : `<div class="v4-empty-mini">No department announcements are currently available.</div>`}</div></section>
          <section class="v4-panel"><header class="v4-panel-head"><div><p class="eyebrow">Employee</p><h3>Your profile</h3></div><a href="#/profile">Open →</a></header><div class="v4-panel-body">${launch("Employee Profile", `${rankLabel()} · ${dept.name}`, "#/profile", initials(displayName))}${launch("Main Cognitus", "Return to the public/product portal", MAIN_URL, "↗", true)}</div></section>
        </aside>
      </section>
    </div>`;

    root.querySelector("#v4-refresh-day")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true; button.textContent = "Refreshing…";
      v4.cache.delete(cacheKey());
      await renderDashboard(true);
    });
    syncTopbar();
  } catch (error) {
    console.error("V4 My Day dashboard unavailable", error);
  } finally {
    v4.dashboardRendering = false;
  }
}

function navLink(href, label, icon, external = false) {
  const active = !external && (route() === href.replace(/^#/, "") || route().startsWith(`${href.replace(/^#/, "")}/`));
  return `<a class="sidebar-link ${active ? "active" : ""} ${external ? "v4-external-link" : ""}" href="${safe(href)}" ${external ? 'target="_blank" rel="noopener"' : ""}><span class="sidebar-link-icon">${safe(icon)}</span><span>${safe(label)}</span></a>`;
}
function navGroup(label, links) {
  const filtered = links.filter(Boolean);
  return filtered.length ? `<section class="sidebar-group v4-sidebar-group"><span class="sidebar-label">${safe(label)}</span>${filtered.join("")}</section>` : "";
}
function leadershipLinks() {
  const links = [];
  if (canAny([PERMISSIONS.HR_RECORDS_READ, PERMISSIONS.HR_RECORDS_MANAGE, PERMISSIONS.STAFF_MANAGE])) links.push(navLink("#/hr/lifecycle", "Employee Lifecycle", "HR"));
  if (canAny([PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_MANAGE])) links.push(navLink("#/finance", "Finance", "FN"));
  if (canAny([PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT])) links.push(navLink("#/quality", "Quality Assurance", "QA"));
  if (canAny([PERMISSIONS.PR_MANAGE, PERMISSIONS.PR_APPROVE])) links.push(navLink("#/public-relations", "Public Relations", "PR"));
  if (canAny([PERMISSIONS.CS_MANAGE, PERMISSIONS.TICKETS_MANAGE])) links.push(navLink("#/customer-service", "Customer Service", "CS"));
  if (owner() || canAny([PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE])) links.push(navLink("#/admin/staff", "Staff Administration", "SA"));
  return links;
}
function commandLinks() {
  const links = [];
  const commandAccess = owner() || canAny([
    PERMISSIONS.REPORTS_REVIEW, PERMISSIONS.CLAIMS_REVIEW, PERMISSIONS.APPEALS_REVIEW,
    PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE,
    PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE, PERMISSIONS.ACCREDITATION_MANAGE,
    PERMISSIONS.ESCALATIONS_MANAGE, PERMISSIONS.INCIDENTS_MANAGE, PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ
  ]);
  if (commandAccess) links.push(navLink("#/command", "Command Overview", "CM"));
  if (can(PERMISSIONS.REPORTS_REVIEW)) links.push(navLink("#/command/reports", "Report Review", "RP"));
  if (can(PERMISSIONS.CLAIMS_REVIEW)) links.push(navLink("#/command/claims", "Claims", "CL"));
  if (can(PERMISSIONS.APPEALS_REVIEW)) links.push(navLink("#/command/appeals", "Appeals", "AP"));
  if (canAny([PERMISSIONS.ORGANIZATIONS_REVIEW, PERMISSIONS.VERIFICATION_REVIEW])) links.push(navLink("#/command/organizations", "Organization Review", "OR"));
  if (canAny([PERMISSIONS.CASES_READ, PERMISSIONS.CASES_MANAGE])) links.push(navLink("#/command/cases", "Case Files", "CF"));
  if (canAny([PERMISSIONS.EVIDENCE_READ, PERMISSIONS.EVIDENCE_MANAGE])) links.push(navLink("#/command/evidence", "Evidence", "EV"));
  if (can(PERMISSIONS.ACCREDITATION_MANAGE)) links.push(navLink("#/command/accreditation", "Accreditation", "AC"));
  if (can(PERMISSIONS.ESCALATIONS_MANAGE)) links.push(navLink("#/command/escalations", "Escalations", "ES"));
  if (can(PERMISSIONS.INCIDENTS_MANAGE)) links.push(navLink("#/command/incidents", "Incidents", "IC"));
  if (owner() || canAny([PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ])) links.push(navLink("#/executive", "Executive Command", "EX"));
  if (owner() || can(PERMISSIONS.ACCOUNTS_READ_ALL)) links.push(navLink("#/executive/accounts", "All Accounts", "UA"));
  if (owner() || can(PERMISSIONS.SYSTEM_MANAGE)) links.push(navLink("#/executive/approvals", "Executive Approvals", "EA"));
  if (owner() || can(PERMISSIONS.AUDIT_READ)) links.push(navLink("#/executive/audit", "Audit Center", "AU"));
  return links;
}

function syncSidebar() {
  if (!sidebar || !activeStaff() || v4.sidebarSyncing) return;
  v4.sidebarSyncing = true;
  try {
    document.body.classList.add("command-v4-active");
    let shell = sidebar.querySelector("[data-v4-nav]");
    if (!shell) {
      shell = document.createElement("div");
      shell.className = "v4-nav-shell";
      shell.dataset.v4Nav = "";
      const divider = sidebar.querySelector(".sidebar-divider");
      if (divider) sidebar.insertBefore(shell, divider); else sidebar.prepend(shell);
    }
    const lead = leadershipLinks();
    const command = commandLinks();
    shell.innerHTML = [
      navGroup("Workspace", [navLink("#/dashboard", "My Day", "HM"), navLink("#/department-command", "My Department", ownDepartment().code?.slice(0,2) || "DP"), navLink("#/inbox", "Inbox", "IN")]),
      navGroup("My Work", [navLink("#/tasks", "Tasks", "TK"), navLink("#/requests", "Requests", "RQ"), navLink("#/projects", "Projects", "PJ"), navLink("#/meetings", "Meetings", "MT")]),
      navGroup("Staff Services", [navLink("#/tickets", "Service Desk", "TS"), navLink("#/announcements", "Announcements", "AN"), navLink("#/documents", "Documents", "DC"), navLink("#/leave", "Leave", "LV"), navLink("#/payroll", "Payroll", "PY")]),
      navGroup("Company", [can(PERMISSIONS.DIRECTORY_READ) ? navLink("#/directory", "Staff Directory", "SD") : "", can(PERMISSIONS.DEPARTMENT_READ) ? navLink("#/departments", "Departments", "DP") : "", navLink("#/profile", "My Profile", "ME")]),
      lead.length ? `<details class="v4-nav-details" open><summary>Leadership</summary>${lead.join("")}</details>` : "",
      command.length ? `<details class="v4-nav-details"><summary>Command & Executive</summary>${command.join("")}</details>` : "",
      navGroup("Cognitus", [navLink(MAIN_URL, "Main Cognitus", "↗", true), navLink(CAREERS_URL, "Talent Gateway", "TG", true)])
    ].join("");
  } finally { v4.sidebarSyncing = false; }
}

function ensurePopover(id) {
  let element = document.querySelector(`#${id}`);
  if (!element) {
    element = document.createElement("div");
    element.id = id; element.className = "v4-popover"; element.hidden = true;
    document.body.appendChild(element);
  }
  return element;
}
function positionPopover(element, trigger) {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
  element.style.width = `${width}px`;
  element.style.left = `${left}px`;
  element.style.top = `${Math.min(window.innerHeight - 90, rect.bottom + 8)}px`;
}
function closePopovers(except = "") {
  ["v4-create-popover", "v4-notification-popover", "v4-account-popover"].forEach((id) => { if (id !== except) { const el = document.querySelector(`#${id}`); if (el) el.hidden = true; } });
}
function createMenuHtml() {
  const items = [
    ["TK", "New Task", "Create or delegate work", "#/tasks?action=new"],
    ["RQ", "New Request", "Submit an internal request", "#/requests?action=new"],
    ["TS", "Open Ticket", "Request operational support", "#/tickets?action=new"],
    ["LV", "Request Leave", "Submit time away", "#/leave?action=new"],
    ["PJ", "New Project", "Start a department initiative", "#/projects?action=new"],
    ["MT", "Schedule Meeting", "Add a company or department meeting", "#/meetings?action=new"],
    ["AN", "Announcement", "Publish a staff notice", "#/announcements?action=new"],
    ["DC", "Add Document", "Add an internal resource", "#/documents?action=new"]
  ];
  return `<div class="v4-popover-head"><strong>Create</strong><button type="button" data-v4-close>Create menu</button></div><div class="v4-menu-list">${items.map(([icon,title,desc,href]) => `<a class="v4-menu-link" href="${href}"><span>${icon}</span><span class="v4-menu-copy"><strong>${title}</strong><small>${desc}</small></span></a>`).join("")}</div>`;
}
async function notificationMenuHtml() {
  const data = await loadMyDay();
  const items = newestFirst(data?.inbox || []).slice(0, 7);
  return `<div class="v4-popover-head"><strong>Notifications${data?.unread?.length ? ` · ${data.unread.length} unread` : ""}</strong>${data?.unread?.length ? `<button type="button" data-v4-mark-read>Mark all read</button>` : ""}</div>${items.length ? `<div class="v4-menu-list">${items.map((item) => `<a class="v4-notice-row ${item.readAt ? "" : "unread"}" href="${safe(item.href || "#/inbox")}"><span class="v4-notice-icon">${safe((item.kind || "IN").slice(0,2).toUpperCase())}</span><span class="v4-notice-copy"><strong>${safe(item.title || "Command notification")}</strong><span>${safe(clean(item.message || "").slice(0,120))}</span><small>${safe(formatTimestamp(item.createdAt))}</small></span>${item.readAt ? "" : `<span class="v4-unread-dot"></span>`}</a>`).join("")}</div>` : `<div class="v4-empty-mini">Your notification center is clear.</div>`}<div class="v4-menu-separator"></div><a class="v4-menu-link" href="#/inbox"><span>IN</span><span class="v4-menu-copy"><strong>Open Inbox</strong><small>See all staff notifications and updates</small></span></a>`;
}
function accountMenuHtml() {
  const dept = ownDepartment();
  const name = v4.directorySelf?.displayName || v4.userRecord?.displayName || "Cognitus Staff";
  return `<div class="v4-popover-head"><strong>${safe(name)}</strong><button type="button" data-v4-close>Close</button></div><div class="v4-menu-list"><a class="v4-menu-link" href="#/profile"><span>ME</span><span class="v4-menu-copy"><strong>Employee Profile</strong><small>${safe(rankLabel())} · ${safe(dept.shortName)}</small></span></a><a class="v4-menu-link" href="${MAIN_URL}" target="_blank" rel="noopener"><span>↗</span><span class="v4-menu-copy"><strong>Main Cognitus</strong><small>Open the public/product portal</small></span></a><a class="v4-menu-link" href="${CAREERS_URL}" target="_blank" rel="noopener"><span>TG</span><span class="v4-menu-copy"><strong>Talent Gateway</strong><small>Careers, applications, and hiring</small></span></a><div class="v4-menu-separator"></div><button class="v4-menu-button" type="button" data-v4-signout><span>SO</span><span class="v4-menu-copy"><strong>Sign out</strong><small>End this Staff / Command session</small></span></button></div>`;
}

async function markAllRead() {
  const data = await loadMyDay();
  const unread = data?.unread || [];
  if (!unread.length) return;
  try {
    for (let i = 0; i < unread.length; i += 400) {
      const batch = writeBatch();
      unread.slice(i, i + 400).forEach((item) => batch.update(v4.Fire.doc(v4.db, "staffInbox", item.id), { readAt: v4.Fire.serverTimestamp(), updatedAt: v4.Fire.serverTimestamp() }));
      await batch.commit();
    }
    v4.cache.delete(cacheKey());
    await syncTopbar(true);
  } catch (error) { console.warn("Could not mark notifications read", error); }
}

async function syncTopbar(forceNotifications = false) {
  if (!topbarActions || !activeStaff() || v4.topbarSyncing) return;
  v4.topbarSyncing = true;
  try {
    const data = await loadMyDay(forceNotifications);
    if (!document.querySelector("#v4-create-trigger")) {
      const create = document.createElement("button");
      create.id = "v4-create-trigger"; create.type = "button"; create.className = "v4-top-action dark";
      create.innerHTML = `<span>＋</span><span class="v4-action-label">Create</span>`;
      topbarActions.insertBefore(create, topbarActions.firstChild);
      create.addEventListener("click", () => {
        const popover = ensurePopover("v4-create-popover");
        popover.innerHTML = createMenuHtml(); popover.hidden = !popover.hidden; positionPopover(popover, create); closePopovers(popover.hidden ? "" : popover.id);
      });
    }
    let bell = document.querySelector("#v4-notification-trigger");
    if (!bell) {
      bell = document.createElement("button"); bell.id = "v4-notification-trigger"; bell.type = "button"; bell.className = "v4-top-action";
      const inboxAnchor = topbarActions.querySelector('a[href="#/inbox"]');
      if (inboxAnchor) inboxAnchor.style.display = "none";
      topbarActions.insertBefore(bell, topbarActions.querySelector(".user-chip") || null);
      bell.addEventListener("click", async () => {
        const popover = ensurePopover("v4-notification-popover");
        popover.innerHTML = `<div class="v4-empty-mini">Loading notifications…</div>`; popover.hidden = false; positionPopover(popover, bell); closePopovers(popover.id);
        popover.innerHTML = await notificationMenuHtml();
        popover.querySelector("[data-v4-mark-read]")?.addEventListener("click", markAllRead);
      });
    }
    bell.innerHTML = `<span>IN</span><span class="v4-action-label">Inbox</span>${data?.unread?.length ? `<span class="v4-notification-count">${Math.min(data.unread.length,99)}</span>` : ""}`;

    const chip = topbarActions.querySelector(".user-chip");
    if (chip && !chip.classList.contains("v4-account-ready")) {
      chip.classList.add("v4-account-ready"); chip.tabIndex = 0; chip.setAttribute("role", "button"); chip.setAttribute("aria-label", "Open account menu");
      const open = () => { const popover = ensurePopover("v4-account-popover"); popover.innerHTML = accountMenuHtml(); popover.hidden = !popover.hidden; positionPopover(popover, chip); closePopovers(popover.hidden ? "" : popover.id); popover.querySelector("[data-v4-signout]")?.addEventListener("click", async () => { await v4.Auth.signOut(v4.auth); location.hash = "#/login"; }); };
      chip.addEventListener("click", open); chip.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } });
    }
  } finally { v4.topbarSyncing = false; }
}

function ensureMobileDock() {
  let dock = document.querySelector("#portal-mobile-dock-v4");
  if (!activeStaff()) { dock?.remove(); return; }
  if (!dock) {
    dock = document.createElement("nav"); dock.id = "portal-mobile-dock-v4"; dock.className = "portal-mobile-dock-v4"; dock.setAttribute("aria-label", "Quick navigation"); document.body.appendChild(dock);
  }
  const items = [["#/dashboard","Home","HM"],["#/department-command","Department","DP"],["#/tasks","Tasks","TK"],["#/inbox","Inbox","IN"]];
  dock.innerHTML = items.map(([href,label,icon]) => `<a href="${href}" class="${route() === href.replace(/^#/,"") ? "active" : ""}"><span>${icon}</span><small>${label}</small></a>`).join("");
}

function enhanceLogin() {
  if (route() !== "/login" && v4.authUser) return;
  const password = root?.querySelector('input[name="password"]');
  if (password && !password.closest(".v4-password-wrap")) {
    const wrap = document.createElement("div"); wrap.className = "v4-password-wrap"; password.parentNode.insertBefore(wrap, password); wrap.appendChild(password);
    const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "v4-password-toggle"; toggle.textContent = "Show"; wrap.appendChild(toggle);
    toggle.addEventListener("click", () => { const hidden = password.type === "password"; password.type = hidden ? "text" : "password"; toggle.textContent = hidden ? "Hide" : "Show"; });
  }
  const panel = root?.querySelector(".login-panel");
  if (panel && !panel.querySelector(".v4-login-links")) panel.insertAdjacentHTML("beforeend", `<div class="v4-login-links"><a href="${MAIN_URL}" target="_blank" rel="noopener">Main Cognitus ↗</a><a href="${CAREERS_URL}" target="_blank" rel="noopener">Talent Gateway ↗</a></div>`);
}

function maybeOpenRequestedAction() {
  const hash = location.hash;
  if (!hash.includes("action=new")) return;
  const selector = CREATE_TARGETS[route()];
  if (!selector) return;
  const started = Date.now();
  const timer = window.setInterval(() => {
    const button = root?.querySelector(selector);
    if (button) {
      clearInterval(timer); button.click(); history.replaceState(null, "", `#${route()}`); window.setTimeout(() => root.querySelector("form input, form textarea, form select")?.focus(), 70);
    } else if (Date.now() - started > 2500) clearInterval(timer);
  }, 90);
}

function scheduleEnhance(delay = 80) {
  window.setTimeout(async () => {
    if (!v4.ready) return;
    if (!activeStaff()) { enhanceLogin(); return; }
    syncSidebar(); ensureMobileDock(); await syncTopbar(); maybeOpenRequestedAction();
    if (["/", "/dashboard"].includes(route())) await renderDashboard();
  }, delay);
}

async function init() {
  document.body.classList.add("command-v4-active");
  const started = Date.now();
  while (!firebaseState().ready && Date.now() - started < 10000) await new Promise((resolve) => setTimeout(resolve, 50));
  const services = firebaseState();
  if (!services.ready) { enhanceLogin(); return; }
  ({ auth: v4.auth, db: v4.db, Auth: v4.Auth, Fire: v4.Fire } = services);
  v4.Auth.onAuthStateChanged(v4.auth, async (user) => {
    try { await refreshIdentity(user); } catch (error) { console.warn("V4 identity refresh unavailable", error); }
    v4.ready = true; scheduleEnhance(140);
  });

  window.addEventListener("hashchange", () => { v4.renderToken += 1; closePopovers(); scheduleEnhance(100); });
  window.addEventListener("resize", () => closePopovers());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopovers();
    if (event.altKey && lower(event.key) === "n" && activeStaff()) { event.preventDefault(); document.querySelector("#v4-create-trigger")?.click(); }
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-v4-close]")) closePopovers();
    if (!event.target.closest(".v4-popover, #v4-create-trigger, #v4-notification-trigger, .user-chip")) closePopovers();
  });
  if (sidebar) new MutationObserver(() => { if (v4.ready && activeStaff() && !sidebar.querySelector("[data-v4-nav]")) scheduleEnhance(20); }).observe(sidebar, { childList: true });
  if (topbarActions) new MutationObserver(() => { if (v4.ready && activeStaff() && !topbarActions.querySelector("#v4-create-trigger")) scheduleEnhance(20); }).observe(topbarActions, { childList: true });
  if (root) new MutationObserver(() => { if (!v4.ready) return; if (!v4.authUser) enhanceLogin(); else if (["/", "/dashboard"].includes(route()) && !root.querySelector("[data-v4-dashboard]")) scheduleEnhance(40); }).observe(root, { childList: true });
}

init();
