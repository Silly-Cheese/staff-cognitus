import { firebaseState, readDoc, readCollection, readQuery } from "./firebase.js";
import { DEPARTMENTS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, hasPermission, isActiveStaff } from "./config/permissions.js";
import { clean, lower, safe, route, formatTimestamp, formatDate, titleCase, initials } from "./utils.js";

const root = document.querySelector("#page-root");
const PATH = "/operations-intelligence";
const CURRENT = new Set(["active", "training", "on_leave"]);
const CLOSED = new Set(["done", "completed", "closed", "resolved", "cancelled", "declined", "archived", "accepted", "rejected", "removed"]);
const oi = { auth: null, Auth: null, user: null, userRecord: null, access: null, ready: false, token: 0, data: null, tab: "overview" };

function owner() { return oi.userRecord?.status === "active" && oi.userRecord?.role === "owner"; }
function activeStaff() { return Boolean(oi.user && oi.userRecord?.status === "active" && isActiveStaff(oi.access)); }
function can(permission) { return owner() || hasPermission(oi.access, permission); }
function canAny(values) { return values.some(can); }
function ms(value) { try { const d = value?.toDate?.() || (value ? new Date(value) : null); return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0; } catch { return 0; } }
function name(record) { return record?.displayName || record?.recipientName || record?.title || record?.subject || record?.cognitusId || record?.id || "Untitled"; }
function status(record) { return lower(record?.status || record?.employmentStatus || "unknown"); }
function pill(value, tone = "") { return `<span class="oi-pill ${safe(tone)}">${safe(titleCase(value || "unknown"))}</span>`; }
function empty(title, body) { return `<div class="oi-empty"><strong>${safe(title)}</strong><p>${safe(body)}</p></div>`; }
function current(records) { return records.filter((entry) => CURRENT.has(entry.status)); }
function former(records) { return records.filter((entry) => entry.status === "former"); }
function byNewest(records, fields = ["updatedAt", "createdAt"]) { return [...records].sort((a,b) => Math.max(...fields.map(f=>ms(b[f]))) - Math.max(...fields.map(f=>ms(a[f])))); }

async function readable(collection, allowed = true) {
  if (!allowed) return [];
  try { return await readCollection(collection); }
  catch (error) { if (error?.code !== "permission-denied") console.warn(`Operations Intelligence: ${collection}`, error); return []; }
}
async function readableQuery(collection, constraints, allowed = true) {
  if (!allowed) return [];
  try { return await readQuery(collection, constraints); }
  catch (error) { if (error?.code !== "permission-denied") console.warn(`Operations Intelligence query: ${collection}`, error); return []; }
}

async function loadData(force = false) {
  if (oi.data && !force) return oi.data;
  const hr = owner() || canAny([PERMISSIONS.HR_RECORDS_READ, PERMISSIONS.HR_RECORDS_MANAGE, PERMISSIONS.STAFF_PRIVATE_READ, PERMISSIONS.STAFF_MANAGE]);
  const audit = owner() || can(PERMISSIONS.AUDIT_READ);
  const accounts = owner() || can(PERMISSIONS.ACCOUNTS_READ_ALL);
  const payroll = owner() || canAny([PERMISSIONS.PAYROLL_READ, PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.PAYROLL_APPROVE]);
  const [directory, access, employment, audits, discipline, appeals, tasks, requests, projects, meetings, announcements, documents, tickets, leave, payrollRows, performance, qa, inbox, users, profiles] = await Promise.all([
    readable("staffDirectory"), readable("staffAccess", hr), readable("staffEmployment", hr), readable("auditLogs", audit),
    readable("staffDiscipline", hr), readable("staffDisciplineAppeals", hr), readable("commandTasks"), readable("commandRequests"),
    readable("commandProjects"), readable("commandMeetings"), readable("commandAnnouncements"), readable("commandDocuments"),
    readable("commandTickets"), readable("commandLeave", hr), readable("commandPayroll", payroll), readable("commandPerformance", hr),
    readable("commandQaReviews", owner() || canAny([PERMISSIONS.QA_READ, PERMISSIONS.QA_MANAGE, PERMISSIONS.QA_AUDIT])),
    readableQuery("staffInbox", [firebaseState().Fire.where("recipientUid", "==", oi.user.uid)]), readable("users", accounts), readable("profiles", accounts)
  ]);
  oi.data = { directory, access, employment, audits, discipline, appeals, tasks, requests, projects, meetings, announcements, documents, tickets, leave, payroll: payrollRows, performance, qa, inbox, users, profiles };
  return oi.data;
}

function kpi(label, value, detail, tone = "") { return `<article class="oi-kpi ${safe(tone)}"><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(detail)}</small></article>`; }
function tabButton(id, label, count = "") { return `<button type="button" data-oi-tab="${safe(id)}" class="${oi.tab === id ? "active" : ""}">${safe(label)}${count !== "" ? `<span>${safe(count)}</span>` : ""}</button>`; }
function openRows(records) { return records.filter((entry) => !CLOSED.has(status(entry))); }

function overview(data) {
  const currentPeople = current(data.directory), formerPeople = former(data.directory);
  const openWork = openRows([...data.tasks, ...data.requests, ...data.tickets]);
  const pendingAppeals = data.appeals.filter(x => status(x) === "pending");
  const unread = data.inbox.filter(x => !x.readAt);
  const upcoming = data.meetings.filter(x => ms(x.startsAt || x.startAt || x.scheduledFor || x.meetingAt) >= Date.now()).sort((a,b)=>ms(a.startsAt||a.startAt||a.scheduledFor||a.meetingAt)-ms(b.startsAt||b.startAt||b.scheduledFor||b.meetingAt));
  return `<section class="oi-kpis">${kpi("Current staff", currentPeople.length, `${formerPeople.length} former staff retained`)}${kpi("Open work", openWork.length, "Tasks, requests, and tickets", openWork.length ? "attention" : "")}${kpi("Pending appeals", pendingAppeals.length, "Owner decision queue", pendingAppeals.length ? "attention" : "")}${kpi("Unread notices", unread.length, "Accessible staff notifications")}</section>
  <section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Company picture</p><h2>Staff status</h2></div></header><div class="oi-bars">${["active","training","on_leave","suspended","former"].map(s=>{const count=data.directory.filter(x=>x.status===s).length;const width=data.directory.length?Math.round(count/data.directory.length*100):0;return `<div><span>${safe(titleCase(s))}<b>${count}</b></span><i><em style="width:${width}%"></em></i></div>`}).join("")}</div></article>
  <article class="oi-card"><header><div><p class="eyebrow">Next</p><h2>Upcoming meetings</h2></div><a href="#/meetings">Calendar →</a></header>${upcoming.length?`<div class="oi-list">${upcoming.slice(0,5).map(x=>`<article><strong>${safe(name(x))}</strong><span>${safe(formatTimestamp(x.startsAt||x.startAt||x.scheduledFor||x.meetingAt))}</span><small>${safe(x.location||getDepartment(x.departmentId).shortName||"Company")}</small></article>`).join("")}</div>`:empty("Schedule clear","No upcoming accessible meetings.")}</article></section>
  <section class="oi-card"><header><div><p class="eyebrow">Quick actions</p><h2>Open a workspace</h2></div></header><div class="oi-actions"><a href="#/admin/staff">Staff Administration</a><a href="#/admin/discipline">Discipline Review</a><a href="#/executive/audit">Audit Center</a><a href="#/tasks">Tasks</a><a href="#/meetings">Meetings</a><a href="#/announcements">Announcements</a><a href="#/documents">Documents</a><a href="#/tickets">Service Desk</a></div></section>`;
}

function personRow(person, data) {
  const access = data.access.find(x => (x.uid||x.id)===(person.uid||person.id));
  const employment = data.employment.find(x => (x.uid||x.id)===(person.uid||person.id));
  const checks = [Boolean(person.employeeId), Boolean(access), Boolean(employment), Boolean(person.departmentId), Boolean(person.title)];
  const progress = Math.round(checks.filter(Boolean).length/checks.length*100);
  return `<article class="oi-person" data-oi-searchable="${safe(lower(`${person.displayName} ${person.employeeId} ${person.title} ${person.departmentId} ${person.status}`))}"><span class="oi-avatar">${safe(initials(person.displayName))}</span><div><strong>${safe(person.displayName||"Unnamed employee")}</strong><span>${safe(person.title||getRank(person.rank).label)} · ${safe(getDepartment(person.departmentId).shortName)}</span><small>${safe(person.employeeId||"No employee ID")} · Onboarding ${progress}%</small></div>${pill(person.status,person.status==="former"?"danger":"")}</article>`;
}

function people(data) {
  const active = current(data.directory), old = former(data.directory);
  const groups = DEPARTMENTS.map(dept=>({dept,people:active.filter(x=>x.departmentId===dept.id)})).filter(x=>x.people.length);
  return `<section class="oi-toolbar"><label><span>Search people</span><input data-oi-filter="people" type="search" placeholder="Name, Employee ID, title, department…"></label><button class="button" data-oi-export="directory">Export Directory CSV</button></section>
  <section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Directory</p><h2>Current staff</h2></div><span>${active.length}</span></header><div class="oi-people" data-oi-filter-target="people">${active.length?active.map(x=>personRow(x,data)).join(""):empty("No current staff","No current staff records were readable.")}</div></article>
  <article class="oi-card"><header><div><p class="eyebrow">Retained history</p><h2>Former Staff Archive</h2></div><span>${old.length}</span></header><div class="oi-people">${old.length?old.map(x=>{const e=data.employment.find(y=>(y.uid||y.id)===(x.uid||x.id));return `<article class="oi-former"><div><strong>${safe(x.displayName||"Former employee")}</strong><span>${safe(x.employeeId||"—")} · ${safe(x.title||getRank(x.rank).label)}</span></div><dl><div><dt>Terminated</dt><dd>${safe(formatTimestamp(e?.terminatedAt))}</dd></div><div><dt>Reason</dt><dd>${safe(e?.terminationReason||"Legacy record — notice not entered")}</dd></div></dl></article>`}).join(""):empty("No former staff","Former employees will be retained here for authorized review.")}</div></article></section>
  <section class="oi-card"><header><div><p class="eyebrow">Organization</p><h2>Department chart</h2></div></header><div class="oi-org-chart">${groups.map(({dept,people})=>`<section><header><strong>${safe(dept.name)}</strong><span>${people.length}</span></header>${people.sort((a,b)=>(getRank(b.rank).level||0)-(getRank(a.rank).level||0)).map(p=>`<a href="#/staff/${encodeURIComponent(p.uid||p.id)}"><b>${safe(p.displayName)}</b><small>${safe(p.title||getRank(p.rank).label)}</small></a>`).join("")}</section>`).join("")}</div></section>`;
}

function security(data) {
  const directory = new Map(data.directory.map(x=>[x.uid||x.id,x]));
  const access = new Map(data.access.map(x=>[x.uid||x.id,x]));
  const flags=[];
  data.access.forEach(a=>{const d=directory.get(a.uid||a.id);if(!d)flags.push(["Orphan access",a.employeeId||a.uid,"Access exists without a directory record"]);else if(d.status==="former")flags.push(["Former staff access",d.displayName,"Former employee still has a staffAccess record"]);else if(d.status!==a.status)flags.push(["Status mismatch",d.displayName,`${d.status} in directory / ${a.status} in access`]);});
  data.directory.forEach(d=>{if(CURRENT.has(d.status)&&!access.has(d.uid||d.id))flags.push(["Missing access",d.displayName,"Current directory employee has no staffAccess record"]);});
  const permissionCounts=new Map();data.access.forEach(a=>(a.permissions||[]).forEach(p=>permissionCounts.set(p,(permissionCounts.get(p)||0)+1)));
  const verified=data.users.filter(x=>x.identityVerified===true).length;
  return `<section class="oi-kpis">${kpi("Security flags",flags.length,"Cross-record consistency checks",flags.length?"attention":"")}${kpi("Staff access records",data.access.length,"Readable permission documents")}${kpi("Verified accounts",verified,`${data.users.length} accessible accounts`)}${kpi("Permission types",permissionCounts.size,"Explicit capabilities in use")}</section>
  <section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Owner security</p><h2>Integrity checks</h2></div></header>${flags.length?`<div class="oi-alerts">${flags.map(x=>`<article><span>!</span><div><strong>${safe(x[0])}</strong><b>${safe(x[1])}</b><p>${safe(x[2])}</p></div></article>`).join("")}</div>`:empty("No inconsistencies detected","Accessible staff records agree across the security boundary.")}</article>
  <article class="oi-card"><header><div><p class="eyebrow">Permission inspector</p><h2>Assigned capabilities</h2></div></header><div class="oi-permissions">${[...permissionCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([p,n])=>`<div><code>${safe(p)}</code><span>${n} account${n===1?"":"s"}</span></div>`).join("")||empty("No access records","You may not have permission to inspect staff access.")}</div></article></section>
  <section class="oi-card"><header><div><p class="eyebrow">Account posture</p><h2>Risk and verification</h2></div></header><div class="oi-table"><div class="oi-table-head"><span>Account</span><span>Role</span><span>Status</span><span>Verification</span></div>${data.users.slice(0,100).map(u=>`<div><span><b>${safe(u.displayName||u.discordUsername||u.cognitusId||u.id)}</b><small>${safe(u.cognitusId||u.id)}</small></span><span>${safe(titleCase(u.role||"user"))}</span><span>${pill(u.status)}</span><span>${u.identityVerified?pill("verified"):pill("unverified","muted")}</span></div>`).join("")}</div></section>`;
}

function audit(data) {
  const rows=byNewest(data.audits).slice(0,500);
  return `<section class="oi-toolbar"><label><span>Search audit activity</span><input data-oi-filter="audit" type="search" placeholder="Actor, action, target, summary…"></label><button class="button" data-oi-export="audit">Export Audit CSV</button></section><section class="oi-card"><header><div><p class="eyebrow">Immutable activity</p><h2>Audit timeline</h2></div><span>${rows.length}</span></header><div class="oi-timeline" data-oi-filter-target="audit">${rows.length?rows.map(x=>`<article data-oi-searchable="${safe(lower(`${x.action} ${x.summary} ${x.actorCognitusId} ${x.targetType} ${x.targetId}`))}"><i></i><div><strong>${safe(titleCase(x.action||"activity"))}</strong><p>${safe(x.summary||"No summary")}</p><small>${safe(x.actorCognitusId||x.actorUid||"Unknown actor")} · ${safe(formatTimestamp(x.createdAt))} · ${safe(x.targetType||"record")}</small></div></article>`).join(""):empty("Audit data unavailable","Your account may not have audit.read permission.")}</div></section>`;
}

function discipline(data) {
  const pending=data.appeals.filter(x=>status(x)==="pending"), active=data.discipline.filter(x=>status(x)!=="removed"), now=Date.now();
  const people=new Map(data.directory.map(x=>[x.uid||x.id,x]));
  return `<section class="oi-kpis">${kpi("Active write-ups",active.length,"Formal records not removed")}${kpi("Pending appeals",pending.length,"Awaiting owner decision",pending.length?"attention":"")}${kpi("Appeal deadlines",active.filter(x=>ms(x.appealDeadline)>now).length,"Currently within appeal period")}${kpi("Former staff records",former(data.directory).length,"Retained employment history")}</section>
  <section class="oi-toolbar"><label><span>Search discipline history</span><input data-oi-filter="discipline" type="search" placeholder="Employee, subject, level, status…"></label><div><button class="button" data-oi-print>Print / Save PDF</button><button class="button" data-oi-export="discipline">Export CSV</button></div></section>
  <section class="oi-card"><header><div><p class="eyebrow">Case history</p><h2>Discipline and appeals</h2></div><a href="#/admin/discipline">Open Review →</a></header><div class="oi-cases" data-oi-filter-target="discipline">${data.discipline.length?byNewest(data.discipline,["issuedAt","updatedAt"]).map(w=>{const p=people.get(w.recipientUid);const deadline=ms(w.appealDeadline),remaining=deadline-now;const appeal=data.appeals.find(a=>a.writeupId===(w.id||w.writeupId));return `<article data-oi-searchable="${safe(lower(`${p?.displayName} ${w.recipientName} ${w.subject} ${w.level} ${w.status}`))}"><header><div><strong>${safe(p?.displayName||w.recipientName||w.employeeId||"Employee")}</strong><span>${safe(w.subject||"Formal write-up")}</span></div>${pill(w.status)}</header><p>${safe(clean(w.details||"").slice(0,280))}</p><footer><span>${safe(titleCase(w.level||"written"))} · Issued ${safe(formatTimestamp(w.issuedAt))}</span><span>${remaining>0?`${Math.ceil(remaining/86400000)} day(s) to appeal`:appeal?`Appeal ${safe(titleCase(appeal.status))}`:"Appeal period closed"}</span></footer></article>`}).join(""):empty("No discipline records","No accessible write-ups were found.")}</div></section>`;
}

function operations(data) {
  const blocks=[["Tasks",data.tasks,"#/tasks"],["Requests",data.requests,"#/requests"],["Projects",data.projects,"#/projects"],["Tickets",data.tickets,"#/tickets"],["QA Reviews",data.qa,"#/quality"]];
  return `<section class="oi-grid metrics">${blocks.map(([label,rows,href])=>{const open=openRows(rows);return `<a class="oi-metric-card" href="${href}"><span>${safe(label)}</span><strong>${open.length}</strong><small>${rows.length} total accessible records</small><i>Open workspace →</i></a>`}).join("")}</section><section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Workload</p><h2>Open work by status</h2></div></header><div class="oi-status-grid">${blocks.map(([label,rows])=>`<div><strong>${safe(label)}</strong><span>${openRows(rows).length} open</span><small>${rows.filter(x=>["high","urgent","critical"].includes(lower(x.priority))).length} high priority</small></div>`).join("")}</div></article><article class="oi-card"><header><div><p class="eyebrow">Payroll</p><h2>Accessible summary</h2></div><a href="#/payroll">Payroll →</a></header><div class="oi-summary"><strong>${data.payroll.length}</strong><span>payroll statement${data.payroll.length===1?"":"s"}</span><p>Financial values remain in their existing protected records. This view only summarizes records your current permissions can read.</p></div></article></section>`;
}

function calendar(data) {
  const events=[...data.meetings.map(x=>({...x,_kind:"Meeting",_time:x.startsAt||x.startAt||x.scheduledFor||x.meetingAt})),...data.leave.map(x=>({...x,_kind:"Leave",_time:x.startsAt||x.startDate||x.fromDate||x.createdAt}))].filter(x=>ms(x._time)).sort((a,b)=>ms(a._time)-ms(b._time));
  return `<section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Unified calendar</p><h2>Meetings and leave</h2></div><a href="#/meetings">Manage →</a></header><div class="oi-calendar">${events.length?events.slice(0,80).map(x=>`<article><time>${safe(formatDate(x._time))}</time><div><strong>${safe(name(x))}</strong><span>${safe(x._kind)} · ${safe(titleCase(x.status||"scheduled"))}</span><small>${safe(x.location||x.reason||getDepartment(x.departmentId).shortName||"")}</small></div></article>`).join(""):empty("No calendar records","No accessible meetings or leave records were found.")}</div></article><article class="oi-card"><header><div><p class="eyebrow">Performance</p><h2>People operations</h2></div></header><div class="oi-status-grid"><div><strong>Leave requests</strong><span>${data.leave.length} total</span><small>${data.leave.filter(x=>status(x)==="pending").length} pending</small></div><div><strong>Performance records</strong><span>${data.performance.length} visible</span><small>Existing HR permissions apply</small></div><div><strong>Documents</strong><span>${data.documents.length} available</span><small>Policies, forms, and resources</small></div></div></article></section>`;
}

function communications(data) {
  const pins=new Set(JSON.parse(localStorage.getItem("cognitus:oi:pins")||"[]"));
  const announcements=byNewest(data.announcements,["publishedAt","createdAt"]);
  const inbox=byNewest(data.inbox);
  return `<section class="oi-grid two"><article class="oi-card"><header><div><p class="eyebrow">Announcements</p><h2>Pinned and categorized</h2></div><a href="#/announcements">All →</a></header><div class="oi-comms">${announcements.map(x=>`<article class="${pins.has(x.id)?"pinned":""}"><div><strong>${safe(x.title||x.subject||"Announcement")}</strong><span>${pill(x.category||x.type||"Company")}</span></div><p>${safe(clean(x.body||x.message||x.description||"").slice(0,220))}</p><footer><small>${safe(formatTimestamp(x.publishedAt||x.createdAt))}</small><button type="button" data-oi-pin="${safe(x.id)}">${pins.has(x.id)?"Unpin":"Pin locally"}</button></footer></article>`).join("")||empty("No announcements","No accessible announcements were found.")}</div></article><article class="oi-card"><header><div><p class="eyebrow">Notifications</p><h2>Notification center</h2></div><a href="#/inbox">Inbox →</a></header><div class="oi-comms">${inbox.slice(0,100).map(x=>`<article class="${x.readAt?"":"unread"}"><div><strong>${safe(x.title||"Staff notification")}</strong>${x.readAt?pill("read","muted"):pill("new")}</div><p>${safe(clean(x.message||"").slice(0,240))}</p><footer><small>${safe(formatTimestamp(x.createdAt))}</small>${x.href?`<a href="${safe(x.href)}">Open</a>`:""}</footer></article>`).join("")||empty("Inbox clear","No accessible notifications were found.")}</div></article></section>`;
}

function searchPanel() {
  return `<section class="oi-search-hero"><p class="eyebrow">Command-wide search</p><h2>Find anything you can access.</h2><input id="oi-global-search" type="search" placeholder="Search people, work, projects, documents, meetings…" autofocus><p>Search runs locally over records Firestore has already authorized for your account.</p></section><section class="oi-card"><div id="oi-global-results" class="oi-global-results">${empty("Start typing","Enter at least two characters to search accessible records.")}</div></section>`;
}

function panel(data) {
  if (oi.tab==="people") return people(data);
  if (oi.tab==="security") return security(data);
  if (oi.tab==="audit") return audit(data);
  if (oi.tab==="discipline") return discipline(data);
  if (oi.tab==="operations") return operations(data);
  if (oi.tab==="calendar") return calendar(data);
  if (oi.tab==="communications") return communications(data);
  if (oi.tab==="search") return searchPanel(data);
  return overview(data);
}

function csvCell(value) { const s=String(value??"").replace(/"/g,'""'); return `"${s}"`; }
function downloadCsv(filename, rows) { const text=rows.map(r=>r.map(csvCell).join(",")).join("\n");const blob=new Blob([text],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
function exportData(kind,data){if(kind==="directory")downloadCsv("cognitus-staff-directory.csv",[["Employee ID","Name","Title","Department","Rank","Status"],...data.directory.map(x=>[x.employeeId,x.displayName,x.title,getDepartment(x.departmentId).name,x.rank,x.status])]);if(kind==="audit")downloadCsv("cognitus-audit-log.csv",[["Date","Actor","Action","Target","Summary"],...data.audits.map(x=>[formatTimestamp(x.createdAt),x.actorCognitusId||x.actorUid,x.action,`${x.targetType||""}:${x.targetId||""}`,x.summary])]);if(kind==="discipline")downloadCsv("cognitus-discipline.csv",[["Employee","Employee ID","Subject","Level","Status","Issued","Appeal Deadline"],...data.discipline.map(x=>[x.recipientName,x.employeeId,x.subject,x.level,x.status,formatTimestamp(x.issuedAt),formatTimestamp(x.appealDeadline)])]);}

function bind(data) {
  root.querySelectorAll("[data-oi-tab]").forEach(b=>b.addEventListener("click",()=>{oi.tab=b.dataset.oiTab;localStorage.setItem("cognitus:oi:tab",oi.tab);render(false);}));
  root.querySelector("#oi-refresh")?.addEventListener("click",()=>render(true));
  root.querySelectorAll("[data-oi-filter]").forEach(input=>input.addEventListener("input",()=>{const q=lower(input.value);root.querySelectorAll(`[data-oi-filter-target="${input.dataset.oiFilter}"] [data-oi-searchable]`).forEach(row=>row.hidden=Boolean(q&&!row.dataset.oiSearchable.includes(q)));}));
  root.querySelectorAll("[data-oi-export]").forEach(b=>b.addEventListener("click",()=>exportData(b.dataset.oiExport,data)));
  root.querySelector("[data-oi-print]")?.addEventListener("click",()=>window.print());
  root.querySelectorAll("[data-oi-pin]").forEach(b=>b.addEventListener("click",()=>{const pins=new Set(JSON.parse(localStorage.getItem("cognitus:oi:pins")||"[]"));pins.has(b.dataset.oiPin)?pins.delete(b.dataset.oiPin):pins.add(b.dataset.oiPin);localStorage.setItem("cognitus:oi:pins",JSON.stringify([...pins]));render(false);}));
  const search=root.querySelector("#oi-global-search"),results=root.querySelector("#oi-global-results");
  if(search&&results){const rows=[...data.directory.map(x=>({...x,_type:"Person",_href:`#/staff/${x.uid||x.id}`})),...data.tasks.map(x=>({...x,_type:"Task",_href:"#/tasks"})),...data.projects.map(x=>({...x,_type:"Project",_href:"#/projects"})),...data.tickets.map(x=>({...x,_type:"Ticket",_href:"#/tickets"})),...data.documents.map(x=>({...x,_type:"Document",_href:"#/documents"})),...data.announcements.map(x=>({...x,_type:"Announcement",_href:"#/announcements"})),...data.meetings.map(x=>({...x,_type:"Meeting",_href:"#/meetings"}))].map(x=>({type:x._type,href:x._href,title:name(x),text:lower(`${name(x)} ${x.description||x.details||x.body||x.message||""} ${x.employeeId||""} ${x.status||""}`)}));search.addEventListener("input",()=>{const q=lower(search.value);const matches=q.length<2?[]:rows.filter(x=>x.text.includes(q)).slice(0,100);results.innerHTML=matches.length?matches.map(x=>`<a href="${safe(x.href)}"><span>${safe(x.type.slice(0,2).toUpperCase())}</span><div><strong>${safe(x.title)}</strong><small>${safe(x.type)}</small></div><b>→</b></a>`).join(""):empty(q.length<2?"Start typing":"Nothing matched",q.length<2?"Enter at least two characters.":"Try a broader search.");});}
}

async function render(force=false) {
  if(route()!==PATH||!oi.ready||!activeStaff())return;
  const token=++oi.token;document.title="Operations Intelligence · Cognitus Staff / Command";
  root.innerHTML=`<div class="page-inner oi-shell"><section class="oi-loading"><span>C</span><strong>Building Operations Intelligence…</strong></section></div>`;
  const data=await loadData(force);if(token!==oi.token||route()!==PATH)return;
  root.innerHTML=`<div class="page-inner oi-shell" data-oi-page><header class="oi-hero"><div><p class="eyebrow">Rules-zero intelligence layer</p><h1>Operations Intelligence.</h1><p>People, security, audit, discipline, work, calendars, communication, search, and exports—calculated from records your account is already authorized to read.</p></div><button class="button" id="oi-refresh" type="button">Refresh Data</button></header><nav class="oi-tabs" aria-label="Operations Intelligence sections">${tabButton("overview","Overview")}${tabButton("people","People",data.directory.length)}${tabButton("security","Security")}${tabButton("audit","Audit",data.audits.length)}${tabButton("discipline","Discipline",data.discipline.length)}${tabButton("operations","Operations")}${tabButton("calendar","Calendar")}${tabButton("communications","Updates")}${tabButton("search","Search")}</nav><main class="oi-content">${panel(data)}</main></div>`;
  bind(data);
}

async function init(){oi.tab=localStorage.getItem("cognitus:oi:tab")||"overview";const started=Date.now();while(!firebaseState().ready&&Date.now()-started<10000)await new Promise(r=>setTimeout(r,50));const s=firebaseState();if(!s.ready)return;oi.auth=s.auth;oi.Auth=s.Auth;oi.Auth.onAuthStateChanged(oi.auth,async user=>{oi.user=user;oi.data=null;if(user)[oi.userRecord,oi.access]=await Promise.all([readDoc("users",user.uid).catch(()=>null),readDoc("staffAccess",user.uid).catch(()=>null)]);else oi.userRecord=oi.access=null;oi.ready=true;render();});window.addEventListener("hashchange",()=>render());}
init();
