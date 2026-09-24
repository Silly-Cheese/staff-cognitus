import { initializeFirebase, readDoc, readCollection, newFirestoreDoc } from "./firebase.js";
import { route, safe, clean, formatTimestamp, createCognitusId } from "./utils.js";

const BUILD = "account-badges-v1-2026-09-24";
const BADGE_ROUTE = "/account-badges";
const root = document.querySelector("#page-root");
const sidebar = document.querySelector("#sidebar");
const state = {
  auth: null, db: null, Auth: null, Fire: null, user: null, staff: null,
  badges: [], assignments: [], users: [], editingId: null, rendering: false
};

const STARTER_BADGES = [
  { key:"beta-tester", name:"Beta Tester", icon:"🧪", description:"Helped test Cognitus features before public release.", category:"contributor", visibility:"public", accent:"violet" },
  { key:"contributor", name:"Contributor", icon:"🛠️", description:"Directly contributed work that improved Cognitus.", category:"contributor", visibility:"public", accent:"blue" },
  { key:"bug-hunter", name:"Bug Hunter", icon:"🐛", description:"Reported a significant issue that helped make Cognitus better.", category:"recognition", visibility:"public", accent:"green" },
  { key:"early-supporter", name:"Early Supporter", icon:"⭐", description:"Supported Cognitus during an early stage of its development.", category:"legacy", visibility:"public", accent:"gold" },
  { key:"feature-contributor", name:"Feature Contributor", icon:"💡", description:"Suggested or shaped a feature that became part of Cognitus.", category:"contributor", visibility:"public", accent:"amber" },
  { key:"design-contributor", name:"Design Contributor", icon:"🎨", description:"Contributed to Cognitus design, graphics, or interface work.", category:"contributor", visibility:"public", accent:"rose" },
  { key:"founding-member", name:"Founding Member", icon:"👑", description:"Recognized as part of Cognitus's founding history.", category:"legacy", visibility:"public", accent:"gold" },
  { key:"golden-mug", name:"Golden Mug", icon:"☕", description:"Recognition connected to The Golden Mug community and its support of Cognitus.", category:"legacy", visibility:"public", accent:"amber" },
  { key:"staff-alumni", name:"Staff Alumni", icon:"🛡️", description:"Former Cognitus staff member recognized in good standing.", category:"service", visibility:"public", accent:"slate" },
  { key:"executive-recognition", name:"Executive Recognition", icon:"🎖️", description:"Special recognition issued by Cognitus executive leadership.", category:"recognition", visibility:"public", accent:"red" }
];

function isManager() {
  if (state.user?.status !== "active") return false;
  if (state.user?.role === "owner") return true;
  if (!state.staff || !["active","training","on_leave"].includes(state.staff.status)) return false;
  if (state.staff.rank === "co-owner") return true;
  const denied = new Set(Array.isArray(state.staff.deniedPermissions) ? state.staff.deniedPermissions : []);
  return Array.isArray(state.staff.permissions) && state.staff.permissions.includes("system.manage") && !denied.has("system.manage");
}

function isStaff() {
  return Boolean(state.user?.status === "active" && (state.user?.role === "owner" || (state.staff && ["active","training","on_leave"].includes(state.staff.status))));
}

function stamp(value) {
  return value ? formatTimestamp(value) : "—";
}

function dateInput(value) {
  if (!value) return "";
  try {
    const d = value?.toDate?.() || new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,16);
  } catch { return ""; }
}

function activeAssignment(item) {
  if (item.revoked === true || item.status === "revoked") return false;
  if (!item.expiresAt) return true;
  try {
    const d = item.expiresAt?.toDate?.() || new Date(item.expiresAt);
    return d.getTime() > Date.now();
  } catch { return false; }
}

function badgeById(id) {
  return state.badges.find((item) => item.id === id);
}

function userById(uid) {
  return state.users.find((item) => (item.uid || item.id) === uid);
}

function injectStyles() {
  if (document.querySelector("#account-badges-v1-css")) return;
  const link = document.createElement("link");
  link.id = "account-badges-v1-css";
  link.rel = "stylesheet";
  link.href = "./account-badges-v1.css?v=20260924-v1";
  document.head.appendChild(link);
}

function registryMarkersFor(uid) {
  const items = state.assignments
    .filter((item) => item.userUid === uid && activeAssignment(item))
    .map((assignment) => ({ assignment, badge: badgeById(assignment.badgeId) }))
    .filter((item) => item.badge && item.badge.active !== false)
    .sort((a,b) => (b.assignment.featured === true ? 1 : 0) - (a.assignment.featured === true ? 1 : 0));
  if (!items.length) return "";
  const visible = items.slice(0,4).map((item) => '<span class="ab-registry-marker ab-accent-' + safe(item.badge.accent || "slate") + '" title="' + safe((item.badge.name || "Badge") + (item.badge.description ? " — " + item.badge.description : "")) + '">' + safe(item.badge.icon || "◆") + '</span>').join("");
  return '<span class="ab-registry-markers" data-ab-registry-markers>' + visible + (items.length > 4 ? '<span class="ab-registry-more">+' + (items.length - 4) + '</span>' : '') + '</span>';
}

function augmentRegistryRows() {
  if (route() !== "/executive/accounts" || !isManager()) return;
  document.querySelectorAll(".registry-row").forEach((row) => {
    if (row.querySelector("[data-ab-registry-markers]")) return;
    const open = row.querySelector("[data-open-account]");
    const name = row.querySelector(".registry-name");
    const uid = open?.dataset?.openAccount;
    if (!uid || !name) return;
    const html = registryMarkersFor(uid);
    if (!html) return;
    name.insertAdjacentHTML("beforeend", html);
  });
}

function augmentNav() {
  if (!sidebar || !isManager()) return;
  if (sidebar.querySelector("[data-account-badge-nav]")) return;
  const section = document.createElement("section");
  section.className = "sidebar-group ab-nav-group";
  section.dataset.accountBadgeNav = "true";
  section.innerHTML = '<span class="sidebar-label">Recognition</span><a class="sidebar-link ' + (route() === BADGE_ROUTE ? 'active' : '') + '" href="#/account-badges"><span class="sidebar-link-icon">🧪</span><span>Account Badges</span></a>';
  sidebar.appendChild(section);
}

function setTitle() {
  document.title = "Account Badges · Cognitus Staff / Command";
}

async function writeAudit(action, targetType, targetId, summary, metadata = {}) {
  if (!state.auth?.currentUser || !state.user?.cognitusId) return;
  try {
    const ref = newFirestoreDoc("auditLogs");
    await state.Fire.setDoc(ref, {
      id: ref.id,
      cognitusId: createCognitusId("AUD"),
      actorUid: state.auth.currentUser.uid,
      actorCognitusId: state.user.cognitusId,
      actorRole: state.user.role,
      action,
      targetType,
      targetId,
      summary: clean(summary).slice(0,500),
      metadata,
      createdAt: state.Fire.serverTimestamp()
    });
  } catch (error) {
    console.warn("Account badge audit write unavailable", error);
  }
}

async function refreshData() {
  const [badges, assignments, users] = await Promise.all([
    readCollection("accountBadges").catch(() => []),
    readCollection("accountBadgeAssignments").catch(() => []),
    readCollection("users").catch(() => [])
  ]);
  state.badges = badges.sort((a,b) => String(a.name || "").localeCompare(String(b.name || "")));
  state.assignments = assignments.sort((a,b) => {
    const am = a.awardedAt?.toMillis?.() || 0;
    const bm = b.awardedAt?.toMillis?.() || 0;
    return bm - am;
  });
  state.users = users.sort((a,b) => String(a.displayName || a.discordUsername || "").localeCompare(String(b.displayName || b.discordUsername || "")));
}

function markerPreview(badge) {
  return '<span class="ab-marker ab-accent-' + safe(badge.accent || "slate") + '" title="' + safe(badge.name || "Badge") + '"><span class="ab-marker-icon">' + safe(badge.icon || "◆") + '</span><span>' + safe(badge.name || "Badge") + '</span></span>';
}

function badgeLibraryHtml() {
  if (!state.badges.length) return '<div class="empty-state"><span class="empty-state-icon">🧪</span><h3>No account badges yet</h3><p>Create one or install the Cognitus starter set.</p></div>';
  return '<div class="ab-library">' + state.badges.map((badge) => {
    const count = state.assignments.filter((item) => item.badgeId === badge.id && activeAssignment(item)).length;
    return '<article class="ab-badge-card ' + (badge.active === false ? 'is-inactive' : '') + '">' +
      '<div class="ab-badge-card-head">' + markerPreview(badge) + '<span class="badge">' + safe(badge.visibility || "public") + '</span></div>' +
      '<p>' + safe(badge.description || "No description.") + '</p>' +
      '<div class="ab-badge-meta"><span>' + safe(badge.category || "recognition") + '</span><span>' + count + ' active assignment' + (count === 1 ? '' : 's') + '</span><span>' + (badge.active === false ? 'Archived' : 'Active') + '</span></div>' +
      '<div class="button-row"><button class="button button-small" type="button" data-edit-badge="' + safe(badge.id) + '">Edit</button><button class="button button-small" type="button" data-toggle-badge="' + safe(badge.id) + '">' + (badge.active === false ? 'Restore' : 'Archive') + '</button></div>' +
      '</article>';
  }).join("") + '</div>';
}

function assignmentHtml() {
  if (!state.assignments.length) return '<div class="empty-state"><span class="empty-state-icon">★</span><h3>No badges awarded yet</h3><p>Award a marker to a Cognitus account to start its recognition history.</p></div>';
  return '<div class="ab-assignment-list">' + state.assignments.slice(0,80).map((item) => {
    const badge = badgeById(item.badgeId) || {name:item.badgeName || "Unknown badge", icon:item.badgeIcon || "◆", accent:"slate"};
    const user = userById(item.userUid);
    const live = activeAssignment(item);
    return '<article class="ab-assignment ' + (live ? '' : 'is-revoked') + '">' +
      '<div class="ab-assignment-icon">' + safe(badge.icon || "◆") + '</div>' +
      '<div class="ab-assignment-copy"><strong>' + safe(user?.displayName || user?.discordUsername || item.userDisplayName || item.userUid) + '</strong><span>' + safe(badge.name || "Badge") + '</span><small>Awarded ' + safe(stamp(item.awardedAt || item.createdAt)) + (item.reason ? ' · ' + safe(item.reason) : '') + '</small>' +
      (!live ? '<small class="ab-revoked-copy">' + (item.revoked ? 'Revoked ' + safe(stamp(item.revokedAt)) : 'Expired') + (item.revocationReason ? ' · ' + safe(item.revocationReason) : '') + '</small>' : '') + '</div>' +
      '<div class="ab-assignment-actions"><span class="badge">' + (live ? 'active' : 'history') + '</span>' + (live ? '<button class="button button-small" type="button" data-revoke-assignment="' + safe(item.id) + '">Revoke</button>' : '') + '</div>' +
      '</article>';
  }).join("") + '</div>';
}

function accountOptions() {
  return state.users.map((user) => {
    const uid = user.uid || user.id;
    const label = (user.displayName || user.discordUsername || "Cognitus User") + " · " + (user.cognitusId || uid);
    return '<option value="' + safe(uid) + '">' + safe(label) + '</option>';
  }).join("");
}

function badgeOptions() {
  return state.badges.filter((item) => item.active !== false).map((badge) => '<option value="' + safe(badge.id) + '">' + safe((badge.icon || "◆") + " " + (badge.name || "Badge")) + '</option>').join("");
}

function render() {
  if (route() !== BADGE_ROUTE || !root || state.rendering) return;
  state.rendering = true;
  setTitle();
  if (!isManager()) {
    root.innerHTML = '<div class="page-inner"><section class="access-shell"><div class="access-panel"><span class="access-mark">!</span><p class="eyebrow">Cognitus Recognition</p><h1>Executive access required.</h1><p>Account badge creation and assignment is limited to authorized Cognitus executive administration.</p><a class="button button-dark" href="#/dashboard">Return to Dashboard</a></div></section></div>';
    state.rendering = false;
    return;
  }

  const activeAssignments = state.assignments.filter(activeAssignment);
  const uniqueRecipients = new Set(activeAssignments.map((item) => item.userUid)).size;
  root.innerHTML = '<div class="page-inner ab-page" data-account-badges-v1="' + BUILD + '">' +
    '<header class="page-header ab-page-header"><div class="page-header-copy"><p class="eyebrow">Executive · Recognition</p><h1>Account Badges</h1><p>Give Cognitus accounts small permanent markers for the things they have done for the organization. Badges are recognition, not permissions.</p></div><div class="button-row"><button class="button" id="ab-starter" type="button">Install Starter Set</button><a class="button button-dark" href="#/executive/accounts">Account Registry</a></div></header>' +
    '<section class="g3-kpi ab-kpi"><article><span>Badge Designs</span><strong>' + state.badges.length + '</strong></article><article><span>Active Awards</span><strong>' + activeAssignments.length + '</strong></article><article><span>Recognized Accounts</span><strong>' + uniqueRecipients + '</strong></article><article><span>History Records</span><strong>' + state.assignments.length + '</strong></article></section>' +
    '<section class="ab-grid">' +
      '<section class="panel"><header class="panel-header"><div><p class="eyebrow">Badge Studio</p><h2 id="ab-form-title">' + (state.editingId ? 'Edit badge' : 'Create badge') + '</h2></div></header><div id="ab-badge-message" class="notice" hidden></div>' +
        '<form id="ab-badge-form" class="form-stack"><div class="ab-preview" id="ab-preview"></div>' +
          '<div class="form-row"><label>Name<input name="name" maxlength="48" required placeholder="Beta Tester"></label><label>Marker / emoji<input name="icon" maxlength="12" required placeholder="🧪"></label></div>' +
          '<label>Description<textarea name="description" maxlength="300" rows="3" required placeholder="Helped test Cognitus features before public release."></textarea></label>' +
          '<div class="form-row"><label>Category<select name="category"><option value="recognition">Recognition</option><option value="contributor">Contributor</option><option value="service">Service</option><option value="legacy">Legacy</option><option value="other">Other</option></select></label><label>Visibility<select name="visibility"><option value="public">Public account marker</option><option value="staff">Staff-only marker</option></select></label></div>' +
          '<div class="form-row"><label>Accent<select name="accent"><option value="violet">Violet</option><option value="blue">Blue</option><option value="green">Green</option><option value="gold">Gold</option><option value="amber">Amber</option><option value="rose">Rose</option><option value="red">Red</option><option value="slate">Slate</option></select></label><label class="ab-check"><input type="checkbox" name="active" checked><span><strong>Active</strong><small>Can currently be awarded and displayed.</small></span></label></div>' +
          '<div class="button-row"><button class="button button-dark" type="submit">' + (state.editingId ? 'Save Changes' : 'Create Badge') + '</button>' + (state.editingId ? '<button class="button" id="ab-cancel-edit" type="button">Cancel</button>' : '') + '</div>' +
        '</form></section>' +
      '<section class="panel"><header class="panel-header"><div><p class="eyebrow">Award Marker</p><h2>Recognize an account</h2></div></header><div id="ab-award-message" class="notice" hidden></div>' +
        '<form id="ab-award-form" class="form-stack"><label>Account<select name="userUid" required><option value="">Choose an account</option>' + accountOptions() + '</select></label><label>Badge<select name="badgeId" required><option value="">Choose a badge</option>' + badgeOptions() + '</select></label><label>Reason / recognition note<textarea name="reason" maxlength="500" rows="3" placeholder="Participated in pre-release testing of the Staff Portal."></textarea></label><div class="form-row"><label>Expiration (optional)<input name="expiresAt" type="datetime-local"></label><label class="ab-check"><input type="checkbox" name="featured" checked><span><strong>Featured</strong><small>Prioritize this marker in compact account displays.</small></span></label></div><button class="button button-dark" type="submit">Award Badge</button></form>' +
      '</section>' +
    '</section>' +
    '<section class="panel ab-section"><header class="panel-header"><div><p class="eyebrow">Badge Library</p><h2>Recognition markers</h2></div><input id="ab-library-search" class="ab-search" type="search" placeholder="Search badges…"></header><div id="ab-library-host">' + badgeLibraryHtml() + '</div></section>' +
    '<section class="panel ab-section"><header class="panel-header"><div><p class="eyebrow">History</p><h2>Award & revocation history</h2></div><input id="ab-assignment-search" class="ab-search" type="search" placeholder="Search people or badges…"></header><div id="ab-assignment-host">' + assignmentHtml() + '</div></section>' +
  '</div>';

  bind();
  state.rendering = false;
}

function showMessage(id, message, tone) {
  const el = root.querySelector(id);
  if (!el) return;
  el.hidden = false;
  el.className = "notice notice-" + (tone || "neutral");
  el.textContent = message;
}

function updatePreview() {
  const form = root.querySelector("#ab-badge-form");
  const host = root.querySelector("#ab-preview");
  if (!form || !host) return;
  const data = Object.fromEntries(new FormData(form).entries());
  host.innerHTML = markerPreview({ name:data.name || "Badge Preview", icon:data.icon || "◆", accent:data.accent || "slate" });
}

function fillEditForm(id) {
  const badge = badgeById(id);
  const form = root.querySelector("#ab-badge-form");
  if (!badge || !form) return;
  state.editingId = id;
  form.elements.name.value = badge.name || "";
  form.elements.icon.value = badge.icon || "";
  form.elements.description.value = badge.description || "";
  form.elements.category.value = badge.category || "recognition";
  form.elements.visibility.value = badge.visibility || "public";
  form.elements.accent.value = badge.accent || "slate";
  form.elements.active.checked = badge.active !== false;
  root.querySelector("#ab-form-title").textContent = "Edit badge";
  form.querySelector('button[type="submit"]').textContent = "Save Changes";
  if (!root.querySelector("#ab-cancel-edit")) {
    const cancel = document.createElement("button");
    cancel.className = "button";
    cancel.type = "button";
    cancel.id = "ab-cancel-edit";
    cancel.textContent = "Cancel";
    form.querySelector(".button-row").appendChild(cancel);
    cancel.addEventListener("click", async () => { state.editingId = null; renderFresh(); });
  }
  updatePreview();
  form.scrollIntoView({behavior:"smooth", block:"start"});
}

async function saveBadge(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const name = clean(data.name).slice(0,48);
  const icon = clean(data.icon).slice(0,12);
  const description = clean(data.description).slice(0,300);
  if (!name || !icon || !description) return showMessage("#ab-badge-message", "Name, marker, and description are required.", "error");
  const now = state.Fire.serverTimestamp();
  try {
    if (state.editingId) {
      const ref = state.Fire.doc(state.db, "accountBadges", state.editingId);
      await state.Fire.updateDoc(ref, {
        name, icon, description,
        category: clean(data.category) || "recognition",
        visibility: clean(data.visibility) || "public",
        accent: clean(data.accent) || "slate",
        active: form.elements.active.checked,
        updatedAt: now,
        updatedByUid: state.auth.currentUser.uid
      });
      await writeAudit("ACCOUNT_BADGE_UPDATED", "accountBadge", state.editingId, "Updated account badge " + name + ".");
    } else {
      const ref = newFirestoreDoc("accountBadges");
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48) || ref.id.toLowerCase();
      await state.Fire.setDoc(ref, {
        id: ref.id, key, name, icon, description,
        category: clean(data.category) || "recognition",
        visibility: clean(data.visibility) || "public",
        accent: clean(data.accent) || "slate",
        active: form.elements.active.checked,
        createdByUid: state.auth.currentUser.uid,
        updatedByUid: state.auth.currentUser.uid,
        createdAt: now, updatedAt: now
      });
      await writeAudit("ACCOUNT_BADGE_CREATED", "accountBadge", ref.id, "Created account badge " + name + ".");
    }
    state.editingId = null;
    await renderFresh();
  } catch (error) {
    showMessage("#ab-badge-message", error?.message || "Badge could not be saved.", "error");
  }
}

async function awardBadge(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const user = userById(data.userUid);
  const badge = badgeById(data.badgeId);
  if (!user || !badge) return showMessage("#ab-award-message", "Choose a valid account and badge.", "error");
  const duplicate = state.assignments.find((item) => item.userUid === data.userUid && item.badgeId === data.badgeId && activeAssignment(item));
  if (duplicate) return showMessage("#ab-award-message", "That account already has this active badge.", "error");
  let expiresAt = null;
  if (clean(data.expiresAt)) {
    const d = new Date(data.expiresAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return showMessage("#ab-award-message", "Expiration must be a future date and time.", "error");
    expiresAt = state.Fire.Timestamp.fromDate(d);
  }
  try {
    const ref = newFirestoreDoc("accountBadgeAssignments");
    const now = state.Fire.serverTimestamp();
    const uid = user.uid || user.id;
    await state.Fire.setDoc(ref, {
      id: ref.id,
      userUid: uid,
      userDisplayName: user.displayName || user.discordUsername || "Cognitus User",
      userCognitusId: user.cognitusId || "",
      badgeId: badge.id,
      badgeName: badge.name,
      badgeIcon: badge.icon,
      reason: clean(data.reason).slice(0,500),
      featured: form.elements.featured.checked,
      status: "active",
      expiresAt,
      revoked: false,
      revokedAt: null,
      revokedByUid: null,
      revocationReason: "",
      awardedByUid: state.auth.currentUser.uid,
      awardedAt: now,
      createdAt: now,
      updatedAt: now
    });
    await writeAudit("ACCOUNT_BADGE_AWARDED", "accountBadgeAssignment", ref.id, "Awarded " + badge.name + " to " + (user.displayName || user.discordUsername || uid) + ".", {userUid:uid,badgeId:badge.id});
    await renderFresh();
  } catch (error) {
    showMessage("#ab-award-message", error?.message || "Badge could not be awarded.", "error");
  }
}

async function revokeAssignment(id) {
  const item = state.assignments.find((entry) => entry.id === id);
  if (!item || !activeAssignment(item)) return;
  const badge = badgeById(item.badgeId);
  const reason = window.prompt("Why is this badge being revoked? This will remain in the account history.", "");
  if (reason === null) return;
  if (!clean(reason)) return window.alert("A revocation reason is required.");
  try {
    await state.Fire.updateDoc(state.Fire.doc(state.db, "accountBadgeAssignments", id), {
      status: "revoked",
      revoked: true,
      revokedAt: state.Fire.serverTimestamp(),
      revokedByUid: state.auth.currentUser.uid,
      revocationReason: clean(reason).slice(0,500),
      updatedAt: state.Fire.serverTimestamp()
    });
    await writeAudit("ACCOUNT_BADGE_REVOKED", "accountBadgeAssignment", id, "Revoked " + (badge?.name || item.badgeName || "account badge") + " from " + (item.userDisplayName || item.userUid) + ".", {userUid:item.userUid,badgeId:item.badgeId});
    await renderFresh();
  } catch (error) {
    window.alert(error?.message || "Badge could not be revoked.");
  }
}

async function toggleBadge(id) {
  const badge = badgeById(id);
  if (!badge) return;
  try {
    await state.Fire.updateDoc(state.Fire.doc(state.db, "accountBadges", id), {
      active: badge.active === false,
      updatedByUid: state.auth.currentUser.uid,
      updatedAt: state.Fire.serverTimestamp()
    });
    await writeAudit(badge.active === false ? "ACCOUNT_BADGE_RESTORED" : "ACCOUNT_BADGE_ARCHIVED", "accountBadge", id, (badge.active === false ? "Restored " : "Archived ") + badge.name + ".");
    await renderFresh();
  } catch (error) {
    window.alert(error?.message || "Badge status could not be changed.");
  }
}

async function installStarterSet() {
  const existingKeys = new Set(state.badges.map((item) => item.key));
  const missing = STARTER_BADGES.filter((item) => !existingKeys.has(item.key));
  if (!missing.length) return window.alert("The Cognitus starter badge set is already installed.");
  if (!window.confirm("Install " + missing.length + " recommended Cognitus account badges?")) return;
  try {
    const batch = state.Fire.writeBatch(state.db);
    const now = state.Fire.serverTimestamp();
    missing.forEach((item) => {
      const ref = state.Fire.doc(state.Fire.collection(state.db, "accountBadges"));
      batch.set(ref, {
        id: ref.id, ...item, active:true,
        createdByUid:state.auth.currentUser.uid,
        updatedByUid:state.auth.currentUser.uid,
        createdAt:now, updatedAt:now
      });
    });
    await batch.commit();
    await writeAudit("ACCOUNT_BADGE_STARTER_SET_INSTALLED", "accountBadge", "starter-set", "Installed the Cognitus starter account badge set.", {count:missing.length});
    await renderFresh();
  } catch (error) {
    window.alert(error?.message || "Starter badges could not be installed.");
  }
}

function bind() {
  const badgeForm = root.querySelector("#ab-badge-form");
  badgeForm?.addEventListener("submit", saveBadge);
  ["input","change"].forEach((type) => badgeForm?.addEventListener(type, updatePreview));
  updatePreview();
  root.querySelector("#ab-award-form")?.addEventListener("submit", awardBadge);
  root.querySelector("#ab-starter")?.addEventListener("click", installStarterSet);
  root.querySelectorAll("[data-edit-badge]").forEach((button) => button.addEventListener("click", () => fillEditForm(button.dataset.editBadge)));
  root.querySelectorAll("[data-toggle-badge]").forEach((button) => button.addEventListener("click", () => toggleBadge(button.dataset.toggleBadge)));
  root.querySelectorAll("[data-revoke-assignment]").forEach((button) => button.addEventListener("click", () => revokeAssignment(button.dataset.revokeAssignment)));
  root.querySelector("#ab-cancel-edit")?.addEventListener("click", async () => { state.editingId = null; await renderFresh(); });

  root.querySelector("#ab-library-search")?.addEventListener("input", (event) => {
    const q = clean(event.target.value).toLowerCase();
    root.querySelectorAll(".ab-badge-card").forEach((card) => { card.hidden = q && !card.textContent.toLowerCase().includes(q); });
  });
  root.querySelector("#ab-assignment-search")?.addEventListener("input", (event) => {
    const q = clean(event.target.value).toLowerCase();
    root.querySelectorAll(".ab-assignment").forEach((card) => { card.hidden = q && !card.textContent.toLowerCase().includes(q); });
  });
}

async function renderFresh() {
  state.rendering = false;
  await refreshData();
  render();
}

async function loadIdentity(user) {
  state.user = null;
  state.staff = null;
  if (!user) return;
  [state.user, state.staff] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null)
  ]);
}

function schedule() {
  window.setTimeout(() => {
    augmentNav();
    if (route() === BADGE_ROUTE) renderFresh();
    if (route() === "/executive/accounts") augmentRegistryRows();
  }, 50);
  window.setTimeout(() => { augmentNav(); augmentRegistryRows(); }, 500);
}

async function init() {
  injectStyles();
  const services = await initializeFirebase();
  Object.assign(state, services);
  state.Auth.onAuthStateChanged(state.auth, async (user) => {
    await loadIdentity(user);
    if (isManager()) await refreshData().catch(() => {});
    schedule();
  });
  window.addEventListener("hashchange", schedule);
  if (sidebar) new MutationObserver(augmentNav).observe(sidebar, {childList:true, subtree:true});
  if (root) new MutationObserver(() => {
    if (route() === "/executive/accounts") window.setTimeout(augmentRegistryRows, 20);
    if (route() === BADGE_ROUTE && !root.querySelector("[data-account-badges-v1]")) window.setTimeout(render, 20);
  }).observe(root, {childList:true, subtree:true});
}

init().catch((error) => console.warn("Account Badges V1 failed to initialize", error));
