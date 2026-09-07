import { initializeFirebase, firebaseState, readDoc, readCollection, readQuery, newFirestoreDoc, writeBatch } from "./firebase.js";
import { DEPARTMENTS, RANKS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, PERMISSION_VALUES, bundle, hasPermission, hasAnyPermission, isActiveStaff } from "./config/permissions.js";
import {
  clean,
  lower,
  normalizeDiscordId,
  authEmail,
  safe,
  route,
  routeSegments,
  formObject,
  formatDate,
  formatTimestamp,
  alphabetic,
  newestFirst,
  initials,
  createEmployeeId,
  createCognitusId,
  setBusy,
  showNotice,
  statusLabel,
  relativeGreeting,
  debounce
} from "./utils.js";

const BUILD = "command-g1-2026-09-06";
const MAIN_PORTAL_URL = "https://silly-cheese.github.io/cognitus-solutions/";

const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const topbar = document.querySelector("#topbar");
const topbarCenter = document.querySelector("#topbar-center");
const topbarActions = document.querySelector("#topbar-actions");
const workspace = document.querySelector("#workspace");
const commandOverlay = document.querySelector("#command-overlay");
const commandInput = document.querySelector("#command-input");
const commandResults = document.querySelector("#command-results");
const toastRegion = document.querySelector("#toast-region");

let auth = null;
let db = null;
let Auth = null;
let Fire = null;

const state = {
  authReady: false,
  authUser: null,
  userRecord: null,
  staffAccess: null,
  directorySelf: null,
  employmentSelf: null,
  directory: [],
  inbox: [],
  directoryLoaded: false,
  inboxLoaded: false
};

const NAV = Object.freeze([
  { group: "Workspace", items: [
    { href: "#/dashboard", label: "Dashboard", icon: "DB" },
    { href: "#/inbox", label: "Inbox", icon: "IN", count: () => unreadInboxCount() }
  ]},
  { group: "Company", items: [
    { href: "#/directory", label: "Staff Directory", icon: "SD", permission: PERMISSIONS.DIRECTORY_READ },
    { href: "#/departments", label: "Departments", icon: "DP", permission: PERMISSIONS.DEPARTMENT_READ }
  ]},
  { group: "My Cognitus", items: [
    { href: "#/profile", label: "My Employee Profile", icon: "ME" },
    { href: MAIN_PORTAL_URL, label: "Open Main Cognitus", icon: "↗", external: true }
  ]},
  { group: "Administration", items: [
    { href: "#/admin/staff", label: "Staff Administration", icon: "SA", anyPermission: [PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE] }
  ]}
]);

function setTitle(title) {
  document.title = `${title} · Cognitus Staff / Command`;
}

function isMainOwner() {
  return state.userRecord?.status === "active" && state.userRecord?.role === "owner";
}

function can(permission) {
  return hasPermission(state.staffAccess, permission) || (isMainOwner() && state.staffAccess?.status === "active");
}

function canAny(permissions) {
  return permissions.some((permission) => can(permission));
}

function canManageStaff() {
  return isMainOwner() || canAny([PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE]);
}

function currentDepartment() {
  return getDepartment(state.staffAccess?.departmentId || state.directorySelf?.departmentId);
}

function currentRank() {
  return getRank(state.staffAccess?.rank || state.directorySelf?.rank);
}

function unreadInboxCount() {
  return state.inbox.filter((item) => !item.readAt).length;
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function showPortalChrome() {
  topbar.style.display = "grid";
  workspace.style.paddingTop = "var(--topbar-height)";
  root.classList.remove("login-page");
}

function hidePortalChrome() {
  topbar.style.display = "none";
  workspace.style.paddingTop = "0";
  sidebar.innerHTML = "";
  root.classList.add("login-page");
}

function activeRoute(href) {
  if (!href.startsWith("#")) return false;
  const target = href.replace(/^#/, "");
  const current = route();
  if (target === "/dashboard") return current === target;
  return current === target || current.startsWith(`${target}/`);
}

function navItemAllowed(item) {
  if (item.permission && !can(item.permission)) return false;
  if (item.anyPermission && !canAny(item.anyPermission) && !isMainOwner()) return false;
  return true;
}

function renderChrome() {
  if (!isActiveStaff(state.staffAccess) && !isMainOwner()) return;
  showPortalChrome();
  const department = currentDepartment();
  const directory = state.directorySelf;

  topbarCenter.innerHTML = `
    <button class="search-trigger" id="command-trigger" type="button" aria-label="Search Cognitus Command">
      <span>⌕</span><strong>Search Cognitus Command</strong><kbd>Ctrl K</kbd>
    </button>`;

  topbarActions.innerHTML = `
    <button class="icon-button mobile-menu" id="mobile-menu" type="button" aria-label="Open navigation">☰</button>
    <a class="icon-button" href="#/inbox" aria-label="Inbox">${unreadInboxCount() ? `●` : `○`}</a>
    <div class="user-chip">
      <span class="avatar">${safe(initials(directory?.displayName || state.userRecord?.displayName))}</span>
      <span class="user-chip-copy"><strong>${safe(directory?.displayName || state.userRecord?.displayName || "Cognitus Staff")}</strong><small>${safe(directory?.title || currentRank().label)}</small></span>
    </div>`;

  sidebar.innerHTML = NAV.map((group) => {
    const items = group.items.filter(navItemAllowed);
    if (!items.length) return "";
    return `<section class="sidebar-group"><span class="sidebar-label">${safe(group.group)}</span>${items.map((item) => {
      const count = typeof item.count === "function" ? Number(item.count() || 0) : 0;
      return `<a class="sidebar-link ${activeRoute(item.href) ? "active" : ""}" href="${safe(item.href)}" ${item.external ? 'target="_blank" rel="noopener"' : ""}>
        <span class="sidebar-link-icon">${safe(item.icon)}</span><span>${safe(item.label)}</span>${count ? `<span class="sidebar-link-count">${count}</span>` : ""}
      </a>`;
    }).join("")}</section>`;
  }).join("") + `
    <div class="sidebar-divider"></div>
    <div class="sidebar-profile">
      <strong>${safe(department.shortName)}</strong>
      <span>${safe(state.directorySelf?.employeeId || "Staff access active")}</span>
      <span>${safe(BUILD)}</span>
    </div>`;

  document.querySelector("#command-trigger")?.addEventListener("click", openCommand);
  document.querySelector("#mobile-menu")?.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
}

async function loadDirectory(force = false) {
  if (state.directoryLoaded && !force) return state.directory;
  try {
    state.directory = alphabetic(await readCollection("staffDirectory"));
    state.directoryLoaded = true;
  } catch (error) {
    console.warn("Directory unavailable", error);
    state.directory = state.directorySelf ? [state.directorySelf] : [];
  }
  return state.directory;
}

async function loadInbox(force = false) {
  if (state.inboxLoaded && !force) return state.inbox;
  if (!state.authUser) return [];
  try {
    state.inbox = newestFirst(await readQuery("staffInbox", [Fire.where("recipientUid", "==", state.authUser.uid)]));
  } catch (error) {
    if (error?.code !== "permission-denied") console.warn("Inbox unavailable", error);
    state.inbox = [];
  }
  state.inboxLoaded = true;
  return state.inbox;
}

async function refreshIdentity() {
  if (!state.authUser) {
    state.userRecord = null;
    state.staffAccess = null;
    state.directorySelf = null;
    state.employmentSelf = null;
    return;
  }

  const uid = state.authUser.uid;
  const [userRecord, staffAccess, directorySelf] = await Promise.all([
    readDoc("users", uid),
    readDoc("staffAccess", uid).catch(() => null),
    readDoc("staffDirectory", uid).catch(() => null)
  ]);

  state.userRecord = userRecord;
  state.staffAccess = staffAccess;
  state.directorySelf = directorySelf;

  if (staffAccess && (isActiveStaff(staffAccess) || isMainOwner())) {
    state.employmentSelf = await readDoc("staffEmployment", uid).catch(() => null);
    await Promise.all([loadDirectory(true), loadInbox(true)]);
  }
}

async function writeActivity(action, targetType, targetId, summary, metadata = {}) {
  if (!state.authUser || !state.userRecord || state.userRecord.status !== "active") return;
  const ref = newFirestoreDoc("auditLogs");
  try {
    await Fire.setDoc(ref, {
      id: ref.id,
      cognitusId: createCognitusId("AUD"),
      actorUid: state.authUser.uid,
      actorCognitusId: state.userRecord.cognitusId,
      actorRole: state.userRecord.role,
      action: clean(action).slice(0, 80),
      targetType: clean(targetType).slice(0, 80),
      targetId: targetId || null,
      summary: clean(summary).slice(0, 500),
      metadata,
      createdAt: Fire.serverTimestamp()
    });
  } catch (error) {
    console.warn("Audit activity was not written", error);
  }
}

function requireStaff() {
  if (!state.authUser) {
    loginPage();
    return false;
  }
  if (!state.userRecord) {
    accessDeniedPage("Cognitus account unavailable", "Your Firebase session exists, but no matching Cognitus account record was found.");
    return false;
  }
  if (!state.staffAccess) {
    if (isMainOwner()) {
      ownerBootstrapPage();
    } else {
      accessDeniedPage("Staff access required", "This Cognitus account has not been provisioned for the internal Staff / Command portal.");
    }
    return false;
  }
  if (!isActiveStaff(state.staffAccess)) {
    accessDeniedPage("Staff access unavailable", `Your current staff status is ${statusLabel(state.staffAccess.status)}.`);
    return false;
  }
  return true;
}

function loginPage() {
  setTitle("Staff Login");
  hidePortalChrome();
  root.innerHTML = `
    <section class="login-shell">
      <div class="login-visual">
        <div class="login-logo"><span class="brand-mark">C</span><div><strong>Cognitus Solutions</strong><small>Staff / Command</small></div></div>
        <div class="login-message"><p class="eyebrow">Internal access</p><h2>The company runs from here.</h2><p>One secure workspace for Cognitus employees, department leadership, company administration, and Command operations. Staff access is separate from ordinary Cognitus product access.</p></div>
        <div class="login-foot"><span>Shared Cognitus identity</span><span>•</span><span>Firestore-enforced staff access</span></div>
      </div>
      <div class="login-panel-wrap">
        <div class="login-panel">
          <p class="eyebrow">Cognitus Staff</p>
          <h1>Sign in.</h1>
          <p>Use the same Discord ID and Cognitus password you use on the main Cognitus portal. There is no separate staff signup.</p>
          <div id="login-message" class="notice" hidden></div>
          <form id="login-form" class="form-stack">
            <label>Discord ID<input name="discordId" inputmode="numeric" autocomplete="username" placeholder="Your Discord user ID" required></label>
            <label>Password<input name="password" type="password" autocomplete="current-password" placeholder="Your Cognitus password" required></label>
            <label class="checkbox-line"><input name="remember" type="checkbox" checked> Remember this device</label>
            <button class="button button-dark" type="submit">Enter Cognitus Command</button>
          </form>
          <div class="login-security"><span>◈</span><span>Authentication alone does not grant staff access. Command requires an active <code>staffAccess</code> record enforced by Firestore.</span></div>
        </div>
      </div>
    </section>`;

  root.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const discordId = normalizeDiscordId(data.discordId);
    const message = root.querySelector("#login-message");
    const button = form.querySelector("button[type=submit]");
    if (!discordId) return showNotice(message, "Enter a valid Discord ID.", "error");
    try {
      setBusy(button, true, "Signing in…", "Enter Cognitus Command");
      await Auth.setPersistence(auth, data.remember ? Auth.browserLocalPersistence : Auth.browserSessionPersistence);
      await Auth.signInWithEmailAndPassword(auth, authEmail(discordId), data.password);
      location.hash = "#/dashboard";
    } catch (error) {
      const messageText = ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(error?.code)
        ? "The Discord ID or password is incorrect."
        : error?.code === "auth/network-request-failed"
          ? "Cognitus could not reach Firebase. Check your connection and try again."
          : "Staff login could not be completed.";
      showNotice(message, messageText, "error");
    } finally {
      setBusy(button, false, "Signing in…", "Enter Cognitus Command");
    }
  });
}

function accessDeniedPage(title, description) {
  setTitle("Access Required");
  showPortalChrome();
  sidebar.innerHTML = "";
  topbarCenter.innerHTML = "";
  topbarActions.innerHTML = `<button class="button button-small" id="denied-logout" type="button">Sign out</button>`;
  root.innerHTML = `<section class="access-shell"><div class="access-panel"><span class="access-mark">!</span><p class="eyebrow">Cognitus Command</p><h1>${safe(title)}</h1><p>${safe(description)}</p><div class="button-row" style="margin-top:24px"><a class="button button-dark" href="${MAIN_PORTAL_URL}" target="_blank" rel="noopener">Open Main Cognitus</a><button class="button" id="access-signout" type="button">Sign out</button></div></div></section>`;
  ["denied-logout", "access-signout"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("click", signOut));
}

function ownerBootstrapPage() {
  setTitle("Initialize Command");
  showPortalChrome();
  sidebar.innerHTML = "";
  topbarCenter.innerHTML = "";
  topbarActions.innerHTML = `<button class="button button-small" id="bootstrap-logout" type="button">Sign out</button>`;
  root.innerHTML = `
    <section class="bootstrap-shell">
      <div class="bootstrap-panel">
        <span class="bootstrap-mark">C</span>
        <p class="eyebrow">First owner setup</p>
        <h1>Initialize Cognitus Command.</h1>
        <p>Your Cognitus account is already an active Owner. Command does not have a staff identity for this account yet. This one-time initialization creates the Founder / Chief Executive Officer staff records that secure the internal portal.</p>
        <div class="bootstrap-list">
          <div class="bootstrap-item"><span class="bootstrap-check">✓</span><div><strong>Executive Office staff identity</strong><span>Creates your safe staff-directory record without duplicating your Cognitus account.</span></div></div>
          <div class="bootstrap-item"><span class="bootstrap-check">✓</span><div><strong>Owner permission set</strong><span>Creates the Command access document used by Firestore to authorize internal tools.</span></div></div>
          <div class="bootstrap-item"><span class="bootstrap-check">✓</span><div><strong>Restricted employment record</strong><span>Keeps sensitive employment information separate from the internal staff directory.</span></div></div>
        </div>
        <div id="bootstrap-message" class="notice" hidden></div>
        <div class="button-row" style="margin-top:20px"><button class="button button-dark" id="initialize-command" type="button">Initialize Cognitus Command</button><button class="button" id="bootstrap-signout" type="button">Sign out</button></div>
      </div>
    </section>`;

  document.querySelector("#initialize-command")?.addEventListener("click", initializeOwnerStaff);
  ["bootstrap-logout", "bootstrap-signout"].forEach((id) => document.querySelector(`#${id}`)?.addEventListener("click", signOut));
}

async function initializeOwnerStaff() {
  if (!isMainOwner() || !state.authUser) return;
  const button = document.querySelector("#initialize-command");
  const message = document.querySelector("#bootstrap-message");
  const uid = state.authUser.uid;
  try {
    setBusy(button, true, "Initializing…", "Initialize Cognitus Command");
    const now = Fire.serverTimestamp();
    const employeeId = "COG-000001";
    const displayName = state.userRecord.displayName || state.userRecord.discordUsername || "Cognitus Owner";
    const batchWriter = writeBatch();
    batchWriter.set(Fire.doc(db, "staffDirectory", uid), {
      uid,
      employeeId,
      displayName,
      discordUsername: state.userRecord.discordUsername || displayName,
      title: "Founder / Chief Executive Officer",
      departmentId: "executive-office",
      rank: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now
    });
    batchWriter.set(Fire.doc(db, "staffAccess", uid), {
      uid,
      employeeId,
      departmentId: "executive-office",
      rank: "owner",
      accessLevel: 100,
      status: "active",
      permissions: [...PERMISSION_VALUES],
      grantedByUid: uid,
      createdAt: now,
      updatedAt: now
    });
    batchWriter.set(Fire.doc(db, "staffEmployment", uid), {
      uid,
      employeeId,
      employmentStatus: "active",
      managerUid: null,
      hireDate: now,
      positionHistory: [{ title: "Founder / Chief Executive Officer", departmentId: "executive-office", rank: "owner", effectiveAt: new Date().toISOString() }],
      notes: "",
      createdAt: now,
      updatedAt: now
    });
    await batchWriter.commit();
    await writeActivity("COMMAND_INITIALIZED", "staff", uid, "Initialized Cognitus Staff / Command owner identity.", { employeeId });
    await refreshIdentity();
    showToast("Cognitus Command initialized.");
    location.hash = "#/dashboard";
    await renderRoute();
  } catch (error) {
    console.error(error);
    showNotice(message, error?.code === "permission-denied" ? "Firestore has not yet been updated with the Command staff rules, or this account is not eligible for owner initialization." : "Command could not be initialized.", "error");
  } finally {
    setBusy(button, false, "Initializing…", "Initialize Cognitus Command");
  }
}

async function dashboardPage() {
  setTitle("Dashboard");
  if (!requireStaff()) return;
  await Promise.all([loadDirectory(), loadInbox()]);
  renderChrome();
  const department = currentDepartment();
  const roster = state.directory.filter((employee) => employee.departmentId === department.id && ["active", "training", "on_leave"].includes(employee.status));
  const activeCount = state.directory.filter((employee) => employee.status === "active").length;
  const recent = state.directory.slice(0, 6);

  root.innerHTML = `<div class="page-inner">
    <section class="hero-card">
      <div>
        <p class="eyebrow">${safe(department.name)} · ${safe(currentRank().label)}</p>
        <h1>${safe(relativeGreeting())}, ${safe(state.directorySelf?.displayName || state.userRecord.displayName)}.</h1>
        <p>Welcome to Cognitus Staff / Command. Your workspace is permission-driven, tied directly to your Cognitus identity, and separated from the customer-facing product.</p>
        <div class="button-row hero-actions"><a class="button button-dark" href="#/directory">Staff Directory</a><a class="button" href="#/departments/${safe(department.id)}">My Department</a></div>
      </div>
      <aside class="hero-identity"><div><span>Employee ID</span><strong>${safe(state.directorySelf?.employeeId || state.staffAccess.employeeId)}</strong><small>${safe(state.directorySelf?.title || currentRank().label)}<br>${safe(department.name)}</small></div><small class="hero-identity-code">Shared Firebase identity<br>${safe(state.authUser.uid.slice(0, 12))}…</small></aside>
    </section>

    <section class="stats-grid">
      <article class="stat-card"><span>Active Staff</span><strong>${activeCount}</strong><small>Visible active employees across Cognitus</small></article>
      <article class="stat-card"><span>My Department</span><strong>${roster.length}</strong><small>${safe(department.shortName)} staff currently active or available</small></article>
      <article class="stat-card"><span>Inbox</span><strong>${unreadInboxCount()}</strong><small>Unread Command notifications</small></article>
      <article class="stat-card"><span>Permissions</span><strong>${state.staffAccess.permissions?.length || 0}</strong><small>Explicit staff permissions assigned to this account</small></article>
    </section>

    <section class="content-grid">
      <div>
        <section class="panel">
          <header class="panel-header"><div><p class="eyebrow">Company</p><h2>Staff at a glance</h2></div><a class="button button-small" href="#/directory">Open Directory</a></header>
          ${recent.length ? `<div class="list">${recent.map(employeeListRow).join("")}</div>` : emptyState("SD", "No staff records yet", "Provision employees from Staff Administration to build the Cognitus directory.")}
        </section>
      </div>
      <div>
        <section class="panel">
          <header class="panel-header"><div><p class="eyebrow">Quick access</p><h2>Start here</h2></div></header>
          <div class="panel-body"><div class="quick-grid">
            ${quickCard("Staff Directory", "Find employees by name, Employee ID, department, or title.", "#/directory")}
            ${quickCard("My Department", department.name, `#/departments/${department.id}`)}
            ${quickCard("Inbox", `${unreadInboxCount()} unread notification${unreadInboxCount() === 1 ? "" : "s"}.`, "#/inbox")}
            ${quickCard("Main Cognitus", "Return to the customer/product portal.", MAIN_PORTAL_URL, true)}
          </div></div>
        </section>
        <section class="panel">
          <header class="panel-header"><div><p class="eyebrow">Command status</p><h2>Unified architecture</h2></div><span class="badge active">Connected</span></header>
          <div class="panel-body"><p style="margin:0;color:#666;font-size:11px;line-height:1.7">Command is connected to the <strong>cognitus-solutions</strong> Firebase project. Staff authority comes from a separate staff-access record—not from ordinary product access. Background checks remain automated and do not require staff approval.</p></div>
        </section>
      </div>
    </section>
  </div>`;
}

function quickCard(title, description, href, external = false) {
  return `<a class="quick-card" href="${safe(href)}" ${external ? 'target="_blank" rel="noopener"' : ""}><strong>${safe(title)}</strong><span>${safe(description)}</span><span class="quick-card-arrow">→</span></a>`;
}

function employeeListRow(employee) {
  const department = getDepartment(employee.departmentId);
  return `<a class="list-row" href="#/staff/${encodeURIComponent(employee.uid || employee.id)}" style="text-decoration:none;color:inherit"><span class="avatar">${safe(initials(employee.displayName))}</span><span class="list-row-copy"><strong>${safe(employee.displayName || "Unnamed Employee")}</strong><span>${safe(employee.title || getRank(employee.rank).label)}</span><small>${safe(employee.employeeId || "—")} · ${safe(department.shortName)}</small></span><span class="badge ${safe(employee.status)}">${safe(statusLabel(employee.status))}</span></a>`;
}

function emptyState(icon, title, body, action = "") {
  return `<div class="empty-state"><span class="empty-state-icon">${safe(icon)}</span><h3>${safe(title)}</h3><p>${safe(body)}</p>${action ? `<div class="button-row" style="justify-content:center;margin-top:16px">${action}</div>` : ""}</div>`;
}

async function directoryPage() {
  setTitle("Staff Directory");
  if (!requireStaff()) return;
  if (!can(PERMISSIONS.DIRECTORY_READ)) return forbiddenPage("Staff Directory");
  await loadDirectory();
  renderChrome();
  root.innerHTML = `<div class="page-inner">
    <header class="page-header"><div class="page-header-copy"><p class="eyebrow">Company directory</p><h1>People of Cognitus.</h1><p>Search the internal directory by partial name, Employee ID, title, department, or Discord username.</p></div>${canManageStaff() ? `<a class="button button-dark" href="#/admin/staff">Manage Staff</a>` : ""}</header>
    <div class="directory-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="directory-search" type="search" placeholder="Search staff…" autocomplete="off"></div><select id="department-filter" aria-label="Filter by department"><option value="">All departments</option>${DEPARTMENTS.map((department) => `<option value="${safe(department.id)}">${safe(department.name)}</option>`).join("")}</select></div>
    <div id="directory-results"></div>
  </div>`;

  const search = root.querySelector("#directory-search");
  const filter = root.querySelector("#department-filter");
  const update = () => renderDirectoryResults(search.value, filter.value);
  search.addEventListener("input", debounce(update));
  filter.addEventListener("change", update);
  update();
}

function renderDirectoryResults(queryValue = "", departmentId = "") {
  const query = lower(queryValue);
  const filtered = state.directory.filter((employee) => {
    if (departmentId && employee.departmentId !== departmentId) return false;
    if (!query) return true;
    const department = getDepartment(employee.departmentId);
    const haystack = [employee.displayName, employee.employeeId, employee.title, employee.discordUsername, department.name, getRank(employee.rank).label].map(lower).join(" ");
    return haystack.includes(query);
  });
  const target = root.querySelector("#directory-results");
  if (!target) return;
  if (!filtered.length) {
    target.innerHTML = emptyState("⌕", "No employees matched", "Try a partial name, Employee ID, title, or a different department.");
    return;
  }
  target.innerHTML = `<div class="directory-table-wrap"><table class="directory-table"><thead><tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Position</th><th>Status</th></tr></thead><tbody>${filtered.map((employee) => `<tr data-staff-uid="${safe(employee.uid || employee.id)}"><td><div class="employee-cell"><span class="avatar">${safe(initials(employee.displayName))}</span><span class="employee-cell-copy"><strong>${safe(employee.displayName)}</strong><small>${safe(employee.discordUsername || "No Discord username listed")}</small></span></div></td><td>${safe(employee.employeeId || "—")}</td><td>${safe(getDepartment(employee.departmentId).shortName)}</td><td>${safe(employee.title || getRank(employee.rank).label)}</td><td><span class="badge ${safe(employee.status)}">${safe(statusLabel(employee.status))}</span></td></tr>`).join("")}</tbody></table></div>`;
  target.querySelectorAll("[data-staff-uid]").forEach((row) => row.addEventListener("click", () => location.hash = `#/staff/${encodeURIComponent(row.dataset.staffUid)}`));
}

async function staffProfilePage(uid) {
  setTitle("Employee Profile");
  if (!requireStaff()) return;
  if (!can(PERMISSIONS.DIRECTORY_READ) && uid !== state.authUser.uid) return forbiddenPage("Employee Profile");
  renderChrome();
  const directory = uid === state.authUser.uid ? state.directorySelf : await readDoc("staffDirectory", uid).catch(() => null);
  if (!directory) return notFoundPage("Employee not found", "The requested staff-directory record does not exist or is not visible to your account.");

  let access = null;
  let employment = null;
  if (uid === state.authUser.uid) {
    access = state.staffAccess;
    employment = state.employmentSelf;
  } else if (canAny([PERMISSIONS.PERMISSIONS_MANAGE, PERMISSIONS.STAFF_PRIVATE_READ, PERMISSIONS.HR_RECORDS_READ]) || isMainOwner()) {
    access = await readDoc("staffAccess", uid).catch(() => null);
    employment = await readDoc("staffEmployment", uid).catch(() => null);
  }

  const department = getDepartment(directory.departmentId);
  const rank = getRank(directory.rank);
  root.innerHTML = `<div class="page-inner">
    <header class="profile-hero"><span class="avatar profile-avatar">${safe(initials(directory.displayName))}</span><div class="profile-copy"><h1>${safe(directory.displayName)}</h1><p>${safe(directory.title || rank.label)} · ${safe(department.name)}</p><div class="profile-tags"><span class="badge ${safe(directory.status)}">${safe(statusLabel(directory.status))}</span><span class="badge">${safe(rank.label)}</span><span class="badge">${safe(department.code)}</span></div></div><div class="profile-meta"><span>Employee ID</span><strong>${safe(directory.employeeId || "—")}</strong></div></header>
    <section class="content-grid equal">
      <section class="panel"><header class="panel-header"><div><p class="eyebrow">Directory</p><h2>Employee information</h2></div></header><div class="details-grid"><div class="detail"><span>Department</span><strong>${safe(department.name)}</strong></div><div class="detail"><span>Rank</span><strong>${safe(rank.label)}</strong></div><div class="detail"><span>Position</span><strong>${safe(directory.title || rank.label)}</strong></div><div class="detail"><span>Discord</span><strong>${safe(directory.discordUsername || "—")}</strong></div><div class="detail"><span>Joined</span><strong>${safe(formatDate(directory.joinedAt))}</strong></div><div class="detail"><span>Status</span><strong>${safe(statusLabel(directory.status))}</strong></div></div></section>
      <section class="panel"><header class="panel-header"><div><p class="eyebrow">Department</p><h2>${safe(department.shortName)}</h2></div><a class="button button-small" href="#/departments/${safe(department.id)}">Open</a></header><div class="panel-body"><p style="margin:0;color:#666;font-size:11px;line-height:1.7">${safe(department.description)}</p><div class="permission-list" style="margin-top:16px">${department.focus.map((focus) => `<span class="permission-chip">${safe(focus)}</span>`).join("")}</div></div></section>
    </section>
    ${access ? `<section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Security</p><h2>Command access</h2></div><span class="badge ${safe(access.status)}">${safe(statusLabel(access.status))}</span></header><div class="panel-body"><div class="permission-list">${(access.permissions || []).map((permission) => `<span class="permission-chip">${safe(permission)}</span>`).join("") || `<span class="help-text">No explicit permissions.</span>`}</div></div></section>` : ""}
    ${employment ? `<section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Restricted record</p><h2>Employment</h2></div></header><div class="details-grid"><div class="detail"><span>Employment status</span><strong>${safe(statusLabel(employment.employmentStatus))}</strong></div><div class="detail"><span>Hire date</span><strong>${safe(formatDate(employment.hireDate))}</strong></div><div class="detail"><span>Manager UID</span><strong>${safe(employment.managerUid || "Not assigned")}</strong></div><div class="detail"><span>Position history</span><strong>${Number(employment.positionHistory?.length || 0)} record(s)</strong></div></div></section>` : ""}
  </div>`;
}

async function departmentsPage() {
  setTitle("Departments");
  if (!requireStaff()) return;
  if (!can(PERMISSIONS.DEPARTMENT_READ)) return forbiddenPage("Departments");
  await loadDirectory();
  renderChrome();
  root.innerHTML = `<div class="page-inner"><header class="page-header"><div class="page-header-copy"><p class="eyebrow">Company structure</p><h1>Departments.</h1><p>Each Cognitus department has its own Chief Officer at the Board level and a dedicated workspace inside Staff / Command.</p></div></header><section class="department-grid">${DEPARTMENTS.map((department) => {
    const count = state.directory.filter((employee) => employee.departmentId === department.id && !["former", "suspended"].includes(employee.status)).length;
    return `<a class="department-card" href="#/departments/${safe(department.id)}"><div class="department-card-top"><span class="department-code">${safe(department.code)}</span><span class="badge">${count} staff</span></div><h3>${safe(department.name)}</h3><p>${safe(department.description)}</p><span class="department-chief">${safe(department.chiefTitle)}</span></a>`;
  }).join("")}</section></div>`;
}

async function departmentPage(id) {
  setTitle("Department");
  if (!requireStaff()) return;
  if (!can(PERMISSIONS.DEPARTMENT_READ)) return forbiddenPage("Department");
  await loadDirectory();
  renderChrome();
  const department = DEPARTMENTS.find((item) => item.id === id);
  if (!department) return notFoundPage("Department not found", "The requested Cognitus department does not exist.");
  const roster = state.directory.filter((employee) => employee.departmentId === department.id);
  const active = roster.filter((employee) => employee.status === "active");
  const chief = roster.find((employee) => employee.rank === "chief-officer") || (department.id === "executive-office" ? roster.find((employee) => employee.rank === "owner") : null);
  root.innerHTML = `<div class="page-inner">
    <header class="page-header"><div class="page-header-copy"><p class="eyebrow">${safe(department.code)} · Department workspace</p><h1>${safe(department.name)}.</h1><p>${safe(department.description)}</p></div>${can(PERMISSIONS.DEPARTMENT_MANAGE) && state.staffAccess.departmentId === department.id ? `<span class="badge active">Department leadership</span>` : ""}</header>
    <section class="stats-grid"><article class="stat-card"><span>Active Staff</span><strong>${active.length}</strong><small>Currently active in ${safe(department.shortName)}</small></article><article class="stat-card"><span>Total Roster</span><strong>${roster.length}</strong><small>All visible department records</small></article><article class="stat-card"><span>Chief Officer</span><strong style="font-size:16px;line-height:1.2">${safe(chief?.displayName || "Unassigned")}</strong><small>${safe(department.chiefTitle)}</small></article><article class="stat-card"><span>Department Code</span><strong>${safe(department.code)}</strong><small>Cognitus internal department identifier</small></article></section>
    <section class="content-grid"><section class="panel"><header class="panel-header"><div><p class="eyebrow">Roster</p><h2>${safe(department.shortName)} staff</h2></div></header>${roster.length ? `<div class="list">${alphabetic(roster).map(employeeListRow).join("")}</div>` : emptyState(department.code, "No staff assigned", "This department does not have any visible staff records yet.")}</section><section class="panel"><header class="panel-header"><div><p class="eyebrow">Mandate</p><h2>Department focus</h2></div></header><div class="panel-body"><div class="permission-list">${department.focus.map((focus) => `<span class="permission-chip">${safe(focus)}</span>`).join("")}</div><p style="margin:18px 0 0;color:#666;font-size:11px;line-height:1.7">Board-level department lead: <strong>${safe(department.chiefTitle)}</strong>.</p></div></section></section>
  </div>`;
}

async function inboxPage() {
  setTitle("Inbox");
  if (!requireStaff()) return;
  await loadInbox(true);
  renderChrome();
  root.innerHTML = `<div class="page-inner"><header class="page-header"><div class="page-header-copy"><p class="eyebrow">Action inbox</p><h1>Inbox.</h1><p>Assignments, approvals, policy notices, ticket updates, and other actionable Command notifications will surface here.</p></div></header><section class="panel">${state.inbox.length ? `<div class="list">${state.inbox.map((item) => `<article class="list-row"><span class="avatar">${safe(item.kind?.slice(0,2)?.toUpperCase() || "IN")}</span><span class="list-row-copy"><strong>${safe(item.title || "Command notification")}</strong><span>${safe(item.message || "")}</span><small>${safe(formatTimestamp(item.createdAt))}</small></span>${item.href ? `<a class="button button-small" href="${safe(item.href)}">Open</a>` : `<span class="badge ${item.readAt ? "" : "active"}">${item.readAt ? "Read" : "New"}</span>`}</article>`).join("")}</div>` : emptyState("IN", "Your inbox is clear", "New Command notifications and action items will appear here automatically as the staff platform expands.")}</section></div>`;
}

async function myProfilePage() {
  return staffProfilePage(state.authUser.uid);
}

async function staffAdminPage() {
  setTitle("Staff Administration");
  if (!requireStaff()) return;
  if (!canManageStaff()) return forbiddenPage("Staff Administration");
  await loadDirectory();
  renderChrome();
  root.innerHTML = `<div class="page-inner">
    <header class="page-header"><div class="page-header-copy"><p class="eyebrow">Administration</p><h1>Staff administration.</h1><p>Provision an existing Cognitus account for internal staff access. This does not create a new Cognitus user and does not use a separate staff login system.</p></div></header>
    <section class="content-grid">
      <section class="form-card"><p class="eyebrow">Provision employee</p><h2 style="margin:0 0 8px;font-size:20px;letter-spacing:-.035em">Add an existing Cognitus user</h2><p style="margin:0 0 20px;color:#666;font-size:10px;line-height:1.6">Enter the exact Discord ID already attached to the person's Cognitus account.</p><div id="staff-admin-message" class="notice" hidden></div>
        <form id="provision-form" class="form-stack">
          <label>Discord ID<input name="discordId" inputmode="numeric" required></label>
          <div class="form-row"><label>Department<select name="departmentId" required>${DEPARTMENTS.filter((department) => department.id !== "executive-office" || isMainOwner()).map((department) => `<option value="${safe(department.id)}">${safe(department.name)}</option>`).join("")}</select></label><label>Rank<select name="rank" required>${RANKS.filter((rank) => rank.id !== "owner").map((rank) => `<option value="${safe(rank.id)}">${safe(rank.label)}</option>`).join("")}</select></label></div>
          <label>Position Title<input name="title" maxlength="100" placeholder="e.g. Customer Service Specialist" required></label>
          <label>Permission Preset<select name="preset" required><option value="staff">Standard Staff</option><option value="supervisor">Supervisor Foundation</option><option value="chief-public-relations">Chief Public Relations Officer</option><option value="chief-customer-service">Chief Customer Service Officer</option><option value="chief-financial-officer">Chief Financial Officer</option><option value="chief-human-resources">Chief Human Resources Officer</option><option value="chief-quality-assurance">Chief Quality Assurance Officer</option></select></label>
          <label>Status<select name="status"><option value="active">Active</option><option value="training">Training</option><option value="on_leave">On Leave</option></select></label>
          <button class="button button-dark" type="submit">Provision Staff Access</button>
        </form>
      </section>
      <section class="panel"><header class="panel-header"><div><p class="eyebrow">Security model</p><h2>What provisioning creates</h2></div></header><div class="panel-body"><div class="bootstrap-list"><div class="bootstrap-item"><span class="bootstrap-check">1</span><div><strong>staffDirectory</strong><span>Internal-safe profile used by the employee directory.</span></div></div><div class="bootstrap-item"><span class="bootstrap-check">2</span><div><strong>staffAccess</strong><span>Department, rank, staff status, and explicit permissions.</span></div></div><div class="bootstrap-item"><span class="bootstrap-check">3</span><div><strong>staffEmployment</strong><span>Restricted HR/employment record, separate from directory data.</span></div></div></div></div></section>
    </section>
    <section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Current staff</p><h2>${state.directory.length} employee record${state.directory.length === 1 ? "" : "s"}</h2></div></header>${state.directory.length ? `<div class="list">${state.directory.map(employeeListRow).join("")}</div>` : emptyState("SD", "No staff provisioned", "Initialize or provision the first employee to begin building the directory.")}</section>
  </div>`;

  root.querySelector("#provision-form")?.addEventListener("submit", provisionStaff);
}

async function provisionStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = formObject(form);
  const message = root.querySelector("#staff-admin-message");
  const button = form.querySelector("button[type=submit]");
  const discordId = normalizeDiscordId(data.discordId);
  if (!discordId) return showNotice(message, "Enter a valid Discord ID.", "error");
  if (!DEPARTMENTS.some((department) => department.id === data.departmentId)) return showNotice(message, "Choose a recognized Cognitus department.", "error");
  if (!RANKS.some((rank) => rank.id === data.rank) || data.rank === "owner") return showNotice(message, "Choose a valid non-owner rank.", "error");
  try {
    setBusy(button, true, "Provisioning…", "Provision Staff Access");
    const matches = await readQuery("users", [Fire.where("discordId", "==", discordId)]);
    if (matches.length !== 1) {
      return showNotice(message, matches.length ? "More than one Cognitus account matched that Discord ID. Provisioning stopped for safety." : "No Cognitus account exists with that Discord ID.", "error");
    }
    const user = matches[0];
    const existing = await readDoc("staffAccess", user.uid).catch(() => null);
    if (existing) return showNotice(message, "That Cognitus account already has a staff-access record.", "error");

    const employeeId = createEmployeeId();
    const now = Fire.serverTimestamp();
    const permissions = bundle(data.preset);
    const rank = getRank(data.rank);
    const displayName = user.displayName || user.discordUsername || "Cognitus Employee";
    const batchWriter = writeBatch();
    batchWriter.set(Fire.doc(db, "staffDirectory", user.uid), {
      uid: user.uid,
      employeeId,
      displayName,
      discordUsername: user.discordUsername || displayName,
      title: clean(data.title).slice(0, 100),
      departmentId: data.departmentId,
      rank: data.rank,
      status: data.status,
      joinedAt: now,
      createdAt: now,
      updatedAt: now
    });
    batchWriter.set(Fire.doc(db, "staffAccess", user.uid), {
      uid: user.uid,
      employeeId,
      departmentId: data.departmentId,
      rank: data.rank,
      accessLevel: rank.level,
      status: data.status,
      permissions,
      grantedByUid: state.authUser.uid,
      createdAt: now,
      updatedAt: now
    });
    batchWriter.set(Fire.doc(db, "staffEmployment", user.uid), {
      uid: user.uid,
      employeeId,
      employmentStatus: data.status,
      managerUid: null,
      hireDate: now,
      positionHistory: [{ title: clean(data.title).slice(0, 100), departmentId: data.departmentId, rank: data.rank, effectiveAt: new Date().toISOString() }],
      notes: "",
      createdAt: now,
      updatedAt: now
    });
    await batchWriter.commit();
    await writeActivity("STAFF_PROVISIONED", "staff", user.uid, `Provisioned ${displayName} for Cognitus Staff / Command.`, { employeeId, departmentId: data.departmentId, rank: data.rank });
    state.directoryLoaded = false;
    await loadDirectory(true);
    form.reset();
    showNotice(message, `${displayName} was provisioned as ${employeeId}.`, "success");
    showToast("Staff access provisioned.");
  } catch (error) {
    console.error(error);
    showNotice(message, error?.code === "permission-denied" ? "Firestore denied this provisioning action. Confirm the shared Command rules are deployed and your account has staff-provisioning authority." : "The employee could not be provisioned.", "error");
  } finally {
    setBusy(button, false, "Provisioning…", "Provision Staff Access");
  }
}

function forbiddenPage(area) {
  setTitle("Not Authorized");
  renderChrome();
  root.innerHTML = `<div class="page-inner">${emptyState("!", "Permission required", `Your Cognitus staff account is active, but it does not have permission to open ${area}.`, `<a class="button" href="#/dashboard">Return to Dashboard</a>`)}</div>`;
}

function notFoundPage(title, body) {
  setTitle("Not Found");
  renderChrome();
  root.innerHTML = `<div class="page-inner">${emptyState("?", title, body, `<a class="button" href="#/dashboard">Dashboard</a>`)}</div>`;
}

async function signOut() {
  try {
    await Auth.signOut(auth);
  } finally {
    state.directoryLoaded = false;
    state.inboxLoaded = false;
    state.directory = [];
    state.inbox = [];
    location.hash = "#/login";
  }
}

function openCommand() {
  if (!requireStaff()) return;
  commandOverlay.hidden = false;
  commandInput.value = "";
  renderCommandResults("");
  window.setTimeout(() => commandInput.focus(), 0);
}

function closeCommand() {
  commandOverlay.hidden = true;
}

function commandIndex() {
  const pages = [
    { type: "Page", title: "Dashboard", subtitle: "Your Cognitus Staff workspace", href: "#/dashboard" },
    { type: "Page", title: "Inbox", subtitle: "Command notifications and action items", href: "#/inbox" },
    ...(can(PERMISSIONS.DIRECTORY_READ) ? [{ type: "Page", title: "Staff Directory", subtitle: "Search Cognitus employees", href: "#/directory" }] : []),
    ...(can(PERMISSIONS.DEPARTMENT_READ) ? [{ type: "Page", title: "Departments", subtitle: "Cognitus company structure", href: "#/departments" }] : [])
  ];
  const departments = can(PERMISSIONS.DEPARTMENT_READ) ? DEPARTMENTS.map((department) => ({ type: "Department", title: department.name, subtitle: department.chiefTitle, href: `#/departments/${department.id}`, icon: department.code })) : [];
  const employees = can(PERMISSIONS.DIRECTORY_READ) ? state.directory.map((employee) => ({ type: "Employee", title: employee.displayName, subtitle: `${employee.employeeId || "—"} · ${employee.title || getRank(employee.rank).label}`, href: `#/staff/${employee.uid || employee.id}`, icon: initials(employee.displayName), search: `${employee.discordUsername || ""} ${getDepartment(employee.departmentId).name}` })) : [];
  return [...pages, ...departments, ...employees];
}

function renderCommandResults(value) {
  const query = lower(value);
  const results = commandIndex().filter((item) => !query || lower(`${item.title} ${item.subtitle} ${item.type} ${item.search || ""}`).includes(query)).slice(0, 18);
  commandResults.innerHTML = results.length ? results.map((item) => `<button class="command-result" type="button" data-command-href="${safe(item.href)}"><span class="avatar">${safe(item.icon || item.type.slice(0,2).toUpperCase())}</span><span class="command-result-copy"><strong>${safe(item.title)}</strong><span>${safe(item.subtitle)}</span></span><span class="command-result-type">${safe(item.type)}</span></button>`).join("") : emptyState("⌕", "Nothing matched", "Try a name, Employee ID, department, or page name.");
  commandResults.querySelectorAll("[data-command-href]").forEach((button) => button.addEventListener("click", () => {
    closeCommand();
    location.hash = button.dataset.commandHref.replace(/^#/, "");
  }));
}

async function renderRoute() {
  if (!state.authReady) return;
  document.body.classList.remove("sidebar-open");
  const current = route();
  if (!state.authUser) return loginPage();
  if (current === "/login") location.hash = "#/dashboard";
  if (!state.userRecord) return accessDeniedPage("Cognitus account unavailable", "No Cognitus account record is associated with this authenticated session.");
  if (!state.staffAccess) return isMainOwner() ? ownerBootstrapPage() : accessDeniedPage("Staff access required", "This Cognitus account has not been provisioned for the internal portal.");
  if (!isActiveStaff(state.staffAccess)) return accessDeniedPage("Staff access unavailable", `Your current staff status is ${statusLabel(state.staffAccess.status)}.`);

  renderChrome();
  const segments = routeSegments();
  if (current === "/" || current === "/dashboard") return dashboardPage();
  if (current === "/directory") return directoryPage();
  if (current === "/departments") return departmentsPage();
  if (segments[0] === "departments" && segments[1]) return departmentPage(decodeURIComponent(segments[1]));
  if (current === "/inbox") return inboxPage();
  if (current === "/profile") return myProfilePage();
  if (segments[0] === "staff" && segments[1]) return staffProfilePage(decodeURIComponent(segments[1]));
  if (current === "/admin/staff") return staffAdminPage();
  return notFoundPage("Page not found", "The requested Cognitus Command route does not exist.");
}

async function start() {
  try {
    const services = await initializeFirebase();
    ({ auth, db, Auth, Fire } = services);
    Auth.onAuthStateChanged(auth, async (user) => {
      state.authUser = user;
      try {
        await refreshIdentity();
      } catch (error) {
        console.error("Identity refresh failed", error);
      }
      state.authReady = true;
      await renderRoute();
    });
  } catch (error) {
    console.error(error);
    hidePortalChrome();
    root.innerHTML = `<section class="login-shell"><div class="login-panel-wrap" style="grid-column:1/-1"><div class="login-panel"><p class="eyebrow">Cognitus Command</p><h1>Connection unavailable.</h1><p>The portal could not initialize Firebase. Verify the shared Cognitus Firebase configuration and network connection.</p><div class="notice notice-error">${safe(error?.message || "Firebase initialization failed.")}</div></div></div></section>`;
  }
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && lower(event.key) === "k") {
    event.preventDefault();
    openCommand();
  }
  if (event.key === "Escape" && !commandOverlay.hidden) closeCommand();
});
commandInput.addEventListener("input", debounce(() => renderCommandResults(commandInput.value), 80));
commandOverlay.querySelectorAll("[data-command-close]").forEach((button) => button.addEventListener("click", closeCommand));

start();
