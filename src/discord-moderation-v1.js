import { initializeFirebase, firebaseState, readDoc } from "./firebase.js";

const AUTH_BASE = "https://auth.cognitus-solutions.org";
const KICK_PERMISSION = "discord.members.kick";
let auth = null;
let Fire = null;
let enhancing = false;
let lastAuthz = null;
let lastUid = null;

function esc(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clean(value) {
  return String(value ?? "").trim();
}

function currentRoute() {
  return (location.hash || "#/").replace(/^#/, "").split("?")[0] || "/";
}

function targetUidFromRoute() {
  const match = currentRoute().match(/^\/staff\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function ownAuthorization() {
  const user = auth?.currentUser;
  if (!user) return null;
  if (lastAuthz && lastUid === user.uid) return lastAuthz;
  const [mainUser, access] = await Promise.all([
    readDoc("users", user.uid).catch(() => null),
    readDoc("staffAccess", user.uid).catch(() => null)
  ]);
  const activeStaff = Boolean(access && ["active", "training", "on_leave"].includes(access.status));
  const allowed = Boolean(
    mainUser?.status === "active" &&
    (
      mainUser?.role === "owner" ||
      (activeStaff && access?.rank === "co-owner") ||
      (activeStaff && Array.isArray(access?.permissions) && access.permissions.includes(KICK_PERMISSION))
    )
  );
  lastUid = user.uid;
  lastAuthz = { allowed, mainUser, access };
  return lastAuthz;
}

async function kickMember(body) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in to Cognitus Staff first.");
  const token = await user.getIdToken();
  const response = await fetch(AUTH_BASE + "/discord-admin/kick-member", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The Discord member could not be kicked.");
  return payload;
}

function messageBox(element, message, tone = "neutral") {
  if (!element) return;
  element.hidden = false;
  element.className = "notice " + (tone === "error" ? "notice-error" : tone === "success" ? "notice-success" : "");
  element.textContent = message;
}

async function enhanceStaffProfile(authz) {
  const uid = targetUidFromRoute();
  if (!uid || uid === auth.currentUser?.uid) return;
  if (document.querySelector("[data-discord-kick-profile]")) return;
  const page = document.querySelector("#page-root .page-inner");
  if (!page) return;

  const directory = await readDoc("staffDirectory", uid).catch(() => null);
  if (!directory || directory.rank === "owner") return;

  const section = document.createElement("section");
  section.className = "panel";
  section.style.marginTop = "18px";
  section.dataset.discordKickProfile = "true";
  section.innerHTML =
    '<header class="panel-header"><div><p class="eyebrow">Discord moderation</p><h2>Server membership</h2></div><span class="badge">Protected action</span></header>' +
    '<div class="panel-body"><p style="margin-top:0;color:#666;font-size:11px;line-height:1.7">Remove this person from the Cognitus Discord server without terminating their Cognitus or Staff account.</p>' +
    '<div class="notice" data-kick-profile-result hidden></div>' +
    '<div class="button-row" style="margin-top:16px"><button class="button button-danger" type="button" data-open-discord-kick>Kick from Discord</button></div></div>';
  page.appendChild(section);

  const dialog = document.createElement("dialog");
  dialog.className = "termination-dialog";
  dialog.dataset.discordKickDialog = "true";
  dialog.innerHTML =
    '<form class="form-stack" data-discord-kick-form>' +
    '<div><p class="eyebrow">Discord moderation</p><h2>Kick ' + esc(directory.displayName || "this member") + '?</h2><p>This removes the linked Discord account from the Cognitus server. It does not terminate Staff / Command access or delete Cognitus records.</p></div>' +
    '<div class="termination-warning"><strong>Discord action only.</strong><span>A reason is required. The kick will be written to the Cognitus Discord audit log.</span></div>' +
    '<label>Reason<textarea name="reason" minlength="10" maxlength="500" rows="4" required placeholder="Explain why this person is being removed from the Discord server"></textarea></label>' +
    '<label>Type ' + esc(directory.displayName || "the employee name") + ' to confirm<input name="confirmation" autocomplete="off" required></label>' +
    '<div class="notice" data-kick-dialog-message hidden></div>' +
    '<div class="button-row termination-actions"><button class="button" type="button" data-cancel-discord-kick>Cancel</button><button class="button button-danger" type="submit">Kick from Discord</button></div>' +
    '</form>';
  page.appendChild(dialog);

  section.querySelector("[data-open-discord-kick]")?.addEventListener("click", () => {
    dialog.querySelector("form")?.reset();
    const message = dialog.querySelector("[data-kick-dialog-message]");
    if (message) message.hidden = true;
    dialog.showModal();
  });
  dialog.querySelector("[data-cancel-discord-kick]")?.addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-discord-kick-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const message = dialog.querySelector("[data-kick-dialog-message]");
    const reason = clean(data.reason).slice(0, 500);
    const expected = clean(directory.displayName || "");
    if (reason.length < 10) return messageBox(message, "Enter a reason of at least 10 characters.", "error");
    if (clean(data.confirmation) !== expected) return messageBox(message, "Type " + expected + " exactly to confirm.", "error");
    const button = form.querySelector('button[type="submit"]');
    const normal = button.textContent;
    button.disabled = true;
    button.textContent = "Kicking…";
    try {
      const result = await kickMember({ uid, reason });
      dialog.close();
      messageBox(section.querySelector("[data-kick-profile-result]"), (result.displayName || expected) + " was removed from the Discord server. Cognitus and Staff access were left unchanged.", "success");
    } catch (error) {
      messageBox(message, error?.message || "The Discord member could not be kicked.", "error");
    } finally {
      button.disabled = false;
      button.textContent = normal;
    }
  });
}

async function enhanceDiscordAdmin(authz) {
  if (currentRoute() !== "/admin/discord") return;
  if (document.querySelector("[data-discord-moderation-panel]")) return;
  const page = document.querySelector("#page-root .page-inner");
  if (!page) return;

  const section = document.createElement("section");
  section.className = "panel";
  section.style.marginTop = "18px";
  section.dataset.discordModerationPanel = "true";
  section.innerHTML =
    '<header class="panel-header"><div><p class="eyebrow">Discord moderation</p><h2>Kick a server member</h2></div><span class="badge">Protected action</span></header>' +
    '<div class="panel-body"><p style="margin-top:0;color:#666;font-size:11px;line-height:1.7">Remove any non-protected member from the configured Cognitus Discord server by Discord User ID. This does not ban the member and does not change Cognitus employment or account status.</p>' +
    '<div class="notice" data-kick-admin-result hidden></div>' +
    '<form class="form-stack" data-kick-admin-form style="margin-top:16px">' +
    '<label>Discord User ID<input name="discordId" inputmode="numeric" pattern="[0-9]{10,25}" required placeholder="e.g. 123456789012345678"></label>' +
    '<label>Reason<textarea name="reason" minlength="10" maxlength="500" rows="4" required placeholder="Reason for removing this member from the server"></textarea></label>' +
    '<label>Type KICK to confirm<input name="confirmation" autocomplete="off" required></label>' +
    '<button class="button button-danger" type="submit">Kick Member</button>' +
    '</form></div>';
  page.appendChild(section);

  section.querySelector("[data-kick-admin-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const resultBox = section.querySelector("[data-kick-admin-result]");
    const discordId = clean(data.discordId).replace(/\D/g, "");
    const reason = clean(data.reason).slice(0, 500);
    if (!/^\d{10,25}$/.test(discordId)) return messageBox(resultBox, "Enter a valid Discord User ID.", "error");
    if (reason.length < 10) return messageBox(resultBox, "Enter a reason of at least 10 characters.", "error");
    if (clean(data.confirmation).toUpperCase() !== "KICK") return messageBox(resultBox, "Type KICK exactly to confirm.", "error");
    const button = form.querySelector('button[type="submit"]');
    const normal = button.textContent;
    button.disabled = true;
    button.textContent = "Kicking…";
    try {
      const result = await kickMember({ discordId, reason });
      messageBox(resultBox, (result.displayName || result.discordUsername || discordId) + " was removed from the Discord server.", "success");
      form.reset();
    } catch (error) {
      messageBox(resultBox, error?.message || "The Discord member could not be kicked.", "error");
    } finally {
      button.disabled = false;
      button.textContent = normal;
    }
  });
}

async function enhance() {
  if (enhancing) return;
  enhancing = true;
  try {
    if (!auth?.currentUser) return;
    const authz = await ownAuthorization();
    if (!authz?.allowed) return;
    await enhanceStaffProfile(authz);
    await enhanceDiscordAdmin(authz);
  } finally {
    enhancing = false;
  }
}

function scheduleEnhance() {
  setTimeout(() => enhance().catch((error) => console.warn("Discord moderation enhancement failed", error)), 120);
  setTimeout(() => enhance().catch(() => {}), 500);
}

(async () => {
  await initializeFirebase();
  ({ auth, Fire } = firebaseState());
  Fire = Fire;
  firebaseState().Auth.onAuthStateChanged(auth, () => {
    lastAuthz = null;
    lastUid = null;
    scheduleEnhance();
  });
  window.addEventListener("hashchange", scheduleEnhance);
  new MutationObserver(scheduleEnhance).observe(document.querySelector("#page-root"), { childList: true, subtree: true });
  scheduleEnhance();
})();
