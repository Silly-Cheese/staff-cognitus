import { initializeFirebase, firebaseState, readCollection, readDoc } from "./firebase.js";
import { route, safe, formatTimestamp, statusLabel } from "./utils.js";

const API = "https://auth.cognitus-solutions.org";
const root = document.querySelector("#page-root");
let busy = false;

function pct(value) {
  const n = Math.max(0, Number(value || 0));
  return Math.min(100, n);
}
function dateLabel(value) {
  if (!value) return "—";
  const d = new Date(value + "T12:00:00");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
function quotaStatus(status) {
  return ({
    met: "Quota Met",
    in_progress: "In Progress",
    at_risk: "At Risk",
    no_activity: "No Activity",
    exempt: "Exempt",
    not_applicable: "Not Applicable"
  })[status] || statusLabel(status);
}
function statusClass(status) {
  return ["met","exempt"].includes(status) ? "quota-good"
    : ["at_risk","no_activity"].includes(status) ? "quota-warn"
    : status === "not_applicable" ? "quota-muted"
    : "quota-live";
}
function notice(message, tone = "") {
  return '<div class="notice ' + (tone ? "notice-" + tone : "") + '">' + safe(message) + "</div>";
}
async function api(path, options = {}) {
  const { auth } = firebaseState();
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to Cognitus Staff first.");
  const token = await user.getIdToken();
  const response = await fetch(API + path, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      authorization: "Bearer " + token,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Quota service request failed.");
  return body;
}
function shell(title, eyebrow = "Discord quota") {
  document.title = title + " · Cognitus Staff / Command";
  root.innerHTML = '<div class="page-inner quota-page">' +
    '<header class="page-header quota-header"><div class="page-header-copy"><p class="eyebrow">' + safe(eyebrow) + '</p><h1>' + safe(title) + '</h1>' +
    '<p>Live Cognitus staff quota tracking from qualifying Discord message activity. Message contents are not collected or stored.</p></div></header>' +
    '<div id="quota-root"><section class="loading-screen"><span class="loading-mark">Q</span><div><strong>Loading quota data</strong><p>Checking your current quota period…</p></div></section></div></div>';
  return document.querySelector("#quota-root");
}
function selfMarkup(data) {
  const p = data.progress;
  const daily = data.daily || [];
  const bars = daily.length
    ? daily.map(day => {
        const max = Math.max(...daily.map(x => Number(x.messages || 0)), 1);
        const height = Math.max(8, Math.round(Number(day.messages || 0) / max * 100));
        return '<div class="quota-day"><span class="quota-day-bar" style="height:' + height + '%"></span><strong>' + Number(day.messages || 0) + '</strong><small>' + safe(dateLabel(day.date).replace(", " + new Date().getFullYear(), "")) + '</small></div>';
      }).join("")
    : '<div class="quota-empty-chart">No qualifying Discord activity has been counted in this period yet.</div>';

  return '<section class="quota-hero ' + statusClass(p.status) + '">' +
    '<div><p class="eyebrow">Current period</p><h2>' + safe(quotaStatus(p.status)) + '</h2><p>' + safe(dateLabel(data.period.startsOn)) + ' – ' + safe(dateLabel(data.period.endsOn)) + '</p></div>' +
    '<div class="quota-big-number"><strong>' + p.total + '</strong><span>/ ' + p.required + ' messages</span></div></section>' +
    '<section class="quota-grid">' +
      '<article class="quota-card"><span>Progress</span><strong>' + p.percentage + '%</strong><div class="quota-progress"><i style="width:' + pct(p.percentage) + '%"></i></div><small>' + (p.exempt ? safe(p.exemptionReason || "Exempt") : p.remaining + ' messages remaining') + '</small></article>' +
      '<article class="quota-card"><span>Days remaining</span><strong>' + p.daysRemaining + '</strong><small>' + (p.remaining ? p.averageNeededPerDay + ' per day needed' : 'No additional messages required') + '</small></article>' +
      '<article class="quota-card"><span>Last activity</span><strong class="quota-date-strong">' + safe(p.lastActivityAt ? formatTimestamp(p.lastActivityAt) : "No activity") + '</strong><small>' + (p.linked ? "Discord account linked" : "Discord linkage missing") + '</small></article>' +
      '<article class="quota-card"><span>Adjustments</span><strong>' + (p.adjustment > 0 ? "+" : "") + p.adjustment + '</strong><small>Administrative quota credit/debit</small></article>' +
    '</section>' +
    '<section class="panel quota-panel"><header class="panel-header"><div><p class="eyebrow">Activity trend</p><h2>This quota period</h2></div><span class="badge">' + safe(p.messages + " counted") + '</span></header>' +
      '<div class="quota-chart">' + bars + '</div></section>' +
    (!p.linked ? notice("Your Cognitus account does not currently expose a linked Discord User ID to the quota service. Ask an administrator to sync the quota roster.", "error") : "");
}
async function renderSelf() {
  const target = shell("My Quota");
  try {
    const data = await api("/api/me");
    target.innerHTML = selfMarkup(data);
  } catch (error) {
    target.innerHTML = notice(error.message, "error");
  }
}
async function rosterPayload() {
  const directory = await readCollection("staffDirectory");
  const staff = await Promise.all(directory.map(async employee => {
    const user = await readDoc("users", employee.uid || employee.id).catch(() => null);
    return {
      firebaseUid: employee.uid || employee.id,
      discordUserId: user?.discordOauthId || user?.discordId || "",
      displayName: employee.displayName || user?.displayName || "Cognitus Staff",
      employeeId: employee.employeeId || "",
      departmentId: employee.departmentId || "",
      rank: employee.rank || "",
      status: employee.status || "active"
    };
  }));
  return staff;
}
async function syncRoster() {
  const staff = await rosterPayload();
  return api("/api/admin/roster-sync", { method: "POST", body: { staff } });
}
function summaryCards(summary) {
  return '<section class="quota-grid quota-admin-summary">' +
    '<article class="quota-card"><span>Total staff</span><strong>' + summary.total + '</strong><small>Current quota roster</small></article>' +
    '<article class="quota-card quota-good"><span>Quota met</span><strong>' + summary.met + '</strong><small>Completed this period</small></article>' +
    '<article class="quota-card quota-warn"><span>Needs attention</span><strong>' + summary.atRisk + '</strong><small>At risk or no activity</small></article>' +
    '<article class="quota-card"><span>Discord linked</span><strong>' + summary.linked + '/' + summary.total + '</strong><small>' + summary.exempt + ' exempt</small></article>' +
  '</section>';
}
function adminTable(staff) {
  if (!staff.length) return '<div class="empty-state"><p>No staff matched the current filters.</p></div>';
  return '<div class="quota-table-wrap"><table class="quota-table"><thead><tr><th>Staff</th><th>Progress</th><th>Status</th><th>Remaining</th><th>Last Activity</th><th></th></tr></thead><tbody>' +
    staff.map(person => '<tr data-name="' + safe((person.displayName || "").toLowerCase()) + '" data-status="' + safe(person.status) + '">' +
      '<td><strong>' + safe(person.displayName) + '</strong><small>' + safe(person.employeeId || "No Employee ID") + ' · ' + safe(person.departmentId || "Unassigned") + '</small></td>' +
      '<td><strong>' + person.total + ' / ' + person.required + '</strong><div class="quota-progress quota-progress-small"><i style="width:' + pct(person.percentage) + '%"></i></div><small>' + person.percentage + '%</small></td>' +
      '<td><span class="quota-status ' + statusClass(person.status) + '">' + safe(quotaStatus(person.status)) + '</span></td>' +
      '<td>' + (person.exempt ? "—" : person.remaining) + '</td>' +
      '<td><small>' + safe(person.lastActivityAt ? formatTimestamp(person.lastActivityAt) : "No activity") + '</small></td>' +
      '<td><button class="button button-small" data-quota-manage="' + safe(person.firebaseUid) + '">Manage</button></td>' +
    '</tr>').join("") + '</tbody></table></div>';
}
function adminMarkup(data, settings) {
  return summaryCards(data.summary) +
    '<section class="panel quota-panel"><header class="panel-header"><div><p class="eyebrow">Organization</p><h2>Staff Quota Administration</h2></div>' +
      '<div class="button-row"><button class="button button-small" id="quota-sync">Sync Staff</button><button class="button button-small button-dark" id="quota-settings-open">Quota Settings</button></div></header>' +
      '<div class="quota-toolbar"><input id="quota-search" type="search" placeholder="Search staff…"><select id="quota-filter"><option value="">All statuses</option><option value="met">Quota met</option><option value="in_progress">In progress</option><option value="at_risk">At risk</option><option value="no_activity">No activity</option><option value="exempt">Exempt</option></select><span>' +
      safe(dateLabel(data.period.startsOn)) + ' – ' + safe(dateLabel(data.period.endsOn)) + '</span></div>' +
      '<div id="quota-table">' + adminTable(data.staff) + '</div></section>' +
    '<dialog class="quota-dialog" id="quota-manage-dialog"><form method="dialog"><button class="quota-dialog-close" value="cancel" aria-label="Close">×</button></form><div id="quota-manage-content"></div></dialog>' +
    '<dialog class="quota-dialog" id="quota-settings-dialog"><form id="quota-settings-form" class="form-stack"><div><p class="eyebrow">Quota policy</p><h2>Quota Settings</h2></div>' +
      '<label>Default message quota<input name="defaultRequiredMessages" type="number" min="1" max="100000" value="' + Number(settings.defaultRequiredMessages || 100) + '" required></label>' +
      '<label>Period<select name="periodType"><option value="weekly"' + (settings.periodType === "weekly" ? " selected" : "") + '>Weekly</option><option value="biweekly"' + (settings.periodType === "biweekly" ? " selected" : "") + '>Biweekly</option><option value="monthly"' + (settings.periodType === "monthly" ? " selected" : "") + '>Monthly</option></select></label>' +
      '<label>Anchor date<input name="anchorDate" type="date" value="' + safe(settings.anchorDate || "2026-01-05") + '" required></label>' +
      '<label>Staff Discord role IDs<textarea name="staffRoleIds" rows="3" required placeholder="Comma separated Discord role IDs">' + safe((settings.staffRoleIds || []).join(", ")) + '</textarea></label>' +
      '<label>Included channel IDs <small>Optional — blank counts all channels except exclusions</small><textarea name="includedChannelIds" rows="2" placeholder="Comma separated">' + safe((settings.includedChannelIds || []).join(", ")) + '</textarea></label>' +
      '<label>Excluded channel IDs <small>Optional</small><textarea name="excludedChannelIds" rows="2" placeholder="Comma separated">' + safe((settings.excludedChannelIds || []).join(", ")) + '</textarea></label>' +
      '<div class="button-row"><button type="button" class="button" data-close-settings>Cancel</button><button class="button button-dark" type="submit">Save Settings</button></div><div id="quota-settings-message"></div></form></dialog>';
}
function manageDialog(person, period) {
  return '<div><p class="eyebrow">Staff quota</p><h2>' + safe(person.displayName) + '</h2><p>' + person.total + ' / ' + person.required + ' messages · ' + safe(quotaStatus(person.status)) + '</p></div>' +
    '<div class="quota-manage-grid">' +
      '<form class="form-stack" data-quota-target><h3>Custom target</h3><input type="hidden" name="firebaseUid" value="' + safe(person.firebaseUid) + '"><label>Required messages<input name="requiredMessages" type="number" min="1" max="100000" value="' + (person.customRequiredMessages ?? "") + '" placeholder="Blank = default"></label><button class="button button-dark" type="submit">Save Target</button></form>' +
      '<form class="form-stack" data-quota-exempt><h3>Exemption</h3><input type="hidden" name="firebaseUid" value="' + safe(person.firebaseUid) + '"><label>Starts<input name="startsOn" type="date" value="' + safe(period.startsOn) + '" required></label><label>Ends<input name="endsOn" type="date" value="' + safe(period.endsOn) + '" required></label><label>Reason<textarea name="reason" rows="3" minlength="5" required></textarea></label><button class="button" type="submit">Add Exemption</button></form>' +
      '<form class="form-stack" data-quota-adjust><h3>Manual adjustment</h3><input type="hidden" name="firebaseUid" value="' + safe(person.firebaseUid) + '"><label>Messages (+/-)<input name="amount" type="number" step="1" required></label><label>Reason<textarea name="reason" rows="3" minlength="5" required></textarea></label><button class="button" type="submit">Apply Adjustment</button></form>' +
    '</div><div id="quota-manage-message"></div>';
}
async function renderAdmin() {
  const target = shell("Quota Administration", "Staff performance");
  try {
    const [data, settings] = await Promise.all([api("/api/admin/staff"), api("/api/admin/settings")]);
    target.innerHTML = adminMarkup(data, settings);

    const search = target.querySelector("#quota-search");
    const filter = target.querySelector("#quota-filter");
    const redraw = () => {
      const q = String(search.value || "").trim().toLowerCase();
      const s = filter.value;
      target.querySelector("#quota-table").innerHTML = adminTable(data.staff.filter(person =>
        (!q || String(person.displayName || "").toLowerCase().includes(q) || String(person.employeeId || "").toLowerCase().includes(q)) &&
        (!s || person.status === s)
      ));
      bindManageButtons();
    };

    const bindManageButtons = () => {
      target.querySelectorAll("[data-quota-manage]").forEach(button => button.addEventListener("click", () => {
        const person = data.staff.find(item => item.firebaseUid === button.dataset.quotaManage);
        if (!person) return;
        const dialog = target.querySelector("#quota-manage-dialog");
        target.querySelector("#quota-manage-content").innerHTML = manageDialog(person, data.period);
        dialog.showModal();

        dialog.querySelector("[data-quota-target]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(event.currentTarget).entries());
          try { await api("/api/admin/target", { method: "POST", body }); location.reload(); }
          catch (error) { dialog.querySelector("#quota-manage-message").innerHTML = notice(error.message, "error"); }
        });
        dialog.querySelector("[data-quota-exempt]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(event.currentTarget).entries());
          try { await api("/api/admin/exemption", { method: "POST", body }); location.reload(); }
          catch (error) { dialog.querySelector("#quota-manage-message").innerHTML = notice(error.message, "error"); }
        });
        dialog.querySelector("[data-quota-adjust]")?.addEventListener("submit", async event => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(event.currentTarget).entries());
          try { await api("/api/admin/adjustment", { method: "POST", body }); location.reload(); }
          catch (error) { dialog.querySelector("#quota-manage-message").innerHTML = notice(error.message, "error"); }
        });
      }));
    };

    bindManageButtons();
    search.addEventListener("input", redraw);
    filter.addEventListener("change", redraw);

    target.querySelector("#quota-sync")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Syncing…";
      try { await syncRoster(); location.reload(); }
      catch (error) { alert(error.message); button.disabled = false; button.textContent = "Sync Staff"; }
    });

    const settingsDialog = target.querySelector("#quota-settings-dialog");
    target.querySelector("#quota-settings-open")?.addEventListener("click", () => settingsDialog.showModal());
    target.querySelector("[data-close-settings]")?.addEventListener("click", () => settingsDialog.close());
    target.querySelector("#quota-settings-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      body.defaultRequiredMessages = Number(body.defaultRequiredMessages);
      const ids = value => String(value || "").split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
      body.staffRoleIds = ids(body.staffRoleIds);
      body.includedChannelIds = ids(body.includedChannelIds);
      body.excludedChannelIds = ids(body.excludedChannelIds);
      try { await api("/api/admin/settings", { method: "PUT", body }); location.reload(); }
      catch (error) { target.querySelector("#quota-settings-message").innerHTML = notice(error.message, "error"); }
    });
  } catch (error) {
    target.innerHTML = notice(error.message, "error");
  }
}
async function render() {
  if (busy) return;
  const current = route();
  if (!["/quota", "/admin/quota"].includes(current)) return;
  busy = true;
  try {
    await initializeFirebase();
    const { auth, Auth } = firebaseState();
    if (!auth?.currentUser) {
      await new Promise(resolve => {
        const stop = Auth.onAuthStateChanged(auth, () => { stop(); resolve(); });
        setTimeout(() => { try { stop(); } catch {} resolve(); }, 2500);
      });
    }
    if (!auth.currentUser) {
      location.hash = "#/login";
      return;
    }
    if (current === "/quota") await renderSelf();
    else await renderAdmin();
  } finally {
    busy = false;
  }
}

window.addEventListener("hashchange", () => setTimeout(render, 30));
render();
