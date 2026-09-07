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
  statusLabel,
  debounce,
  titleCase
} from "./utils.js";

const BUILD = "command-g2-2026-09-06";
const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const commandOverlay = document.querySelector("#command-overlay");
const commandInput = document.querySelector("#command-input");
const commandResults = document.querySelector("#command-results");
const toastRegion = document.querySelector("#toast-region");

const g2 = {
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

const G2_ROUTES = new Set([
  "/tasks",
  "/requests",
  "/projects",
  "/meetings",
  "/announcements",
  "/documents",
  "/tickets",
  "/leave",
  "/hr/lifecycle",
  "/finance",
  "/payroll"
]);

const COMMAND_PAGES = [
  ["Tasks", "My assignments and department work queue", "#/tasks", "TK"],
  ["Requests", "Internal requests and approvals", "#/requests", "RQ"],
  ["Projects", "Department and company projects", "#/projects", "PJ"],
  ["Meetings", "Company and department meeting schedule", "#/meetings", "MT"],
  ["Announcements", "Official Cognitus staff notices", "#/announcements", "AN"],
  ["Documents", "Internal document and resource library", "#/documents", "DC"],
  ["Service Desk", "Internal tickets and support requests", "#/tickets", "TS"],
  ["Leave", "Time-away requests and approvals", "#/leave", "LV"],
  ["Employee Lifecycle", "Onboarding, transfers, promotions, and offboarding", "#/hr/lifecycle", "HR"],
  ["Finance", "Internal finance ledger and approvals", "#/finance", "FN"],
  ["Payroll", "Payroll records and employee statements", "#/payroll", "PY"]
];

function owner() {
  return g2.userRecord?.status === "active" && g2.userRecord?.role === "owner";
}

function can(permission) {
  return owner() || hasPermission(g2.staffAccess, permission);
}

function activeStaff() {
  return Boolean(g2.authUser && g2.userRecord?.status === "active" && isActiveStaff(g2.staffAccess));
}

function accessLevel() {
  return Number(g2.staffAccess?.accessLevel || 0);
}

function departmentId() {
  return g2.staffAccess?.departmentId || g2.directorySelf?.departmentId || "";
}

function canLeadDepartment(id = departmentId()) {
  return owner() || (id === departmentId() && can(PERMISSIONS.DEPARTMENT_MANAGE));
}

function canManageRequests(id) {
  if (owner()) return true;
  if (id === departmentId() && can(PERMISSIONS.DEPARTMENT_MANAGE)) return true;
  if (id === "human-resources" && can(PERMISSIONS.HR_RECORDS_MANAGE)) return true;
  if (id === "finance" && can(PERMISSIONS.FINANCE_MANAGE)) return true;
  if (id === "customer-service" && can(PERMISSIONS.TICKETS_MANAGE)) return true;
  return false;
}

function canManageTickets(id) {
  return owner() || (can(PERMISSIONS.TICKETS_MANAGE) && id === departmentId());
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

function emptyState(icon, title, body, action = "") {
  return `<div class="empty-state"><span class="empty-state-icon">${safe(icon)}</span><h3>${safe(title)}</h3><p>${safe(body)}</p>${action ? `<div class="button-row" style="justify-content:center;margin-top:16px">${action}</div>` : ""}</div>`;
}

function pageHeader(eyebrow, title, description, action = "") {
  return `<header class="page-header g2-page-header"><div class="page-header-copy"><p class="eyebrow">${safe(eyebrow)}</p><h1>${safe(title)}</h1><p>${safe(description)}</p></div>${action}</header>`;
}

function badge(status) {
  return `<span class="badge ${safe(status || "")}">${safe(titleCase(status || "unknown"))}</span>`;
}

function personName(uid) {
  return g2.directory.find((person) => (person.uid || person.id) === uid)?.displayName || (uid === g2.authUser?.uid ? g2.directorySelf?.displayName : "") || "Cognitus Staff";
}

function formatMoney(cents) {
  const amount = Number(cents || 0) / 100;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
}

function toCents(value) {
  const number = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function timestampFromInput(value) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : g2.Fire.Timestamp.fromDate(date);
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

function mergeUnique(...groups) {
  const seen = new Set();
  return groups.flat().filter((item) => {
    const id = item?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function departmentOptions(selected = "") {
  return DEPARTMENTS.map((department) => `<option value="${safe(department.id)}" ${department.id === selected ? "selected" : ""}>${safe(department.name)}</option>`).join("");
}

function staffOptions({ department = "", selected = "", includeSelf = true } = {}) {
  const people = alphabetic(g2.directory.filter((person) => {
    if (!["active", "training", "on_leave"].includes(person.status)) return false;
    if (department && person.departmentId !== department) return false;
    if (!includeSelf && (person.uid || person.id) === g2.authUser?.uid) return false;
    return true;
  }));
  return people.map((person) => `<option value="${safe(person.uid || person.id)}" ${(person.uid || person.id) === selected ? "selected" : ""}>${safe(person.displayName)} · ${safe(person.employeeId || getRank(person.rank).label)}</option>`).join("");
}

async function writeActivity(action, targetType, targetId, summary, metadata = {}) {
  if (!g2.authUser || !g2.userRecord?.cognitusId) return;
  try {
    const ref = newFirestoreDoc("auditLogs");
    await g2.Fire.setDoc(ref, {
      id: ref.id,
      cognitusId: createCognitusId("AUD"),
      actorUid: g2.authUser.uid,
      actorCognitusId: g2.userRecord.cognitusId,
      actorRole: g2.userRecord.role,
      action: clean(action).slice(0, 80),
      targetType: clean(targetType).slice(0, 80),
      targetId: targetId || null,
      summary: clean(summary).slice(0, 500),
      metadata,
      createdAt: g2.Fire.serverTimestamp()
    });
  } catch (error) {
    console.warn("Generation 2 audit write unavailable", error);
  }
}

async function notify(recipientUid, kind, title, message, href = null) {
  if (!recipientUid || recipientUid === g2.authUser?.uid) return;
  try {
    const ref = newFirestoreDoc("staffInbox");
    const now = g2.Fire.serverTimestamp();
    await g2.Fire.setDoc(ref, {
      id: ref.id,
      recipientUid,
      senderUid: g2.authUser.uid,
      kind: clean(kind).slice(0, 50),
      title: clean(title).slice(0, 120),
      message: clean(message).slice(0, 1000),
      href,
      readAt: null,
      createdAt: now,
      updatedAt: now
    });
  } catch (error) {
    console.warn("Command notification unavailable", error);
  }
}

async function createRecord(collectionName, data, activity) {
  const ref = newFirestoreDoc(collectionName);
  const now = g2.Fire.serverTimestamp();
  await g2.Fire.setDoc(ref, { id: ref.id, ...data, createdAt: now, updatedAt: now });
  if (activity) await writeActivity(activity.action, activity.type || collectionName, ref.id, activity.summary, activity.metadata || {});
  return ref.id;
}

async function updateRecord(collectionName, id, patch, activity) {
  await g2.Fire.updateDoc(g2.Fire.doc(g2.db, collectionName, id), { ...patch, updatedAt: g2.Fire.serverTimestamp() });
  if (activity) await writeActivity(activity.action, activity.type || collectionName, id, activity.summary, activity.metadata || {});
}

async function refreshIdentity(user) {
  g2.authUser = user || null;
  if (!user) {
    g2.userRecord = null;
    g2.staffAccess = null;
    g2.directorySelf = null;
    g2.directory = [];
    return;
  }
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null),
    readDoc("staffDirectory", user.uid).catch(() => null)
  ]);
  g2.userRecord = userRecord;
  g2.staffAccess = staffAccess;
  g2.directorySelf = directorySelf;
  if (userRecord?.status === "active" && (userRecord.role === "owner" || isActiveStaff(staffAccess))) {
    g2.directory = alphabetic(await readCollection("staffDirectory").catch(() => directorySelf ? [directorySelf] : []));
  }
}

function allowedNav(item) {
  if (!item.permission) return true;
  if (Array.isArray(item.permission)) return item.permission.some(can);
  return can(item.permission);
}

function navSection(label, items) {
  const allowed = items.filter(allowedNav);
  if (!allowed.length) return "";
  return `<section class="sidebar-group g2-nav-group" data-g2-nav><span class="sidebar-label">${safe(label)}</span>${allowed.map((item) => `<a class="sidebar-link ${route() === item.path || route().startsWith(`${item.path}/`) ? "active" : ""}" href="#${safe(item.path)}"><span class="sidebar-link-icon">${safe(item.icon)}</span><span>${safe(item.label)}</span></a>`).join("")}</section>`;
}

function augmentChrome() {
  if (!activeStaff() || !sidebar || !sidebar.children.length) return;
  if (!sidebar.querySelector("[data-g2-nav]")) {
    const divider = sidebar.querySelector(".sidebar-divider");
    const holder = document.createElement("div");
    holder.setAttribute("data-g2-nav-holder", "");
    holder.innerHTML = [
      navSection("Work", [
        { path: "/tasks", label: "Tasks", icon: "TK" },
        { path: "/requests", label: "Requests", icon: "RQ" },
        { path: "/projects", label: "Projects", icon: "PJ" },
        { path: "/meetings", label: "Meetings", icon: "MT" }
      ]),
      navSection("Resources", [
        { path: "/announcements", label: "Announcements", icon: "AN" },
        { path: "/documents", label: "Documents", icon: "DC" },
        { path: "/tickets", label: "Service Desk", icon: "TS" },
        { path: "/leave", label: "Leave", icon: "LV" }
      ]),
      navSection("Management", [
        { path: "/hr/lifecycle", label: "Employee Lifecycle", icon: "HR", permission: [PERMISSIONS.HR_RECORDS_READ, PERMISSIONS.HR_RECORDS_MANAGE] },
        { path: "/finance", label: "Finance", icon: "FN", permission: [PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_MANAGE] },
        { path: "/payroll", label: "Payroll", icon: "PY" }
      ])
    ].join("");
    if (divider) sidebar.insertBefore(holder, divider);
    else sidebar.appendChild(holder);
  }
  const build = sidebar.querySelector(".sidebar-profile span:last-child");
  if (build && build.textContent !== BUILD) build.textContent = BUILD;
}

function injectStyles() {
  if (document.querySelector("#cognitus-g2-styles")) return;
  const style = document.createElement("style");
  style.id = "cognitus-g2-styles";
  style.textContent = `
    .g2-page-header{align-items:flex-end}.g2-nav-group:first-child{margin-top:6px}.g2-dashboard{margin:-2px 0 18px}
    .g2-toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 14px}.g2-toolbar .input-shell{min-width:220px;flex:1;max-width:460px}
    .g2-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.g2-column{border:1px solid #e8e8e8;background:#fafafa;min-height:220px}.g2-column-head{padding:13px 14px;border-bottom:1px solid #e8e8e8;display:flex;align-items:center;justify-content:space-between}.g2-column-head strong{font-size:10px;text-transform:uppercase;letter-spacing:.08em}.g2-column-body{padding:9px;display:grid;gap:8px}
    .g2-card{border:1px solid #e5e5e5;background:#fff;padding:14px;text-decoration:none;color:inherit;display:block}.g2-card:hover{border-color:#bdbdbd}.g2-card-top{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;margin-bottom:8px}.g2-card h3{font-size:13px;line-height:1.25;margin:0;letter-spacing:-.02em}.g2-card p{font-size:10px;line-height:1.55;color:#666;margin:7px 0 0}.g2-card-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px;font-size:9px;color:#777}.g2-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:11px;border-top:1px solid #eee}
    .g2-priority{font-size:8px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;padding:4px 6px;border:1px solid #ddd}.g2-priority.high,.g2-priority.critical{background:#111;color:#fff;border-color:#111}.g2-priority.low{color:#777}
    .g2-list{display:grid}.g2-list-item{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(110px,.7fr) minmax(110px,.7fr) auto;gap:14px;align-items:center;padding:14px 16px;border-bottom:1px solid #eee}.g2-list-item:last-child{border-bottom:0}.g2-list-copy strong{display:block;font-size:11px}.g2-list-copy span{display:block;font-size:9px;color:#6c6c6c;margin-top:4px;line-height:1.5}.g2-list-meta{font-size:9px;color:#666}.g2-list-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .g2-split{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.7fr);gap:18px;align-items:start}.g2-form-card{position:sticky;top:calc(var(--topbar-height) + 18px)}.g2-section-stack{display:grid;gap:18px}.g2-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.g2-mini{border:1px solid #e8e8e8;padding:13px;background:#fff}.g2-mini span{font-size:8px;color:#777;text-transform:uppercase;letter-spacing:.08em}.g2-mini strong{display:block;font-size:18px;margin-top:5px}.g2-money{font-variant-numeric:tabular-nums}.g2-note{font-size:9px;color:#777;line-height:1.55}.g2-record-link{color:inherit;text-decoration:underline;text-underline-offset:2px}.g2-form-toggle{margin-bottom:12px}
    .g2-announcement{padding:19px 20px;border-bottom:1px solid #eee}.g2-announcement:last-child{border-bottom:0}.g2-announcement.pinned{background:#fafafa}.g2-announcement-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}.g2-announcement h3{font-size:15px;margin:0}.g2-announcement p{font-size:10px;line-height:1.7;color:#555;white-space:pre-wrap}.g2-announcement small{font-size:8px;color:#888}.g2-command-label{margin:7px 12px 4px;font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#999}.g2-command-result{width:calc(100% - 16px);margin:2px 8px}
    .g2-timeline{display:grid;gap:0}.g2-timeline-item{display:grid;grid-template-columns:88px 14px 1fr;gap:10px;min-height:70px}.g2-timeline-time{font-size:9px;color:#777;text-align:right;padding-top:3px}.g2-timeline-line{position:relative;border-left:1px solid #ddd}.g2-timeline-dot{position:absolute;width:7px;height:7px;border-radius:50%;background:#111;left:-4px;top:5px}.g2-timeline-copy{padding:0 0 18px}.g2-timeline-copy strong{font-size:11px}.g2-timeline-copy span{display:block;font-size:9px;color:#666;margin-top:3px}.g2-danger{border-color:#1a1a1a}.g2-muted{opacity:.7}
    @media (max-width:1050px){.g2-board{grid-template-columns:repeat(2,minmax(0,1fr))}.g2-split{grid-template-columns:1fr}.g2-form-card{position:static}.g2-mini-grid{grid-template-columns:1fr 1fr}}
    @media (max-width:720px){.g2-board{grid-template-columns:1fr}.g2-list-item{grid-template-columns:1fr}.g2-list-actions{justify-content:flex-start}.g2-mini-grid{grid-template-columns:1fr}.g2-page-header{align-items:flex-start}}
  `;
  document.head.appendChild(style);
}

async function tasksData() {
  if (owner()) return newestFirst(await readCollection("commandTasks").catch(() => []), "updatedAt");
  const mine = await readQuery("commandTasks", [g2.Fire.where("assignedToUid", "==", g2.authUser.uid)]).catch(() => []);
  const created = await readQuery("commandTasks", [g2.Fire.where("createdByUid", "==", g2.authUser.uid)]).catch(() => []);
  const department = canLeadDepartment() ? await readQuery("commandTasks", [g2.Fire.where("departmentId", "==", departmentId())]).catch(() => []) : [];
  return newestFirst(mergeUnique(mine, created, department), "updatedAt");
}

async function tasksPage() {
  setTitle("Tasks");
  const tasks = await tasksData();
  const open = tasks.filter((task) => !["done", "cancelled"].includes(task.status));
  root.innerHTML = `<div class="page-inner" data-g2-page="tasks">
    ${pageHeader("Work management", "Tasks.", "Your assignments, work you created, and department tasks you are authorized to oversee.", `<button class="button button-dark" id="new-task" type="button">New Task</button>`)}
    <section class="stats-grid"><article class="stat-card"><span>Open</span><strong>${open.length}</strong><small>Not yet completed</small></article><article class="stat-card"><span>In Progress</span><strong>${tasks.filter((item) => item.status === "in_progress").length}</strong><small>Actively underway</small></article><article class="stat-card"><span>Blocked</span><strong>${tasks.filter((item) => item.status === "blocked").length}</strong><small>Needs intervention</small></article><article class="stat-card"><span>Complete</span><strong>${tasks.filter((item) => item.status === "done").length}</strong><small>Visible completed work</small></article></section>
    <div id="task-form-wrap" class="g2-form-toggle" hidden></div>
    ${tasks.length ? `<section class="g2-board">${["open", "in_progress", "blocked", "done"].map((status) => `<div class="g2-column"><div class="g2-column-head"><strong>${safe(titleCase(status))}</strong><span class="badge">${tasks.filter((task) => task.status === status).length}</span></div><div class="g2-column-body">${tasks.filter((task) => task.status === status).map(taskCard).join("") || `<p class="g2-note" style="padding:8px">Nothing here.</p>`}</div></div>`).join("")}</section>` : `<section class="panel">${emptyState("TK", "No tasks yet", "Create your first task to start organizing Cognitus work.", `<button class="button button-dark" id="empty-new-task" type="button">Create Task</button>`)}</section>`}
  </div>`;
  const openForm = () => renderTaskForm();
  root.querySelector("#new-task")?.addEventListener("click", openForm);
  root.querySelector("#empty-new-task")?.addEventListener("click", openForm);
  root.querySelectorAll("[data-task-status]").forEach((button) => button.addEventListener("click", () => updateTaskStatus(button.dataset.taskId, button.dataset.taskStatus, button.dataset.taskAssignee)));
}

function taskCard(task) {
  const due = task.dueAt ? formatDate(task.dueAt) : "No due date";
  const canChange = task.assignedToUid === g2.authUser.uid || task.createdByUid === g2.authUser.uid || canLeadDepartment(task.departmentId);
  return `<article class="g2-card"><div class="g2-card-top"><h3>${safe(task.title)}</h3><span class="g2-priority ${safe(task.priority)}">${safe(task.priority || "normal")}</span></div><p>${safe(task.description || "No description provided.")}</p><div class="g2-card-meta"><span>${safe(personName(task.assignedToUid))}</span><span>•</span><span>${safe(getDepartment(task.departmentId).shortName)}</span><span>•</span><span>${safe(due)}</span></div>${canChange && task.status !== "done" ? `<div class="g2-card-actions">${task.status !== "in_progress" ? `<button class="button button-small" type="button" data-task-status="in_progress" data-task-id="${safe(task.id)}" data-task-assignee="${safe(task.assignedToUid)}">Start</button>` : ""}${task.status !== "blocked" ? `<button class="button button-small" type="button" data-task-status="blocked" data-task-id="${safe(task.id)}" data-task-assignee="${safe(task.assignedToUid)}">Block</button>` : ""}<button class="button button-small button-dark" type="button" data-task-status="done" data-task-id="${safe(task.id)}" data-task-assignee="${safe(task.assignedToUid)}">Complete</button></div>` : ""}</article>`;
}

function renderTaskForm() {
  const wrap = root.querySelector("#task-form-wrap");
  if (!wrap) return;
  wrap.hidden = false;
  const self = g2.authUser.uid;
  const canAssign = canLeadDepartment();
  wrap.innerHTML = `<section class="form-card"><header class="panel-header"><div><p class="eyebrow">New assignment</p><h2>Create task</h2></div><button class="button button-small" id="close-task-form" type="button">Close</button></header><div id="task-message" class="notice" hidden></div><form id="task-form" class="form-stack"><label>Task title<input name="title" maxlength="120" required></label><label>Description<textarea name="description" maxlength="1800" rows="4" placeholder="What needs to be done?"></textarea></label><div class="form-row"><label>Priority<select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Due date<input name="dueAt" type="datetime-local"></label></div><label>Assigned to<select name="assignedToUid">${canAssign ? staffOptions({ department: departmentId(), selected: self }) : `<option value="${safe(self)}">${safe(g2.directorySelf?.displayName || "Me")}</option>`}</select></label><button class="button button-dark" type="submit">Create Task</button></form></section>`;
  wrap.querySelector("#close-task-form")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#task-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const message = wrap.querySelector("#task-message");
    const button = form.querySelector("button[type=submit]");
    const assignee = clean(data.assignedToUid) || self;
    const person = g2.directory.find((entry) => (entry.uid || entry.id) === assignee);
    if (!person) return showNotice(message, "Choose a valid staff member.", "error");
    if (!canAssign && assignee !== self) return showNotice(message, "You can only assign tasks to yourself.", "error");
    if (canAssign && person.departmentId !== departmentId()) return showNotice(message, "Department leadership can only assign within its department.", "error");
    try {
      setBusy(button, true, "Creating…", "Create Task");
      const id = await createRecord("commandTasks", {
        title: clean(data.title).slice(0, 120), description: clean(data.description).slice(0, 1800), priority: clean(data.priority) || "normal", status: "open",
        assignedToUid: assignee, ownerUid: assignee, createdByUid: g2.authUser.uid, departmentId: person.departmentId,
        dueAt: timestampFromInput(data.dueAt), completedAt: null
      }, { action: "COMMAND_TASK_CREATED", summary: `Created task ${clean(data.title).slice(0, 120)}.` });
      await notify(assignee, "task", "New task assigned", clean(data.title), `#/tasks`);
      toast("Task created.");
      await tasksPage();
      return id;
    } catch (error) {
      console.error(error);
      showNotice(message, error?.code === "permission-denied" ? "Firestore denied this task. Confirm Generation 2 rules are deployed." : "The task could not be created.", "error");
    } finally { setBusy(button, false, "Creating…", "Create Task"); }
  });
}

async function updateTaskStatus(id, status, assignee) {
  try {
    await updateRecord("commandTasks", id, { status, completedAt: status === "done" ? g2.Fire.serverTimestamp() : null }, { action: "COMMAND_TASK_STATUS", summary: `Changed a task to ${status}.` });
    if (assignee && assignee !== g2.authUser.uid) await notify(assignee, "task", "Task updated", `Task status changed to ${titleCase(status)}.`, "#/tasks");
    toast(`Task marked ${titleCase(status)}.`);
    await tasksPage();
  } catch (error) {
    console.error(error);
    toast("Task update was not permitted.");
  }
}

async function requestsData() {
  if (owner()) return newestFirst(await readCollection("commandRequests").catch(() => []));
  const mine = await readQuery("commandRequests", [g2.Fire.where("requestorUid", "==", g2.authUser.uid)]).catch(() => []);
  const department = canLeadDepartment() || can(PERMISSIONS.HR_RECORDS_MANAGE) || can(PERMISSIONS.FINANCE_MANAGE)
    ? await readQuery("commandRequests", [g2.Fire.where("departmentId", "==", departmentId())]).catch(() => []) : [];
  return newestFirst(mergeUnique(mine, department));
}

async function requestsPage() {
  setTitle("Requests");
  const records = await requestsData();
  root.innerHTML = `<div class="page-inner" data-g2-page="requests">${pageHeader("Internal workflow", "Requests.", "Ask another Cognitus department for access, purchasing, HR help, scheduling, or general assistance.", `<button class="button button-dark" id="new-request" type="button">New Request</button>`)}<div id="request-form-wrap" hidden></div><section class="panel">${records.length ? `<div class="g2-list">${records.map(requestRow).join("")}</div>` : emptyState("RQ", "No requests", "Requests you submit or are responsible for will appear here.")}</section></div>`;
  root.querySelector("#new-request")?.addEventListener("click", renderRequestForm);
  root.querySelectorAll("[data-request-action]").forEach((button) => button.addEventListener("click", () => reviewRequest(button.dataset.requestId, button.dataset.requestAction, button.dataset.requestor)));
}

function requestRow(item) {
  const manageable = canManageRequests(item.departmentId) && item.requestorUid !== g2.authUser.uid;
  return `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(item.title)}</strong><span>${safe(item.details || "")}</span><span>${safe(personName(item.requestorUid))} → ${safe(getDepartment(item.departmentId).shortName)}</span></div><div class="g2-list-meta">${safe(titleCase(item.type))}<br>${safe(formatTimestamp(item.createdAt))}</div><div>${badge(item.status)}</div><div class="g2-list-actions">${manageable && item.status === "pending" ? `<button class="button button-small" data-request-action="approved" data-request-id="${safe(item.id)}" data-requestor="${safe(item.requestorUid)}">Approve</button><button class="button button-small" data-request-action="declined" data-request-id="${safe(item.id)}" data-requestor="${safe(item.requestorUid)}">Decline</button>` : ""}${manageable && item.status === "approved" ? `<button class="button button-small button-dark" data-request-action="closed" data-request-id="${safe(item.id)}" data-requestor="${safe(item.requestorUid)}">Close</button>` : ""}</div></article>`;
}

function renderRequestForm() {
  const wrap = root.querySelector("#request-form-wrap");
  if (!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Submit request</p><h2>Route work to a department</h2></div><button class="button button-small" id="close-request" type="button">Close</button></header><div id="request-message" class="notice" hidden></div><form id="request-form" class="form-stack"><div class="form-row"><label>Request type<select name="type"><option value="general">General</option><option value="access">Access / permissions</option><option value="purchase">Purchase</option><option value="hr">Human Resources</option><option value="scheduling">Scheduling</option><option value="finance">Finance</option></select></label><label>Destination<select name="departmentId">${departmentOptions("human-resources")}</select></label></div><label>Title<input name="title" maxlength="120" required></label><label>Details<textarea name="details" maxlength="2500" rows="5" required></textarea></label><button class="button button-dark" type="submit">Submit Request</button></form></section>`;
  wrap.querySelector("#close-request")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#request-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#request-message"); const button = form.querySelector("button[type=submit]");
    try {
      setBusy(button, true, "Submitting…", "Submit Request");
      await createRecord("commandRequests", { requestorUid: g2.authUser.uid, departmentId: data.departmentId, type: clean(data.type), title: clean(data.title).slice(0, 120), details: clean(data.details).slice(0, 2500), status: "pending", reviewedByUid: null, reviewedAt: null, resolutionNote: "" }, { action: "COMMAND_REQUEST_CREATED", summary: `Submitted ${clean(data.type)} request.` });
      toast("Request submitted."); await requestsPage();
    } catch (error) { console.error(error); showNotice(message, error?.code === "permission-denied" ? "Request submission is not permitted until Generation 2 rules are deployed." : "The request could not be submitted.", "error"); }
    finally { setBusy(button, false, "Submitting…", "Submit Request"); }
  });
}

async function reviewRequest(id, status, requestorUid) {
  try {
    await updateRecord("commandRequests", id, { status, reviewedByUid: g2.authUser.uid, reviewedAt: g2.Fire.serverTimestamp() }, { action: "COMMAND_REQUEST_REVIEWED", summary: `Request ${status}.` });
    await notify(requestorUid, "request", "Request updated", `Your request is now ${titleCase(status)}.`, "#/requests");
    toast(`Request ${titleCase(status)}.`); await requestsPage();
  } catch (error) { console.error(error); toast("Request update was not permitted."); }
}

async function companyVisible(collectionName) {
  if (owner()) return newestFirst(await readCollection(collectionName).catch(() => []));
  const company = await readQuery(collectionName, [g2.Fire.where("visibility", "==", "company")]).catch(() => []);
  const department = departmentId() ? await readQuery(collectionName, [g2.Fire.where("departmentId", "==", departmentId())]).catch(() => []) : [];
  return newestFirst(mergeUnique(company, department));
}

async function announcementsData() {
  if (owner()) return newestFirst(await readCollection("commandAnnouncements").catch(() => []), "publishedAt");
  const company = await readQuery("commandAnnouncements", [g2.Fire.where("audience", "==", "company")]).catch(() => []);
  const department = departmentId() ? await readQuery("commandAnnouncements", [g2.Fire.where("departmentId", "==", departmentId())]).catch(() => []) : [];
  const now = Date.now();
  return newestFirst(mergeUnique(company, department).filter((item) => {
    const expires = item.expiresAt?.toDate?.()?.getTime?.() || Infinity;
    return expires >= now;
  }), "publishedAt");
}

async function announcementsPage() {
  setTitle("Announcements");
  const items = await announcementsData();
  const mayPost = owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="announcements">${pageHeader("Official notices", "Announcements.", "A single source for company-wide and department staff communications.", mayPost ? `<button class="button button-dark" id="new-announcement" type="button">Publish</button>` : "")}<div id="announcement-form-wrap" hidden></div><section class="panel">${items.length ? items.map((item) => `<article class="g2-announcement ${item.pinned ? "pinned" : ""}"><div class="g2-announcement-head"><div><p class="eyebrow">${safe(item.audience === "company" ? "Company" : getDepartment(item.departmentId).name)}${item.pinned ? " · Pinned" : ""}</p><h3>${safe(item.title)}</h3></div><span class="g2-priority ${safe(item.priority)}">${safe(item.priority || "normal")}</span></div><p>${safe(item.body)}</p><small>Published ${safe(formatTimestamp(item.publishedAt || item.createdAt))} by ${safe(personName(item.createdByUid))}</small></article>`).join("") : emptyState("AN", "No current announcements", "Official staff notices will appear here.")}</section></div>`;
  root.querySelector("#new-announcement")?.addEventListener("click", renderAnnouncementForm);
}

function renderAnnouncementForm() {
  const wrap = root.querySelector("#announcement-form-wrap"); if (!wrap) return; wrap.hidden = false;
  const companyAllowed = owner() || can(PERMISSIONS.SYSTEM_MANAGE);
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Publish notice</p><h2>New announcement</h2></div><button class="button button-small" id="close-announcement" type="button">Close</button></header><div id="announcement-message" class="notice" hidden></div><form id="announcement-form" class="form-stack"><div class="form-row"><label>Audience<select name="audience">${companyAllowed ? `<option value="company">Entire company</option>` : ""}<option value="department">My department</option></select></label><label>Priority<select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label></div><label>Title<input name="title" maxlength="140" required></label><label>Announcement<textarea name="body" maxlength="5000" rows="7" required></textarea></label><div class="form-row"><label>Expires (optional)<input name="expiresAt" type="datetime-local"></label><label class="checkbox-line"><input name="pinned" type="checkbox"> Pin announcement</label></div><button class="button button-dark" type="submit">Publish Announcement</button></form></section>`;
  wrap.querySelector("#close-announcement")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#announcement-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#announcement-message"); const button = form.querySelector("button[type=submit]");
    const audience = data.audience === "company" && companyAllowed ? "company" : "department";
    try { setBusy(button, true, "Publishing…", "Publish Announcement"); await createRecord("commandAnnouncements", { title: clean(data.title).slice(0, 140), body: clean(data.body).slice(0, 5000), audience, departmentId: audience === "department" ? departmentId() : null, priority: clean(data.priority) || "normal", pinned: data.pinned === "on", publishedAt: g2.Fire.serverTimestamp(), expiresAt: timestampFromInput(data.expiresAt), createdByUid: g2.authUser.uid }, { action: "COMMAND_ANNOUNCEMENT_PUBLISHED", summary: `Published announcement ${clean(data.title).slice(0, 140)}.` }); toast("Announcement published."); await announcementsPage(); }
    catch (error) { console.error(error); showNotice(message, "The announcement could not be published.", "error"); }
    finally { setBusy(button, false, "Publishing…", "Publish Announcement"); }
  });
}

async function documentsPage() {
  setTitle("Documents");
  const items = await companyVisible("commandDocuments");
  const mayCreate = owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="documents">${pageHeader("Knowledge and policy", "Documents.", "A link-based internal library for policies, guides, forms, and department resources—no duplicate file storage required.", mayCreate ? `<button class="button button-dark" id="new-document" type="button">Add Document</button>` : "")}<div id="document-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(item.title)}</strong><span>${safe(item.description || "")}</span><span>${safe(titleCase(item.category))} · ${safe(item.visibility === "company" ? "Company" : getDepartment(item.departmentId).shortName)}</span></div><div class="g2-list-meta">Added by<br>${safe(personName(item.createdByUid))}</div><div>${badge(item.visibility)}</div><div class="g2-list-actions"><a class="button button-small button-dark" href="${safe(item.url)}" target="_blank" rel="noopener">Open ↗</a></div></article>`).join("")}</div>` : emptyState("DC", "No documents yet", "Add the first policy, form, guide, or resource link.")}</section></div>`;
  root.querySelector("#new-document")?.addEventListener("click", renderDocumentForm);
}

function renderDocumentForm() {
  const wrap = root.querySelector("#document-form-wrap"); if (!wrap) return; wrap.hidden = false; const companyAllowed = owner() || can(PERMISSIONS.SYSTEM_MANAGE);
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Resource library</p><h2>Add document link</h2></div><button class="button button-small" id="close-document" type="button">Close</button></header><div id="document-message" class="notice" hidden></div><form id="document-form" class="form-stack"><div class="form-row"><label>Category<select name="category"><option value="policy">Policy</option><option value="procedure">Procedure</option><option value="form">Form</option><option value="guide">Guide</option><option value="training">Training</option><option value="reference">Reference</option></select></label><label>Visibility<select name="visibility">${companyAllowed ? `<option value="company">Company</option>` : ""}<option value="department">My department</option></select></label></div><label>Title<input name="title" maxlength="140" required></label><label>Description<textarea name="description" maxlength="1200" rows="3"></textarea></label><label>Secure document URL<input name="url" type="url" placeholder="https://..." required></label><button class="button button-dark" type="submit">Add to Library</button></form></section>`;
  wrap.querySelector("#close-document")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#document-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#document-message"); const button = form.querySelector("button[type=submit]"); const url = validHttpsUrl(data.url); if (!url) return showNotice(message, "Use a valid HTTPS document link.", "error"); const visibility = data.visibility === "company" && companyAllowed ? "company" : clean(data.visibility); try { setBusy(button, true, "Adding…", "Add to Library"); await createRecord("commandDocuments", { title: clean(data.title).slice(0, 140), description: clean(data.description).slice(0, 1200), url, category: clean(data.category), visibility, departmentId: visibility === "company" ? null : departmentId(), createdByUid: g2.authUser.uid }, { action: "COMMAND_DOCUMENT_ADDED", summary: `Added document ${clean(data.title).slice(0, 140)}.` }); toast("Document added."); await documentsPage(); } catch (error) { console.error(error); showNotice(message, "The document link could not be added.", "error"); } finally { setBusy(button, false, "Adding…", "Add to Library"); } });
}

async function projectsPage() {
  setTitle("Projects");
  const items = await companyVisible("commandProjects");
  const mayCreate = owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="projects">${pageHeader("Execution", "Projects.", "Track substantial Cognitus initiatives with a lead, department, due date, and current state.", mayCreate ? `<button class="button button-dark" id="new-project" type="button">New Project</button>` : "")}<div id="project-form-wrap" hidden></div><section class="department-grid">${items.length ? items.map((item) => `<article class="department-card" style="cursor:default"><div class="department-card-top"><span class="department-code">${safe(getDepartment(item.departmentId).code || "CO")}</span>${badge(item.status)}</div><h3>${safe(item.title)}</h3><p>${safe(item.description || "")}</p><span class="department-chief">Lead: ${safe(personName(item.leadUid))} · Due ${safe(formatDate(item.dueAt))}</span>${(item.leadUid === g2.authUser.uid || canLeadDepartment(item.departmentId) || owner()) && item.status !== "complete" ? `<div class="g2-card-actions" style="margin-top:14px"><button class="button button-small" data-project-status="active" data-project-id="${safe(item.id)}">Active</button><button class="button button-small" data-project-status="on_hold" data-project-id="${safe(item.id)}">Hold</button><button class="button button-small button-dark" data-project-status="complete" data-project-id="${safe(item.id)}">Complete</button></div>` : ""}</article>`).join("") : emptyState("PJ", "No projects yet", "Create the first Command project to organize larger initiatives.")}</section></div>`;
  root.querySelector("#new-project")?.addEventListener("click", renderProjectForm);
  root.querySelectorAll("[data-project-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandProjects", button.dataset.projectId, { status: button.dataset.projectStatus }, { action: "COMMAND_PROJECT_STATUS", summary: `Project moved to ${button.dataset.projectStatus}.` }); toast("Project updated."); await projectsPage(); } catch (error) { console.error(error); toast("Project update was not permitted."); } }));
}

function renderProjectForm() {
  const wrap = root.querySelector("#project-form-wrap"); if (!wrap) return; wrap.hidden = false; const companyAllowed = owner() || can(PERMISSIONS.SYSTEM_MANAGE);
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Project control</p><h2>Create project</h2></div><button class="button button-small" id="close-project" type="button">Close</button></header><div id="project-message" class="notice" hidden></div><form id="project-form" class="form-stack"><label>Project title<input name="title" maxlength="140" required></label><label>Description<textarea name="description" maxlength="2500" rows="5"></textarea></label><div class="form-row"><label>Lead<select name="leadUid">${staffOptions({ department: departmentId(), selected: g2.authUser.uid })}</select></label><label>Due date<input name="dueAt" type="datetime-local"></label></div><label>Visibility<select name="visibility">${companyAllowed ? `<option value="company">Company</option>` : ""}<option value="department">My department</option></select></label><button class="button button-dark" type="submit">Create Project</button></form></section>`;
  wrap.querySelector("#close-project")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#project-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#project-message"); const button = form.querySelector("button[type=submit]"); const visibility = data.visibility === "company" && companyAllowed ? "company" : "department"; try { setBusy(button, true, "Creating…", "Create Project"); await createRecord("commandProjects", { title: clean(data.title).slice(0, 140), description: clean(data.description).slice(0, 2500), status: "planning", visibility, departmentId: departmentId(), leadUid: clean(data.leadUid) || g2.authUser.uid, memberUids: [clean(data.leadUid) || g2.authUser.uid], dueAt: timestampFromInput(data.dueAt), createdByUid: g2.authUser.uid }, { action: "COMMAND_PROJECT_CREATED", summary: `Created project ${clean(data.title).slice(0, 140)}.` }); await notify(clean(data.leadUid), "project", "Project leadership assigned", clean(data.title), "#/projects"); toast("Project created."); await projectsPage(); } catch (error) { console.error(error); showNotice(message, "The project could not be created.", "error"); } finally { setBusy(button, false, "Creating…", "Create Project"); } });
}

async function meetingsPage() {
  setTitle("Meetings");
  const items = newestFirst(await companyVisible("commandMeetings"), "startsAt").reverse();
  const mayCreate = owner() || can(PERMISSIONS.SYSTEM_MANAGE) || can(PERMISSIONS.DEPARTMENT_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="meetings">${pageHeader("Calendar", "Meetings.", "A lightweight Command schedule for company and department meetings, agendas, and meeting links.", mayCreate ? `<button class="button button-dark" id="new-meeting" type="button">Schedule Meeting</button>` : "")}<div id="meeting-form-wrap" hidden></div><section class="panel"><div class="panel-body">${items.length ? `<div class="g2-timeline">${items.map((item) => `<article class="g2-timeline-item"><div class="g2-timeline-time">${safe(formatTimestamp(item.startsAt))}</div><div class="g2-timeline-line"><span class="g2-timeline-dot"></span></div><div class="g2-timeline-copy"><strong>${safe(item.title)}</strong><span>${safe(item.summary || "")}</span><span>${safe(item.location || "Online / TBA")} · ${safe(item.visibility === "company" ? "Company" : getDepartment(item.departmentId).name)}${item.url ? ` · <a class="g2-record-link" href="${safe(item.url)}" target="_blank" rel="noopener">Open meeting ↗</a>` : ""}</span></div></article>`).join("")}</div>` : emptyState("MT", "No meetings scheduled", "Command meetings you can see will appear here.")}</div></section></div>`;
  root.querySelector("#new-meeting")?.addEventListener("click", renderMeetingForm);
}

function renderMeetingForm() {
  const wrap = root.querySelector("#meeting-form-wrap"); if (!wrap) return; wrap.hidden = false; const companyAllowed = owner() || can(PERMISSIONS.SYSTEM_MANAGE);
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Schedule</p><h2>New meeting</h2></div><button class="button button-small" id="close-meeting" type="button">Close</button></header><div id="meeting-message" class="notice" hidden></div><form id="meeting-form" class="form-stack"><label>Meeting title<input name="title" maxlength="140" required></label><label>Agenda / summary<textarea name="summary" maxlength="2000" rows="4"></textarea></label><div class="form-row"><label>Starts<input name="startsAt" type="datetime-local" required></label><label>Ends<input name="endsAt" type="datetime-local" required></label></div><div class="form-row"><label>Location<input name="location" maxlength="160" placeholder="Discord, Zoom, office, etc."></label><label>Meeting URL<input name="url" type="url" placeholder="https://..."></label></div><label>Visibility<select name="visibility">${companyAllowed ? `<option value="company">Company</option>` : ""}<option value="department">My department</option></select></label><button class="button button-dark" type="submit">Schedule Meeting</button></form></section>`;
  wrap.querySelector("#close-meeting")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#meeting-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#meeting-message"); const button = form.querySelector("button[type=submit]"); const startsAt = timestampFromInput(data.startsAt); const endsAt = timestampFromInput(data.endsAt); const url = clean(data.url) ? validHttpsUrl(data.url) : ""; if (!startsAt || !endsAt || endsAt.toMillis() <= startsAt.toMillis()) return showNotice(message, "Choose a valid start and end time.", "error"); if (clean(data.url) && !url) return showNotice(message, "Meeting links must use HTTPS.", "error"); const visibility = data.visibility === "company" && companyAllowed ? "company" : clean(data.visibility); try { setBusy(button, true, "Scheduling…", "Schedule Meeting"); await createRecord("commandMeetings", { title: clean(data.title).slice(0, 140), summary: clean(data.summary).slice(0, 2000), startsAt, endsAt, location: clean(data.location).slice(0, 160), url: url || null, visibility, departmentId: visibility === "company" ? null : departmentId(), organizerUid: g2.authUser.uid }, { action: "COMMAND_MEETING_CREATED", summary: `Scheduled ${clean(data.title).slice(0, 140)}.` }); toast("Meeting scheduled."); await meetingsPage(); } catch (error) { console.error(error); showNotice(message, "The meeting could not be scheduled.", "error"); } finally { setBusy(button, false, "Scheduling…", "Schedule Meeting"); } });
}

async function leaveData() {
  if (owner() || can(PERMISSIONS.HR_RECORDS_READ) || can(PERMISSIONS.HR_RECORDS_MANAGE)) return newestFirst(await readCollection("commandLeave").catch(() => []));
  return newestFirst(await readQuery("commandLeave", [g2.Fire.where("requestorUid", "==", g2.authUser.uid)]).catch(() => []));
}

async function leavePage() {
  setTitle("Leave");
  const items = await leaveData();
  const hr = owner() || can(PERMISSIONS.HR_RECORDS_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="leave">${pageHeader("People operations", "Leave.", "Submit time-away requests and, for authorized HR leadership, review company leave requests.", `<button class="button button-dark" id="new-leave" type="button">Request Leave</button>`)}<div id="leave-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(personName(item.requestorUid))} · ${safe(titleCase(item.type))}</strong><span>${safe(item.reason || "No reason provided.")}</span><span>${safe(formatDate(item.startsAt))} → ${safe(formatDate(item.endsAt))}</span></div><div class="g2-list-meta">Submitted<br>${safe(formatTimestamp(item.createdAt))}</div><div>${badge(item.status)}</div><div class="g2-list-actions">${hr && item.status === "pending" && item.requestorUid !== g2.authUser.uid ? `<button class="button button-small" data-leave-action="approved" data-leave-id="${safe(item.id)}" data-leave-person="${safe(item.requestorUid)}">Approve</button><button class="button button-small" data-leave-action="declined" data-leave-id="${safe(item.id)}" data-leave-person="${safe(item.requestorUid)}">Decline</button>` : ""}</div></article>`).join("")}</div>` : emptyState("LV", "No leave requests", "Your submitted requests will appear here.")}</section></div>`;
  root.querySelector("#new-leave")?.addEventListener("click", renderLeaveForm);
  root.querySelectorAll("[data-leave-action]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandLeave", button.dataset.leaveId, { status: button.dataset.leaveAction, reviewerUid: g2.authUser.uid, reviewedAt: g2.Fire.serverTimestamp() }, { action: "COMMAND_LEAVE_REVIEWED", summary: `Leave request ${button.dataset.leaveAction}.` }); await notify(button.dataset.leavePerson, "leave", "Leave request updated", `Your leave request was ${button.dataset.leaveAction}.`, "#/leave"); toast(`Leave ${titleCase(button.dataset.leaveAction)}.`); await leavePage(); } catch (error) { console.error(error); toast("Leave update was not permitted."); } }));
}

function renderLeaveForm() {
  const wrap = root.querySelector("#leave-form-wrap"); if (!wrap) return; wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Time away</p><h2>Request leave</h2></div><button class="button button-small" id="close-leave" type="button">Close</button></header><div id="leave-message" class="notice" hidden></div><form id="leave-form" class="form-stack"><div class="form-row"><label>Type<select name="type"><option value="personal">Personal</option><option value="vacation">Vacation</option><option value="medical">Medical</option><option value="school">School / academic</option><option value="other">Other</option></select></label><span></span></div><div class="form-row"><label>Starts<input name="startsAt" type="date" required></label><label>Ends<input name="endsAt" type="date" required></label></div><label>Reason / note<textarea name="reason" maxlength="1500" rows="4"></textarea></label><button class="button button-dark" type="submit">Submit Leave Request</button></form></section>`;
  wrap.querySelector("#close-leave")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#leave-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#leave-message"); const button = form.querySelector("button[type=submit]"); const startsAt = timestampFromInput(`${data.startsAt}T00:00`); const endsAt = timestampFromInput(`${data.endsAt}T23:59`); if (!startsAt || !endsAt || endsAt.toMillis() < startsAt.toMillis()) return showNotice(message, "Choose a valid leave date range.", "error"); try { setBusy(button, true, "Submitting…", "Submit Leave Request"); await createRecord("commandLeave", { requestorUid: g2.authUser.uid, employeeId: g2.directorySelf?.employeeId || g2.staffAccess?.employeeId || "", type: clean(data.type), startsAt, endsAt, reason: clean(data.reason).slice(0, 1500), status: "pending", reviewerUid: null, reviewedAt: null, reviewNote: "" }, { action: "COMMAND_LEAVE_CREATED", summary: "Submitted a leave request." }); toast("Leave request submitted."); await leavePage(); } catch (error) { console.error(error); showNotice(message, "The leave request could not be submitted.", "error"); } finally { setBusy(button, false, "Submitting…", "Submit Leave Request"); } });
}

async function lifecyclePage() {
  setTitle("Employee Lifecycle");
  if (!(owner() || can(PERMISSIONS.HR_RECORDS_READ) || can(PERMISSIONS.HR_RECORDS_MANAGE))) return forbidden("Employee Lifecycle");
  const items = newestFirst(await readCollection("commandLifecycle").catch(() => []));
  const mayManage = owner() || can(PERMISSIONS.HR_RECORDS_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="lifecycle">${pageHeader("Human Resources", "Employee lifecycle.", "A controlled HR queue for onboarding, transfers, promotions, status changes, and offboarding.", mayManage ? `<button class="button button-dark" id="new-lifecycle" type="button">New HR Action</button>` : "")}<div id="lifecycle-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(personName(item.employeeUid))} · ${safe(titleCase(item.action))}</strong><span>${safe(item.title)}</span><span>${safe(item.notes || "")}</span></div><div class="g2-list-meta">${safe(item.completedSteps?.length || 0)}/${safe(item.checklist?.length || 0)} steps<br>${safe(formatTimestamp(item.createdAt))}</div><div>${badge(item.status)}</div><div class="g2-list-actions">${mayManage && item.status !== "complete" ? `<button class="button button-small button-dark" data-lifecycle-complete="${safe(item.id)}">Complete</button>` : ""}</div></article>`).join("")}</div>` : emptyState("HR", "No active lifecycle records", "Onboarding and offboarding work will appear here.")}</section></div>`;
  root.querySelector("#new-lifecycle")?.addEventListener("click", renderLifecycleForm);
  root.querySelectorAll("[data-lifecycle-complete]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandLifecycle", button.dataset.lifecycleComplete, { status: "complete", completedAt: g2.Fire.serverTimestamp() }, { action: "COMMAND_LIFECYCLE_COMPLETED", summary: "Completed employee lifecycle action." }); toast("HR action completed."); await lifecyclePage(); } catch (error) { console.error(error); toast("Lifecycle update was not permitted."); } }));
}

function renderLifecycleForm() {
  const wrap = root.querySelector("#lifecycle-form-wrap"); if (!wrap) return; wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">HR action</p><h2>Open lifecycle record</h2></div><button class="button button-small" id="close-lifecycle" type="button">Close</button></header><div id="lifecycle-message" class="notice" hidden></div><form id="lifecycle-form" class="form-stack"><div class="form-row"><label>Employee<select name="employeeUid">${staffOptions({ selected: g2.authUser.uid })}</select></label><label>Action<select name="action"><option value="onboarding">Onboarding</option><option value="transfer">Transfer</option><option value="promotion">Promotion</option><option value="status_change">Status change</option><option value="offboarding">Offboarding</option></select></label></div><label>Title<input name="title" maxlength="140" required></label><label>Notes<textarea name="notes" maxlength="3000" rows="5"></textarea></label><label>Checklist items <span class="help-text">One item per line</span><textarea name="checklist" maxlength="2000" rows="5" placeholder="Confirm access\nReview policies\nDepartment orientation"></textarea></label><button class="button button-dark" type="submit">Create HR Action</button></form></section>`;
  wrap.querySelector("#close-lifecycle")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#lifecycle-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#lifecycle-message"); const button = form.querySelector("button[type=submit]"); const checklist = clean(data.checklist).split(/\r?\n/).map(clean).filter(Boolean).slice(0, 30); try { setBusy(button, true, "Creating…", "Create HR Action"); await createRecord("commandLifecycle", { employeeUid: clean(data.employeeUid), action: clean(data.action), title: clean(data.title).slice(0, 140), notes: clean(data.notes).slice(0, 3000), checklist, completedSteps: [], status: "open", openedByUid: g2.authUser.uid, completedAt: null }, { action: "COMMAND_LIFECYCLE_CREATED", summary: `Opened ${clean(data.action)} lifecycle record.` }); await notify(clean(data.employeeUid), "hr", "HR process opened", clean(data.title), "#/profile"); toast("HR action created."); await lifecyclePage(); } catch (error) { console.error(error); showNotice(message, "The HR action could not be created.", "error"); } finally { setBusy(button, false, "Creating…", "Create HR Action"); } });
}

async function financePage() {
  setTitle("Finance");
  if (!(owner() || can(PERMISSIONS.FINANCE_READ) || can(PERMISSIONS.FINANCE_MANAGE))) return forbidden("Finance");
  const items = newestFirst(await readCollection("commandFinance").catch(() => []), "occurredAt");
  const mayManage = owner() || can(PERMISSIONS.FINANCE_MANAGE);
  const approved = items.filter((item) => item.status === "approved" || item.status === "posted");
  const income = approved.filter((item) => item.entryType === "income").reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  const outflow = approved.filter((item) => item.entryType !== "income").reduce((sum, item) => sum + Number(item.amountCents || 0), 0);
  root.innerHTML = `<div class="page-inner" data-g2-page="finance">${pageHeader("Finance", "Finance.", "An internal operational ledger for Cognitus income, expenses, reimbursements, and approvals.", mayManage ? `<button class="button button-dark" id="new-finance" type="button">New Entry</button>` : "")}<section class="stats-grid"><article class="stat-card"><span>Approved Income</span><strong class="g2-money" style="font-size:22px">${safe(formatMoney(income))}</strong><small>Visible posted / approved entries</small></article><article class="stat-card"><span>Approved Outflow</span><strong class="g2-money" style="font-size:22px">${safe(formatMoney(outflow))}</strong><small>Expenses and reimbursements</small></article><article class="stat-card"><span>Net</span><strong class="g2-money" style="font-size:22px">${safe(formatMoney(income - outflow))}</strong><small>Current visible ledger balance</small></article><article class="stat-card"><span>Pending</span><strong>${items.filter((item) => item.status === "pending").length}</strong><small>Entries awaiting disposition</small></article></section><div id="finance-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(item.memo)}</strong><span>${safe(titleCase(item.entryType))} · ${safe(item.category)}</span><span>${safe(getDepartment(item.departmentId).shortName)}</span></div><div class="g2-list-meta g2-money"><strong>${safe(formatMoney(item.amountCents))}</strong><br>${safe(formatDate(item.occurredAt))}</div><div>${badge(item.status)}</div><div class="g2-list-actions">${mayManage && item.status === "pending" ? `<button class="button button-small" data-finance-status="approved" data-finance-id="${safe(item.id)}">Approve</button><button class="button button-small" data-finance-status="declined" data-finance-id="${safe(item.id)}">Decline</button>` : ""}</div></article>`).join("")}</div>` : emptyState("FN", "No finance entries", "Finance records will appear here as they are entered.")}</section></div>`;
  root.querySelector("#new-finance")?.addEventListener("click", renderFinanceForm);
  root.querySelectorAll("[data-finance-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandFinance", button.dataset.financeId, { status: button.dataset.financeStatus, approvedByUid: g2.authUser.uid, approvedAt: g2.Fire.serverTimestamp() }, { action: "COMMAND_FINANCE_REVIEWED", summary: `Finance entry ${button.dataset.financeStatus}.` }); toast("Finance entry updated."); await financePage(); } catch (error) { console.error(error); toast("Finance update was not permitted."); } }));
}

function renderFinanceForm() {
  const wrap = root.querySelector("#finance-form-wrap"); if (!wrap) return; wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Ledger</p><h2>New finance entry</h2></div><button class="button button-small" id="close-finance" type="button">Close</button></header><div id="finance-message" class="notice" hidden></div><form id="finance-form" class="form-stack"><div class="form-row"><label>Entry type<select name="entryType"><option value="expense">Expense</option><option value="income">Income</option><option value="reimbursement">Reimbursement</option><option value="purchase">Purchase</option></select></label><label>Amount<input name="amount" inputmode="decimal" placeholder="0.00" required></label></div><div class="form-row"><label>Category<input name="category" maxlength="80" required></label><label>Department<select name="departmentId">${departmentOptions(departmentId())}</select></label></div><label>Memo<input name="memo" maxlength="180" required></label><label>Date<input name="occurredAt" type="date" required></label><button class="button button-dark" type="submit">Create Finance Entry</button></form></section>`;
  wrap.querySelector("#close-finance")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#finance-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#finance-message"); const button = form.querySelector("button[type=submit]"); const amountCents = toCents(data.amount); if (amountCents <= 0) return showNotice(message, "Enter an amount greater than zero.", "error"); try { setBusy(button, true, "Creating…", "Create Finance Entry"); await createRecord("commandFinance", { entryType: clean(data.entryType), amountCents, category: clean(data.category).slice(0, 80), memo: clean(data.memo).slice(0, 180), departmentId: clean(data.departmentId), status: owner() || can(PERMISSIONS.FINANCE_MANAGE) ? "approved" : "pending", submittedByUid: g2.authUser.uid, approvedByUid: owner() || can(PERMISSIONS.FINANCE_MANAGE) ? g2.authUser.uid : null, approvedAt: owner() || can(PERMISSIONS.FINANCE_MANAGE) ? g2.Fire.serverTimestamp() : null, occurredAt: timestampFromInput(`${data.occurredAt}T12:00`) }, { action: "COMMAND_FINANCE_CREATED", summary: `Created ${clean(data.entryType)} finance entry.` }); toast("Finance entry created."); await financePage(); } catch (error) { console.error(error); showNotice(message, "The finance entry could not be created.", "error"); } finally { setBusy(button, false, "Creating…", "Create Finance Entry"); } });
}

async function payrollData() {
  const mine = await readQuery("commandPayroll", [g2.Fire.where("employeeUid", "==", g2.authUser.uid)]).catch(() => []);
  if (owner() || can(PERMISSIONS.PAYROLL_READ) || can(PERMISSIONS.PAYROLL_MANAGE)) return newestFirst(await readCollection("commandPayroll").catch(() => mine), "periodEnd");
  return newestFirst(mine, "periodEnd");
}

async function payrollPage() {
  setTitle("Payroll");
  const items = await payrollData();
  const mayManage = owner() || can(PERMISSIONS.PAYROLL_MANAGE);
  root.innerHTML = `<div class="page-inner" data-g2-page="payroll">${pageHeader("Compensation", "Payroll.", mayManage ? "Prepare and track internal payroll statements. Employees only see their own statements unless granted payroll authority." : "Your Cognitus payroll statements appear here when they are published.", mayManage ? `<button class="button button-dark" id="new-payroll" type="button">New Statement</button>` : "")}<div id="payroll-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(personName(item.employeeUid))} · ${safe(item.periodLabel)}</strong><span>${safe(formatDate(item.periodStart))} → ${safe(formatDate(item.periodEnd))}</span><span>${safe(item.notes || "")}</span></div><div class="g2-list-meta g2-money">Gross ${safe(formatMoney(item.grossCents))}<br>Net <strong>${safe(formatMoney(item.netCents))}</strong></div><div>${badge(item.status)}</div><div class="g2-list-actions">${mayManage && item.status === "draft" ? `<button class="button button-small" data-payroll-status="approved" data-payroll-id="${safe(item.id)}">Approve</button>` : ""}${mayManage && item.status === "approved" ? `<button class="button button-small button-dark" data-payroll-status="paid" data-payroll-id="${safe(item.id)}">Mark Paid</button>` : ""}</div></article>`).join("")}</div>` : emptyState("PY", "No payroll statements", mayManage ? "Create the first payroll statement." : "Statements published for your account will appear here.")}</section></div>`;
  root.querySelector("#new-payroll")?.addEventListener("click", renderPayrollForm);
  root.querySelectorAll("[data-payroll-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandPayroll", button.dataset.payrollId, { status: button.dataset.payrollStatus, approvedByUid: g2.authUser.uid, paidAt: button.dataset.payrollStatus === "paid" ? g2.Fire.serverTimestamp() : null }, { action: "COMMAND_PAYROLL_STATUS", summary: `Payroll statement ${button.dataset.payrollStatus}.` }); toast("Payroll statement updated."); await payrollPage(); } catch (error) { console.error(error); toast("Payroll update was not permitted."); } }));
}

function renderPayrollForm() {
  const wrap = root.querySelector("#payroll-form-wrap"); if (!wrap) return; wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Payroll</p><h2>New statement</h2></div><button class="button button-small" id="close-payroll" type="button">Close</button></header><div id="payroll-message" class="notice" hidden></div><form id="payroll-form" class="form-stack"><label>Employee<select name="employeeUid">${staffOptions({ selected: g2.authUser.uid })}</select></label><div class="form-row"><label>Period label<input name="periodLabel" maxlength="80" placeholder="September 1–15, 2026" required></label><label>Gross pay<input name="gross" inputmode="decimal" placeholder="0.00" required></label></div><div class="form-row"><label>Period start<input name="periodStart" type="date" required></label><label>Period end<input name="periodEnd" type="date" required></label></div><div class="form-row"><label>Adjustments (+/-)<input name="adjustments" inputmode="decimal" value="0.00"></label><label>Net pay<input name="net" inputmode="decimal" placeholder="0.00" required></label></div><label>Notes<textarea name="notes" maxlength="1500" rows="3"></textarea></label><button class="button button-dark" type="submit">Create Draft Statement</button></form></section>`;
  wrap.querySelector("#close-payroll")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#payroll-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#payroll-message"); const button = form.querySelector("button[type=submit]"); const grossCents = toCents(data.gross); const adjustmentsCents = Math.round(Number(String(data.adjustments || "0").replace(/[$,]/g, "")) * 100) || 0; const netCents = toCents(data.net); if (grossCents < 0 || netCents < 0) return showNotice(message, "Payroll amounts cannot be negative.", "error"); try { setBusy(button, true, "Creating…", "Create Draft Statement"); await createRecord("commandPayroll", { employeeUid: clean(data.employeeUid), periodLabel: clean(data.periodLabel).slice(0, 80), periodStart: timestampFromInput(`${data.periodStart}T00:00`), periodEnd: timestampFromInput(`${data.periodEnd}T23:59`), grossCents, adjustmentsCents, netCents, status: "draft", notes: clean(data.notes).slice(0, 1500), createdByUid: g2.authUser.uid, approvedByUid: null, paidAt: null }, { action: "COMMAND_PAYROLL_CREATED", summary: `Created payroll statement for ${personName(clean(data.employeeUid))}.` }); toast("Payroll draft created."); await payrollPage(); } catch (error) { console.error(error); showNotice(message, "The payroll statement could not be created.", "error"); } finally { setBusy(button, false, "Creating…", "Create Draft Statement"); } });
}

async function ticketsData() {
  if (owner() || can(PERMISSIONS.TICKETS_ALL_READ)) return newestFirst(await readCollection("commandTickets").catch(() => []));
  const mine = await readQuery("commandTickets", [g2.Fire.where("requesterUid", "==", g2.authUser.uid)]).catch(() => []);
  const department = can(PERMISSIONS.TICKETS_MANAGE) ? await readQuery("commandTickets", [g2.Fire.where("departmentId", "==", departmentId())]).catch(() => []) : [];
  return newestFirst(mergeUnique(mine, department));
}

async function ticketsPage() {
  setTitle("Service Desk");
  const items = await ticketsData();
  root.innerHTML = `<div class="page-inner" data-g2-page="tickets">${pageHeader("Internal service desk", "Tickets.", "Report issues, request technical or operational help, and track internal support work without leaving Command.", `<button class="button button-dark" id="new-ticket" type="button">Open Ticket</button>`)}<div id="ticket-form-wrap" hidden></div><section class="panel">${items.length ? `<div class="g2-list">${items.map((item) => `<article class="g2-list-item"><div class="g2-list-copy"><strong>${safe(item.subject)}</strong><span>${safe(item.details)}</span><span>${safe(personName(item.requesterUid))} → ${safe(getDepartment(item.departmentId).shortName)}</span></div><div class="g2-list-meta">${safe(titleCase(item.category))}<br>${safe(formatTimestamp(item.createdAt))}</div><div>${badge(item.status)}</div><div class="g2-list-actions">${canManageTickets(item.departmentId) && item.status === "open" ? `<button class="button button-small" data-ticket-status="in_progress" data-ticket-id="${safe(item.id)}" data-ticket-person="${safe(item.requesterUid)}">Claim</button>` : ""}${canManageTickets(item.departmentId) && item.status !== "resolved" ? `<button class="button button-small button-dark" data-ticket-status="resolved" data-ticket-id="${safe(item.id)}" data-ticket-person="${safe(item.requesterUid)}">Resolve</button>` : ""}</div></article>`).join("")}</div>` : emptyState("TS", "No tickets", "Open a ticket whenever you need internal Cognitus assistance.")}</section></div>`;
  root.querySelector("#new-ticket")?.addEventListener("click", renderTicketForm);
  root.querySelectorAll("[data-ticket-status]").forEach((button) => button.addEventListener("click", async () => { try { await updateRecord("commandTickets", button.dataset.ticketId, { status: button.dataset.ticketStatus, assignedToUid: g2.authUser.uid, resolvedAt: button.dataset.ticketStatus === "resolved" ? g2.Fire.serverTimestamp() : null }, { action: "COMMAND_TICKET_STATUS", summary: `Internal ticket moved to ${button.dataset.ticketStatus}.` }); await notify(button.dataset.ticketPerson, "ticket", "Service Desk update", `Your ticket is now ${titleCase(button.dataset.ticketStatus)}.`, "#/tickets"); toast("Ticket updated."); await ticketsPage(); } catch (error) { console.error(error); toast("Ticket update was not permitted."); } }));
}

function renderTicketForm() {
  const wrap = root.querySelector("#ticket-form-wrap"); if (!wrap) return; wrap.hidden = false;
  wrap.innerHTML = `<section class="form-card" style="margin-bottom:18px"><header class="panel-header"><div><p class="eyebrow">Service desk</p><h2>Open ticket</h2></div><button class="button button-small" id="close-ticket" type="button">Close</button></header><div id="ticket-message" class="notice" hidden></div><form id="ticket-form" class="form-stack"><div class="form-row"><label>Category<select name="category"><option value="general">General</option><option value="access">Access</option><option value="technical">Technical</option><option value="hr">HR</option><option value="finance">Finance</option><option value="policy">Policy</option></select></label><label>Destination<select name="departmentId">${departmentOptions("customer-service")}</select></label></div><div class="form-row"><label>Priority<select name="priority"><option value="normal">Normal</option><option value="low">Low</option><option value="high">High</option><option value="critical">Critical</option></select></label><span></span></div><label>Subject<input name="subject" maxlength="140" required></label><label>Details<textarea name="details" maxlength="3000" rows="6" required></textarea></label><button class="button button-dark" type="submit">Open Ticket</button></form></section>`;
  wrap.querySelector("#close-ticket")?.addEventListener("click", () => { wrap.hidden = true; wrap.innerHTML = ""; });
  wrap.querySelector("#ticket-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = formObject(form); const message = wrap.querySelector("#ticket-message"); const button = form.querySelector("button[type=submit]"); try { setBusy(button, true, "Opening…", "Open Ticket"); await createRecord("commandTickets", { requesterUid: g2.authUser.uid, departmentId: clean(data.departmentId), category: clean(data.category), priority: clean(data.priority), subject: clean(data.subject).slice(0, 140), details: clean(data.details).slice(0, 3000), status: "open", assignedToUid: null, resolvedAt: null }, { action: "COMMAND_TICKET_CREATED", summary: `Opened internal ticket ${clean(data.subject).slice(0, 140)}.` }); toast("Ticket opened."); await ticketsPage(); } catch (error) { console.error(error); showNotice(message, "The ticket could not be opened.", "error"); } finally { setBusy(button, false, "Opening…", "Open Ticket"); } });
}

function forbidden(area) {
  root.innerHTML = `<div class="page-inner" data-g2-page="forbidden">${emptyState("!", "Permission required", `Your active Cognitus staff account does not have access to ${area}.`, `<a class="button" href="#/dashboard">Return to Dashboard</a>`)}</div>`;
}

async function renderRoute() {
  const current = route();
  if (!G2_ROUTES.has(current) || !activeStaff() || g2.rendering) return false;
  g2.rendering = true;
  augmentChrome();
  try {
    if (current === "/tasks") await tasksPage();
    else if (current === "/requests") await requestsPage();
    else if (current === "/projects") await projectsPage();
    else if (current === "/meetings") await meetingsPage();
    else if (current === "/announcements") await announcementsPage();
    else if (current === "/documents") await documentsPage();
    else if (current === "/tickets") await ticketsPage();
    else if (current === "/leave") await leavePage();
    else if (current === "/hr/lifecycle") await lifecyclePage();
    else if (current === "/finance") await financePage();
    else if (current === "/payroll") await payrollPage();
    root?.focus?.({ preventScroll: true });
    return true;
  } finally {
    g2.rendering = false;
  }
}

async function dashboardSnapshot() {
  if (g2.dashboardLoading || route() !== "/dashboard" || !activeStaff() || root.querySelector(".g2-dashboard")) return;
  g2.dashboardLoading = true;
  try {
    const [tasks, requests, announcements] = await Promise.all([tasksData(), requestsData(), announcementsData()]);
    if (route() !== "/dashboard" || root.querySelector(".g2-dashboard")) return;
    const host = root.querySelector(".page-inner");
    const hero = host?.querySelector(".hero-card");
    if (!host || !hero) return;
    const section = document.createElement("section");
    section.className = "panel g2-dashboard";
    section.innerHTML = `<header class="panel-header"><div><p class="eyebrow">Command · Generation 2</p><h2>Operations snapshot</h2></div><span class="badge active">Live</span></header><div class="panel-body"><div class="g2-mini-grid"><a class="g2-mini" href="#/tasks" style="text-decoration:none;color:inherit"><span>Open Tasks</span><strong>${tasks.filter((item) => !["done", "cancelled"].includes(item.status)).length}</strong></a><a class="g2-mini" href="#/requests" style="text-decoration:none;color:inherit"><span>Pending Requests</span><strong>${requests.filter((item) => item.status === "pending").length}</strong></a><a class="g2-mini" href="#/announcements" style="text-decoration:none;color:inherit"><span>Current Notices</span><strong>${announcements.length}</strong></a></div></div>`;
    hero.insertAdjacentElement("afterend", section);
  } catch (error) {
    console.warn("Generation 2 dashboard snapshot unavailable", error);
  } finally { g2.dashboardLoading = false; }
}

function appendCommandPages() {
  if (!activeStaff() || commandOverlay?.hidden || !commandResults) return;
  commandResults.querySelectorAll("[data-g2-command]").forEach((node) => node.remove());
  commandResults.querySelectorAll(".g2-command-label").forEach((node) => node.remove());
  const query = lower(commandInput?.value || "");
  const allowed = COMMAND_PAGES.filter(([title, subtitle, href]) => {
    if (href === "#/hr/lifecycle" && !(owner() || can(PERMISSIONS.HR_RECORDS_READ) || can(PERMISSIONS.HR_RECORDS_MANAGE))) return false;
    if (href === "#/finance" && !(owner() || can(PERMISSIONS.FINANCE_READ) || can(PERMISSIONS.FINANCE_MANAGE))) return false;
    return !query || lower(`${title} ${subtitle}`).includes(query);
  });
  if (!allowed.length) return;
  const label = document.createElement("div"); label.className = "g2-command-label"; label.textContent = "Company operations"; commandResults.appendChild(label);
  allowed.slice(0, 8).forEach(([title, subtitle, href, icon]) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "command-result g2-command-result"; button.dataset.g2Command = href; button.innerHTML = `<span class="avatar">${safe(icon)}</span><span class="command-result-copy"><strong>${safe(title)}</strong><span>${safe(subtitle)}</span></span><span class="command-result-type">G2</span>`; button.addEventListener("click", () => { commandOverlay.hidden = true; location.hash = href; }); commandResults.appendChild(button);
  });
}

function scheduleRouteRender(delay = 0) {
  window.setTimeout(() => { augmentChrome(); if (G2_ROUTES.has(route())) renderRoute(); else if (route() === "/dashboard") dashboardSnapshot(); }, delay);
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
  injectStyles();
  try {
    const services = await waitForFirebase();
    ({ auth: g2.auth, db: g2.db, Auth: g2.Auth, Fire: g2.Fire } = services);
    g2.Auth.onAuthStateChanged(g2.auth, async (user) => {
      try { await refreshIdentity(user); } catch (error) { console.warn("Generation 2 identity refresh unavailable", error); }
      g2.ready = true;
      scheduleRouteRender(30);
    });
  } catch (error) {
    console.warn("Generation 2 extension did not initialize", error);
  }

  window.addEventListener("hashchange", () => scheduleRouteRender(0));
  commandInput?.addEventListener("input", debounce(() => window.setTimeout(appendCommandPages, 110), 15));
  if (commandOverlay) new MutationObserver(() => window.setTimeout(appendCommandPages, 110)).observe(commandOverlay, { attributes: true, attributeFilter: ["hidden"] });

  if (sidebar) new MutationObserver(() => { if (!sidebar.querySelector("[data-g2-nav]")) window.setTimeout(augmentChrome, 0); }).observe(sidebar, { childList: true });
  if (root) new MutationObserver(() => {
    const current = route();
    if (G2_ROUTES.has(current) && !root.querySelector("[data-g2-page]") && g2.ready) scheduleRouteRender(0);
    if (current === "/dashboard" && !root.querySelector(".g2-dashboard") && g2.ready) window.setTimeout(dashboardSnapshot, 30);
  }).observe(root, { childList: true });
}

init();
