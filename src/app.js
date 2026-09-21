import { initializeFirebase, firebaseState, readDoc, readCollection, readQuery, newFirestoreDoc, writeBatch } from "./firebase.js";
import { DEPARTMENTS, RANKS, getDepartment, getRank } from "./config/departments.js";
import { PERMISSIONS, PERMISSION_VALUES, bundle, effectivePermissions, hasPermission, hasAnyPermission, isActiveStaff } from "./config/permissions.js?v=discord-role-sync-1";
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
const MAIN_PORTAL_URL = "https://cognitus-solutions.org/";
const COGNITUS_AUTH_BASE = "https://auth.cognitus-solutions.org";
const COGNITUS_PORTAL_KEY = "staff";

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

function discordOAuthUrl() {
  return COGNITUS_AUTH_BASE + "/discord/start?portal=" + COGNITUS_PORTAL_KEY;
}

async function discordAdminApi(path, options = {}) {
  if (!state.authUser) throw new Error("Sign in to Cognitus Staff first.");
  const idToken = await state.authUser.getIdToken();
  const response = await fetch(COGNITUS_AUTH_BASE + path, {
    method: options.method || "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + idToken,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Discord integration request failed.");
  return payload;
}

async function syncDiscordStaff(uid, apply = true) {
  return discordAdminApi("/discord-admin/sync-user", {
    method: "POST",
    body: { uid, apply }
  });
}

async function completeDiscordOAuthIfPresent() {
  const params = new URLSearchParams(location.search);
  if (params.get("cognitus_oauth") !== "1") return false;
  try {
    const response = await fetch(
      COGNITUS_AUTH_BASE + "/session/exchange?portal=" + COGNITUS_PORTAL_KEY,
      { credentials: "include", headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.customToken) {
      throw new Error(payload.error || "Discord sign-in could not be completed.");
    }
    await Auth.setPersistence(auth, Auth.browserLocalPersistence);
    await Auth.signInWithCustomToken(auth, payload.customToken);
    sessionStorage.removeItem("cognitusDiscordOAuthError");
    history.replaceState(null, "", location.pathname + "#/dashboard");
    return true;
  } catch (error) {
    sessionStorage.setItem(
      "cognitusDiscordOAuthError",
      error?.message || "Discord sign-in could not be completed."
    );
    history.replaceState(null, "", location.pathname + "#/login");
    return false;
  }
}

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
    { href: "#/admin/staff", label: "Staff Administration", icon: "SA", anyPermission: [PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE] },
    { href: "#/admin/discord", label: "Discord Integration", icon: "DI", anyPermission: [PERMISSIONS.PERMISSIONS_MANAGE, PERMISSIONS.SYSTEM_MANAGE] }
  ]}
]);

const EXTENSION_ROUTES = new Set([
  "/tasks", "/requests", "/projects", "/meetings", "/announcements", "/documents",
  "/tickets", "/leave", "/hr/lifecycle", "/finance", "/payroll",
  "/command", "/command/reports", "/command/claims", "/command/appeals",
  "/command/organizations", "/command/cases", "/command/evidence",
  "/command/accreditation", "/command/escalations", "/command/incidents",
  "/department-command", "/quality", "/public-relations", "/customer-service",
  "/executive", "/executive/accounts", "/executive/approvals", "/executive/audit",
  "/operations-intelligence",
  "/discipline", "/admin/discipline"
]);

function setTitle(title) {
  document.title = `${title} · Cognitus Staff / Command`;
}

function isMainOwner() {
  return state.userRecord?.status === "active" && state.userRecord?.role === "owner";
}

function isCoOwner() {
  return Boolean(isActiveStaff(state.staffAccess) && state.staffAccess?.rank === "co-owner");
}

function isExecutiveOwner() {
  return isMainOwner() || isCoOwner();
}

function can(permission) {
  return hasPermission(state.staffAccess, permission) || (isExecutiveOwner() && state.staffAccess?.status === "active");
}

function canAny(permissions) {
  return permissions.some((permission) => can(permission));
}

function canManageStaff() {
  // Generation 1's Staff Administration surface provisions accounts. Broader
  // HR employee-management controls arrive in Generation 2, so only explicit
  // provisioners (and the Cognitus Owner) should see this page today.
  return isExecutiveOwner() || can(PERMISSIONS.STAFF_PROVISION);
}

function canManageDiscordIntegration() {
  return isMainOwner() || can(PERMISSIONS.PERMISSIONS_MANAGE) || can(PERMISSIONS.SYSTEM_MANAGE);
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
  if (item.anyPermission && !canAny(item.anyPermission) && !isExecutiveOwner()) return false;
  return true;
}

function renderChrome() {
  if (!isActiveStaff(state.staffAccess) && !isExecutiveOwner()) return;
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
  const [userRecord, staffAccess, directorySelf, employmentSelf] = await Promise.all([
    readDoc("users", uid),
    readDoc("staffAccess", uid).catch(() => null),
    readDoc("staffDirectory", uid).catch(() => null),
    readDoc("staffEmployment", uid).catch(() => null)
  ]);

  state.userRecord = userRecord;
  state.staffAccess = staffAccess;
  state.directorySelf = directorySelf;
  state.employmentSelf = employmentSelf;

  if (staffAccess && (isActiveStaff(staffAccess) || isMainOwner())) {
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
        <div class="login-message"><p class="eyebrow">Internal access</p><h2>The company runs from here.</h2><p>Staff / Command uses the same verified Discord identity as Main Cognitus. Discord authentication does not grant employment access by itself.</p></div>
        <div class="login-foot"><span>Discord-verified identity</span><span>•</span><span>Firestore-enforced staff access</span></div>
      </div>
      <div class="login-panel-wrap">
        <div class="login-panel">
          <p class="eyebrow">Cognitus Staff</p>
          <h1>Sign in with Discord.</h1>
          <p>Password sign-in is no longer offered. Cognitus verifies your Discord identity, then checks the existing Main Cognitus account and active <code>staffAccess</code> record before opening Command.</p>
          <div id="login-message" class="notice" hidden></div>
          <div class="form-stack">
            <a class="button button-dark" href="${safe(discordOAuthUrl())}">Continue with Discord</a>
            <div class="login-security"><span>✓</span><span>Your staff rank, permissions, termination status, and department access remain enforced after Discord authentication.</span></div>
          </div>
          <div class="login-security"><span>◈</span><span>There is no Staff signup. Staff access must still be provisioned by Cognitus administration.</span></div>
        </div>
      </div>
    </section>`;

  const oauthError = sessionStorage.getItem("cognitusDiscordOAuthError");
  if (oauthError) {
    sessionStorage.removeItem("cognitusDiscordOAuthError");
    showNotice(root.querySelector("#login-message"), oauthError, "error");
  }
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

function terminatedAccountPage() {
  const notice = state.employmentSelf;
  setTitle("Employment Terminated");
  hidePortalChrome();
  root.innerHTML = `<section class="termination-screen"><div class="termination-screen-backdrop"></div><section class="termination-account-modal" role="alertdialog" aria-modal="true" aria-labelledby="terminated-title"><span class="termination-account-mark">!</span><p class="eyebrow">Cognitus Staff / Command</p><h1 id="terminated-title">YOU HAVE BEEN TERMINATED</h1><p>Your employment and access to the Cognitus staff portal have been terminated.</p><dl><div><dt>Effective date</dt><dd>${safe(formatTimestamp(notice.terminatedAt))}</dd></div><div><dt>Reason</dt><dd>${safe(notice.terminationReason || "No reason was provided.")}</dd></div><div><dt>Employee ID</dt><dd>${safe(notice.employeeId || state.directorySelf?.employeeId || "—")}</dd></div></dl><button class="button button-dark" id="terminated-signout" type="button">Acknowledge and Sign Out</button></section></section>`;
  root.querySelector("#terminated-signout")?.addEventListener("click", signOut);
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

function staffAdminEmployeeRow(employee) {
  const department = getDepartment(employee.departmentId);
  const uid = employee.uid || employee.id;
  const canTerminate = isMainOwner()
    && uid !== state.authUser?.uid
    && employee.rank !== "owner"
    && employee.status !== "former";
  const canAddNotice = isMainOwner() && employee.status === "former" && employee.rank !== "owner";
  return `<article class="list-row staff-admin-row"><span class="avatar">${safe(initials(employee.displayName))}</span><span class="list-row-copy"><strong>${safe(employee.displayName || "Unnamed Employee")}</strong><span>${safe(employee.title || getRank(employee.rank).label)}</span><small>${safe(employee.employeeId || "—")} · ${safe(department.shortName)}</small></span><span class="badge ${safe(employee.status)}">${safe(statusLabel(employee.status))}</span><span class="staff-admin-actions"><a class="button button-small" href="#/staff/${encodeURIComponent(uid)}">View</a>${canTerminate ? `<button class="button button-small button-danger" type="button" data-terminate-staff="${safe(uid)}">Terminate</button>` : canAddNotice ? `<button class="button button-small" type="button" data-add-termination-notice="${safe(uid)}">Add Termination Notice</button>` : ""}</span></article>`;
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
  const currentEmployees = state.directory.filter((employee) => employee.status !== "former");
  const formerEmployees = state.directory.filter((employee) => employee.status === "former");
  root.innerHTML = `<div class="page-inner">
    <header class="page-header"><div class="page-header-copy"><p class="eyebrow">Administration</p><h1>Staff administration.</h1><p>Provision an existing Cognitus account for internal staff access. This does not create a new Cognitus user and does not use a separate staff login system.</p></div></header>
    <section class="content-grid">
      <section class="form-card"><p class="eyebrow">Provision employee</p><h2 style="margin:0 0 8px;font-size:20px;letter-spacing:-.035em">Add an existing Cognitus user</h2><p style="margin:0 0 20px;color:#666;font-size:10px;line-height:1.6">Enter the exact Discord ID already attached to the person's Cognitus account.</p><div id="staff-admin-message" class="notice" hidden></div>
        <form id="provision-form" class="form-stack">
          <label>Discord ID<input name="discordId" inputmode="numeric" required></label>
          <div class="form-row"><label>Department<select name="departmentId" required>${DEPARTMENTS.filter((department) => department.id !== "executive-office" || isExecutiveOwner()).map((department) => `<option value="${safe(department.id)}">${safe(department.name)}</option>`).join("")}</select></label><label>Rank<select name="rank" required>${RANKS.filter((rank) => rank.id !== "owner" && (rank.id !== "co-owner" || isExecutiveOwner())).map((rank) => `<option value="${safe(rank.id)}">${safe(rank.label)}</option>`).join("")}</select></label></div>
          <label>Position Title<input name="title" maxlength="100" placeholder="e.g. Customer Service Specialist" required></label>
          <label>Permission Preset<select name="preset" required><option value="staff">Standard Staff</option><option value="supervisor">Supervisor Foundation</option><option value="chief-public-relations">Chief Public Relations Officer</option><option value="chief-customer-service">Chief Customer Service Officer</option><option value="chief-financial-officer">Chief Financial Officer</option><option value="chief-human-resources">Chief Human Resources Officer</option><option value="chief-quality-assurance">Chief Quality Assurance Officer</option>${isExecutiveOwner() ? `<option value="co-owner">Co-Owner — Full Executive Access</option>` : ""}</select></label>
          <label>Status<select name="status"><option value="active">Active</option><option value="training">Training</option><option value="on_leave">On Leave</option></select></label>
          <button class="button button-dark" type="submit">Provision Staff Access</button>
        </form>
      </section>
      <section class="panel"><header class="panel-header"><div><p class="eyebrow">Security model</p><h2>What provisioning creates</h2></div></header><div class="panel-body"><div class="bootstrap-list"><div class="bootstrap-item"><span class="bootstrap-check">1</span><div><strong>staffDirectory</strong><span>Internal-safe profile used by the employee directory.</span></div></div><div class="bootstrap-item"><span class="bootstrap-check">2</span><div><strong>staffAccess</strong><span>Department, rank, staff status, and explicit permissions.</span></div></div><div class="bootstrap-item"><span class="bootstrap-check">3</span><div><strong>staffEmployment</strong><span>Restricted HR/employment record, separate from directory data.</span></div></div></div></div></section>
    </section>
    <section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Current staff</p><h2>${currentEmployees.length} active employee record${currentEmployees.length === 1 ? "" : "s"}</h2></div></header>${currentEmployees.length ? `<div class="list">${currentEmployees.map(staffAdminEmployeeRow).join("")}</div>` : emptyState("SD", "No current staff", "Provision an employee to begin building the active staff directory.")}</section>
    ${isMainOwner() && formerEmployees.length ? `<section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Retained records</p><h2>Former staff</h2></div><span class="badge former">${formerEmployees.length}</span></header><div class="list">${formerEmployees.map(staffAdminEmployeeRow).join("")}</div></section>` : ""}
    ${isMainOwner() ? `<dialog id="termination-dialog" class="termination-dialog"><form id="termination-form" class="form-stack"><input type="hidden" name="uid"><div><p class="eyebrow">Owner action</p><h2>Terminate staff access?</h2><p id="termination-summary">This immediately removes access to Cognitus Staff / Command and marks the employee as former staff.</p></div><div class="termination-warning"><strong>This action takes effect immediately.</strong><span>The directory and employment records will be retained as former-staff records. The staff-access record will be deleted.</span></div><label>Reason for termination<textarea name="reason" minlength="10" maxlength="500" rows="4" required placeholder="Enter an internal audit reason"></textarea></label><label>Type the employee ID to confirm<input name="confirmation" autocomplete="off" required></label><div id="termination-message" class="notice" hidden></div><div class="button-row termination-actions"><button class="button" type="button" data-cancel-termination>Cancel</button><button class="button button-danger" type="submit">Terminate Staff Access</button></div></form></dialog>` : ""}
  </div>`;

  const provisionForm = root.querySelector("#provision-form");
  provisionForm?.addEventListener("submit", provisionStaff);
  provisionForm?.querySelector('[name="rank"]')?.addEventListener("change", (event) => {
    if (event.currentTarget.value !== "co-owner") return;
    const departmentSelect = provisionForm.querySelector('[name="departmentId"]');
    const presetSelect = provisionForm.querySelector('[name="preset"]');
    if (departmentSelect) departmentSelect.value = "executive-office";
    if (presetSelect?.querySelector('option[value="co-owner"]')) presetSelect.value = "co-owner";
  });
  root.querySelectorAll("[data-terminate-staff]").forEach((button) => button.addEventListener("click", () => openTerminationDialog(button.dataset.terminateStaff)));
  root.querySelectorAll("[data-add-termination-notice]").forEach((button) => button.addEventListener("click", () => openTerminationDialog(button.dataset.addTerminationNotice, true)));
  root.querySelector("[data-cancel-termination]")?.addEventListener("click", closeTerminationDialog);
  root.querySelector("#termination-form")?.addEventListener("submit", terminateStaff);
}

async function discordIntegrationPage() {
  setTitle("Discord Integration");
  if (!requireStaff()) return;
  if (!canManageDiscordIntegration()) return forbiddenPage("Discord Integration");
  renderChrome();

  root.innerHTML = `<div class="page-inner">
    <header class="page-header">
      <div class="page-header-copy">
        <p class="eyebrow">Identity & authorization</p>
        <h1>Discord Integration.</h1>
        <p>Connect real Discord role IDs to Cognitus permission templates. Discord can supply safe operational permissions; Cognitus remains authoritative for protected permissions, employment state, and Staff access.</p>
      </div>
      <span class="badge" id="discord-integration-status">Connecting…</span>
    </header>
    <section class="stats-grid" id="discord-integration-stats">
      <article class="stat-card"><span>Server</span><strong style="font-size:16px">Loading…</strong><small>Discord guild connection</small></article>
      <article class="stat-card"><span>Mapped Roles</span><strong>—</strong><small>Saved role mappings</small></article>
      <article class="stat-card"><span>Auto Sync</span><strong>—</strong><small>Runs during Staff sign-in</small></article>
      <article class="stat-card"><span>Sync Mode</span><strong style="font-size:16px">Safe</strong><small>Protected permissions stay Cognitus-only</small></article>
    </section>
    <section class="panel" style="margin-top:18px">
      <header class="panel-header">
        <div><p class="eyebrow">Role mapping center</p><h2>Discord roles → Cognitus authority</h2></div>
        <div class="button-row">
          <button class="button" id="discord-refresh" type="button">Refresh</button>
          <button class="button button-dark" id="discord-save" type="button">Save Mappings</button>
        </div>
      </header>
      <div class="panel-body">
        <div id="discord-integration-message" class="notice" hidden></div>
        <div class="form-row" style="margin-bottom:18px">
          <label class="checkbox-line"><input id="discord-enabled" type="checkbox"> Enable Discord role synchronization</label>
          <label class="checkbox-line"><input id="discord-auto-sync" type="checkbox"> Auto-sync on Staff sign-in</label>
        </div>
        <div id="discord-role-table"></div>
      </div>
    </section>
    <section class="content-grid" style="margin-top:18px">
      <section class="panel">
        <header class="panel-header"><div><p class="eyebrow">Safety</p><h2>Protected authority</h2></div></header>
        <div class="panel-body">
          <p style="margin-top:0;color:#666;line-height:1.7">Discord roles never grant protected Cognitus authority such as <code>permissions.manage</code>, <code>system.manage</code>, <code>staff.provision</code>, <code>staff.manage</code>, <code>payroll.approve</code>, or <code>internalAffairs.manage</code>. Those remain direct Cognitus permissions.</p>
          <p style="color:#666;line-height:1.7">Staff access still requires an existing Cognitus <code>staffAccess</code> record. A Discord role cannot turn an ordinary Cognitus account into an employee.</p>
        </div>
      </section>
      <section class="panel">
        <header class="panel-header"><div><p class="eyebrow">Reconciliation</p><h2>Preview before changing roles</h2></div></header>
        <div class="panel-body">
          <div class="button-row">
            <button class="button" id="discord-preview" type="button">Preview Everyone</button>
            <button class="button button-dark" id="discord-apply" type="button">Apply Safe Changes</button>
          </div>
          <div id="discord-sync-results" style="margin-top:16px;color:#666;font-size:11px;line-height:1.7">No sync has been run in this session.</div>
        </div>
      </section>
    </section>
  </div>`;

  let integration = null;
  const roleTable = root.querySelector("#discord-role-table");
  const message = root.querySelector("#discord-integration-message");
  const statusBadge = root.querySelector("#discord-integration-status");
  const stats = root.querySelector("#discord-integration-stats");

  const renderSyncResults = (payload) => {
    const target = root.querySelector("#discord-sync-results");
    const rows = Array.isArray(payload?.results) ? payload.results : [];
    if (!rows.length) {
      target.innerHTML = `<strong>No staff records required changes.</strong><br>${safe(payload?.message || "Everything Cognitus could evaluate is already synchronized.")}`;
      return;
    }
    target.innerHTML = `<div class="list">${rows.slice(0, 50).map((item) => `
      <article class="list-row">
        <span class="avatar">${safe(initials(item.displayName || item.discordUsername || "DI"))}</span>
        <span class="list-row-copy">
          <strong>${safe(item.displayName || item.discordUsername || item.uid || "Staff member")}</strong>
          <span>${safe(item.summary || item.status || "Sync evaluated")}</span>
          <small>${safe((item.addRoles || []).length)} role(s) to add · ${safe((item.removeRoles || []).length)} role(s) to remove · ${safe((item.managedPermissions || []).length)} Discord-managed permission(s)</small>
        </span>
        <span class="badge ${item.error ? "former" : item.changed ? "active" : ""}">${item.error ? "Review" : item.changed ? "Change" : "In Sync"}</span>
      </article>`).join("")}</div>`;
  };

  const renderIntegration = (data) => {
    integration = data;
    const configured = Boolean(data?.configured);
    statusBadge.className = `badge ${configured ? "active" : "former"}`;
    statusBadge.textContent = configured ? "Connected" : "Setup required";
    const mappings = Array.isArray(data?.config?.mappings) ? data.config.mappings : [];
    stats.innerHTML = `
      <article class="stat-card"><span>Server</span><strong style="font-size:16px;line-height:1.2">${safe(data?.guild?.name || "Not configured")}</strong><small>${configured ? "Discord guild connected" : "Add the Worker secrets below"}</small></article>
      <article class="stat-card"><span>Mapped Roles</span><strong>${mappings.length}</strong><small>Saved role mappings</small></article>
      <article class="stat-card"><span>Auto Sync</span><strong>${data?.config?.autoSyncOnLogin ? "On" : "Off"}</strong><small>Runs during Staff sign-in</small></article>
      <article class="stat-card"><span>Sync Mode</span><strong style="font-size:16px">Safe</strong><small>Protected permissions stay Cognitus-only</small></article>`;

    root.querySelector("#discord-enabled").checked = data?.config?.enabled !== false;
    root.querySelector("#discord-auto-sync").checked = Boolean(data?.config?.autoSyncOnLogin);

    if (!configured) {
      roleTable.innerHTML = `<div class="notice notice-error">Discord bot connection required. Add <code>DISCORD_BOT_TOKEN</code> as a Cloudflare Secret and <code>COGNITUS_GUILD_ID</code> as a Worker variable, then refresh this page.</div>`;
      return;
    }

    const templates = Array.isArray(data.templates) ? data.templates : [];
    const savedByRole = new Map(mappings.map((mapping) => [String(mapping.roleId), mapping]));
    const roles = (data.roles || []).filter((role) => role.name !== "@everyone");

    roleTable.innerHTML = `<div class="directory-table-wrap"><table class="directory-table">
      <thead><tr><th>Discord Role</th><th>Cognitus Template</th><th>Direction</th><th>Status</th></tr></thead>
      <tbody>${roles.map((role) => {
        const saved = savedByRole.get(String(role.id));
        const templateKey = saved?.templateKey || role.suggestedTemplate || "ignore";
        const direction = saved?.direction || role.suggestedDirection || "display";
        const disabled = role.managed ? "disabled" : "";
        return `<tr data-discord-role="${safe(role.id)}" data-role-name="${safe(role.name)}">
          <td><strong>${safe(role.name)}</strong><br><small style="color:#777">${safe(role.id)}</small></td>
          <td><select data-role-template ${disabled}>${templates.map((template) => `<option value="${safe(template.key)}" ${template.key === templateKey ? "selected" : ""}>${safe(template.label)}</option>`).join("")}</select></td>
          <td><select data-role-direction ${disabled}>
            <option value="display" ${direction === "display" ? "selected" : ""}>Display only</option>
            <option value="discord_to_cognitus" ${direction === "discord_to_cognitus" ? "selected" : ""}>Discord → Cognitus</option>
            <option value="cognitus_to_discord" ${direction === "cognitus_to_discord" ? "selected" : ""}>Cognitus → Discord</option>
            <option value="bidirectional" ${direction === "bidirectional" ? "selected" : ""}>Bidirectional</option>
          </select></td>
          <td><span class="badge ${role.managed ? "former" : saved ? "active" : ""}">${role.managed ? "Bot managed" : saved ? "Saved" : role.suggestedTemplate && role.suggestedTemplate !== "ignore" ? "Suggested" : "Ignored"}</span></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  };

  const refresh = async () => {
    try {
      showNotice(message, "Loading Discord server and role mappings…", "success");
      renderIntegration(await discordAdminApi("/discord-admin/status"));
      message.hidden = true;
    } catch (error) {
      renderIntegration({ configured: false, roles: [], templates: [], config: {} });
      showNotice(message, error?.message || "Discord integration could not be loaded.", "error");
    }
  };

  root.querySelector("#discord-refresh")?.addEventListener("click", refresh);
  root.querySelector("#discord-save")?.addEventListener("click", async () => {
    try {
      const mappings = [...root.querySelectorAll("[data-discord-role]")].map((row) => ({
        roleId: row.dataset.discordRole,
        roleName: row.dataset.roleName,
        templateKey: row.querySelector("[data-role-template]")?.value || "ignore",
        direction: row.querySelector("[data-role-direction]")?.value || "display",
        enabled: !row.querySelector("[data-role-template]")?.disabled
      })).filter((mapping) => mapping.enabled && mapping.templateKey !== "ignore");
      const payload = await discordAdminApi("/discord-admin/config", {
        method: "POST",
        body: {
          enabled: root.querySelector("#discord-enabled").checked,
          autoSyncOnLogin: root.querySelector("#discord-auto-sync").checked,
          mappings
        }
      });
      showNotice(message, `Saved ${payload.config?.mappings?.length || 0} Discord role mappings.`, "success");
      await refresh();
    } catch (error) {
      showNotice(message, error?.message || "Role mappings could not be saved.", "error");
    }
  });

  const runSync = async (apply) => {
    const target = root.querySelector("#discord-sync-results");
    target.textContent = apply ? "Applying Discord/Cognitus changes…" : "Building a safe sync preview…";
    try {
      const payload = await discordAdminApi("/discord-admin/sync-all", {
        method: "POST",
        body: { apply }
      });
      renderSyncResults(payload);
      if (apply) {
        await refreshIdentity();
        renderChrome();
      }
    } catch (error) {
      target.innerHTML = `<span style="color:#a33">${safe(error?.message || "Discord sync failed.")}</span>`;
    }
  };

  root.querySelector("#discord-preview")?.addEventListener("click", () => runSync(false));
  root.querySelector("#discord-apply")?.addEventListener("click", () => runSync(true));

  await refresh();
}


function openTerminationDialog(uid, noticeOnly = false) {
  if (!isMainOwner()) return;
  const employee = state.directory.find((entry) => (entry.uid || entry.id) === uid);
  if (!employee || uid === state.authUser?.uid || employee.rank === "owner" || (noticeOnly ? employee.status !== "former" : employee.status === "former")) {
    return showToast("This staff record cannot be terminated.");
  }
  const dialog = root.querySelector("#termination-dialog");
  const form = root.querySelector("#termination-form");
  form.reset();
  form.elements.uid.value = uid;
  form.dataset.employeeId = employee.employeeId || "";
  form.dataset.noticeOnly = noticeOnly ? "true" : "false";
  root.querySelector("#termination-summary").textContent = noticeOnly
    ? `Add the reason and effective date notice shown when ${employee.displayName || "this former employee"} attempts to sign in.`
    : `Terminate ${employee.displayName || "this employee"}'s staff access and mark ${employee.employeeId || "their record"} as former staff.`;
  dialog.showModal();
  form.elements.reason.focus();
}

function closeTerminationDialog() {
  root.querySelector("#termination-dialog")?.close();
}

async function terminateStaff(event) {
  event.preventDefault();
  if (!isMainOwner()) return;
  const form = event.currentTarget;
  const data = formObject(form);
  const message = form.querySelector("#termination-message");
  const button = form.querySelector('button[type="submit"]');
  const uid = clean(data.uid);
  const employeeId = clean(form.dataset.employeeId);
  const noticeOnly = form.dataset.noticeOnly === "true";
  const reason = clean(data.reason).slice(0, 500);
  if (!uid || uid === state.authUser?.uid) return showNotice(message, "You cannot terminate your own staff access.", "error");
  if (!employeeId || clean(data.confirmation) !== employeeId) return showNotice(message, `Type ${employeeId || "the employee ID"} exactly to confirm.`, "error");
  if (reason.length < 10) return showNotice(message, "Enter a termination reason of at least 10 characters.", "error");

  try {
    setBusy(button, true, "Terminating…", "Terminate Staff Access");
    const [directory, access, employment] = await Promise.all([
      readDoc("staffDirectory", uid),
      readDoc("staffAccess", uid),
      readDoc("staffEmployment", uid)
    ]);
    if (!directory || !employment || (!noticeOnly && !access)) return showNotice(message, "Termination stopped because one or more required staff records are missing.", "error");
    if (directory.rank === "owner" || access?.rank === "owner") return showNotice(message, "An Owner account cannot be terminated from this page.", "error");
    if (noticeOnly && (directory.status !== "former" || access)) return showNotice(message, "This account is not eligible for a former-staff notice.", "error");
    if (!noticeOnly && directory.status === "former") return showNotice(message, "This employee is already marked as former staff.", "error");
    if (employment.terminationReason || employment.terminatedAt) return showNotice(message, "A termination notice already exists for this employee.", "error");

    const now = Fire.serverTimestamp();
    const batchWriter = writeBatch();
    if (!noticeOnly) {
      batchWriter.update(Fire.doc(db, "staffDirectory", uid), { status: "former", updatedAt: now });
      batchWriter.delete(Fire.doc(db, "staffAccess", uid));
    }
    batchWriter.update(Fire.doc(db, "staffEmployment", uid), { employmentStatus: "former", terminationReason: reason, terminatedByUid: state.authUser.uid, terminatedAt: now, updatedAt: now });
    await batchWriter.commit();
    await writeActivity("STAFF_TERMINATED", "staff", uid, `Terminated staff access for ${directory.displayName || employeeId}.`, { employeeId, reason });
    if (!noticeOnly) {
      await syncDiscordStaff(uid, true).catch((syncError) => console.warn("Discord role cleanup failed", syncError));
    }
    closeTerminationDialog();
    state.directoryLoaded = false;
    await staffAdminPage();
    showToast(noticeOnly ? "Termination notice added." : "Staff access terminated.");
  } catch (error) {
    console.error(error);
    showNotice(message, error?.code === "permission-denied" ? "Firestore denied the termination. Only the active Cognitus Owner can perform this action." : "The termination could not be completed. No partial change was applied.", "error");
  } finally {
    setBusy(button, false, "Terminating…", "Terminate Staff Access");
  }
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
  if (data.rank === "co-owner" && !isExecutiveOwner()) return showNotice(message, "Only an Owner or Co-Owner can appoint another Co-Owner.", "error");
  if (data.rank === "co-owner" && data.departmentId !== "executive-office") return showNotice(message, "Co-Owners must be assigned to the Executive Office.", "error");
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
    const permissions = bundle(data.rank === "co-owner" ? "co-owner" : data.preset);
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
    await syncDiscordStaff(user.uid, true).catch((syncError) => console.warn("Discord role provisioning sync failed", syncError));
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
    ...(can(PERMISSIONS.DEPARTMENT_READ) ? [{ type: "Page", title: "Departments", subtitle: "Cognitus company structure", href: "#/departments" }] : []),
    ...(canManageDiscordIntegration() ? [{ type: "Page", title: "Discord Integration", subtitle: "Role mapping and permission synchronization", href: "#/admin/discord" }] : [])
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
  if (current === "/login") {
    location.hash = "#/dashboard";
    return;
  }
  if (!state.userRecord) return accessDeniedPage("Cognitus account unavailable", "No Cognitus account record is associated with this authenticated session.");
  if (!state.staffAccess) {
    if (state.employmentSelf?.employmentStatus === "former" && state.employmentSelf?.terminatedAt) return terminatedAccountPage();
    return isMainOwner() ? ownerBootstrapPage() : accessDeniedPage("Staff access required", "This Cognitus account has not been provisioned for the internal portal.");
  }
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
  if (current === "/admin/discord") return discordIntegrationPage();
  if (EXTENSION_ROUTES.has(current)) return;
  return notFoundPage("Page not found", "The requested Cognitus Command route does not exist.");
}

async function start() {
  try {
    const services = await initializeFirebase();
    ({ auth, db, Auth, Fire } = services);
    await completeDiscordOAuthIfPresent();
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
