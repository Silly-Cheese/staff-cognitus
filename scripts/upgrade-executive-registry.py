from pathlib import Path

path = Path('src/generation3.js')
text = path.read_text()

start = text.index('async function accountsPage() {')
end = text.index('\nasync function executivePage() {', start)

replacement = r'''async function accountsPage() {
  setTitle("Executive Registry");
  if (!can(PERMISSIONS.ACCOUNTS_READ_ALL)) return forbidden("Executive Registry");

  const [accountsRaw, organizationsRaw] = await Promise.all([
    readCollection("users"),
    readCollection("organizations").catch(() => [])
  ]);
  const accounts = alphabetic(accountsRaw, "displayName");
  const organizations = alphabetic(organizationsRaw, "name");
  const staffIds = new Set(g3.directory.map((entry) => entry.uid || entry.id));
  const orgById = new Map(organizations.map((org) => [org.id, org]));
  const canManageRegistry = owner();

  const activeCount = accounts.filter((entry) => entry.status === "active").length;
  const verifiedCount = accounts.filter((entry) => entry.identityVerified === true).length;
  const organizationCount = accounts.filter((entry) => entry.organizationId).length;
  const staffCount = accounts.filter((entry) => staffIds.has(entry.uid || entry.id)).length;

  root.innerHTML = `<div class="page-inner" data-g3-page="accounts" data-executive-registry-v2>
    ${pageHeader("Executive · Registry", "Accounts & organizations.", "A faster executive workspace for finding, reviewing, and—when authorized—editing Cognitus accounts and organizations. Chief Officers have company-wide visibility; Owner and Co-Owner have management controls.")}
    <section class="g3-kpi"><article><span>Total Accounts</span><strong>${accounts.length}</strong></article><article><span>Active</span><strong>${activeCount}</strong></article><article><span>Verified</span><strong>${verifiedCount}</strong></article><article><span>Staff Accounts</span><strong>${staffCount}</strong></article></section>
    <div class="registry-tabs" role="tablist" aria-label="Executive registry">
      <button class="button button-dark" type="button" data-registry-tab="accounts">Accounts</button>
      <button class="button" type="button" data-registry-tab="organizations">Organizations <span class="registry-count">${organizations.length}</span></button>
    </div>
    <section id="registry-surface"></section>
    <div id="registry-drawer-host"></div>
  </div>`;

  const surface = root.querySelector("#registry-surface");
  const drawerHost = root.querySelector("#registry-drawer-host");
  let activeTab = "accounts";

  const closeDrawer = () => {
    drawerHost.innerHTML = "";
    document.body.classList.remove("registry-drawer-open");
  };

  const showDrawer = (html) => {
    drawerHost.innerHTML = `<div class="registry-backdrop" data-registry-close></div><aside class="registry-drawer" role="dialog" aria-modal="true" aria-label="Executive registry editor">${html}</aside>`;
    document.body.classList.add("registry-drawer-open");
    drawerHost.querySelectorAll("[data-registry-close]").forEach((node) => node.addEventListener("click", closeDrawer));
  };

  const organizationOptions = (selected = "") => `<option value="">No organization</option>${organizations.map((org) => `<option value="${safe(org.id)}" ${org.id === selected ? "selected" : ""}>${safe(org.name || org.cognitusId || org.id)}</option>`).join("")}`;

  const openAccount = async (uid) => {
    const account = accounts.find((entry) => (entry.uid || entry.id) === uid);
    if (!account) return;
    const profile = await readDoc("profiles", uid).catch(() => null);
    const isTrueOwner = account.role === "owner";
    const editable = canManageRegistry && !isTrueOwner;
    const isStaffAccount = staffIds.has(uid);
    const verificationStatuses = ["self_declared", "claimed_unverified", "claimed", "employer_supplied", "verified", "unverified", "disputed"];
    const standings = ["unreviewed", "good_standing", "watch", "concern", "restricted", "disqualified"];
    const riskLevels = ["unreviewed", "low", "moderate", "high", "critical"];
    const roles = ["user", "verified_employer_member", "org_admin", "reviewer", "admin"];
    const statuses = ["active", "pending_verification", "suspended", "restricted", "banned", "password_reset_required"];
    const disabled = editable ? "" : "disabled";

    showDrawer(`<header class="registry-drawer-header"><div><p class="eyebrow">Account · ${safe(account.cognitusId || uid)}</p><h2>${safe(account.displayName || account.discordUsername || "Cognitus Account")}</h2><p>${isTrueOwner ? "The primary Owner account is protected from registry edits." : editable ? "Edit account access, verification, trust, standing, risk, and organization membership." : "Read-only executive account view."}</p></div><button class="button button-small" type="button" data-registry-close>Close</button></header>
      <div id="registry-editor-message" class="notice" hidden></div>
      <form id="registry-account-form" class="registry-form">
        <section class="registry-section"><div class="registry-section-title"><strong>Account</strong><span>${safe(account.discordId || "No Discord ID")}</span></div>
          <div class="form-row"><label>Display name<input name="displayName" value="${safe(account.displayName || "")}" maxlength="120" ${disabled}></label><label>Discord username<input name="discordUsername" value="${safe(account.discordUsername || "")}" maxlength="100" ${disabled}></label></div>
          <div class="form-row"><label>Role<select name="role" ${disabled}>${roles.map((value) => `<option value="${value}" ${value === account.role ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}${isTrueOwner ? `<option value="owner" selected>Owner</option>` : ""}</select></label><label>Account status<select name="status" ${disabled}>${statuses.map((value) => `<option value="${value}" ${value === account.status ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div>
          <label>Organization<select name="organizationId" ${disabled}>${organizationOptions(account.organizationId || "")}</select></label>
          <label class="registry-check"><input name="identityVerified" type="checkbox" ${account.identityVerified === true ? "checked" : ""} ${disabled}><span><strong>Verified account</strong><small>Controls the account-level identityVerified flag.</small></span></label>
        </section>
        <section class="registry-section"><div class="registry-section-title"><strong>Trust & standing</strong><span>${profile ? safe(profile.cognitusId || "Profile linked") : "No linked profile"}</span></div>
          ${profile ? `<div class="form-row"><label>Verification status<select name="identityStatus" ${disabled}>${verificationStatuses.map((value) => `<option value="${value}" ${value === profile.identityStatus ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Trust rating<input name="identityConfidence" type="number" min="0" max="100" step="1" value="${safe(Number.isFinite(Number(profile.identityConfidence)) ? Number(profile.identityConfidence) : 0)}" ${disabled}><small>0–100 identity confidence.</small></label></div><div class="form-row"><label>Standing<select name="professionalStanding" ${disabled}>${standings.map((value) => `<option value="${value}" ${value === profile.professionalStanding ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Risk level<select name="riskLevel" ${disabled}>${riskLevels.map((value) => `<option value="${value}" ${value === profile.riskLevel ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div>` : `<div class="g3-callout"><strong>No profile record.</strong>This account can still be managed, but trust, standing, and profile verification are unavailable until a profile exists.</div>`}
        </section>
        <section class="registry-section registry-readonly"><div class="registry-section-title"><strong>Identifiers</strong><span>Protected</span></div><dl class="registry-dl"><dt>Cognitus ID</dt><dd>${safe(account.cognitusId || "—")}</dd><dt>UID</dt><dd>${safe(uid)}</dd><dt>Discord ID</dt><dd>${safe(account.discordId || "—")}</dd><dt>Staff</dt><dd>${isStaffAccount ? "Yes" : "No"}</dd></dl></section>
        ${editable ? `<div class="registry-savebar"><button class="button button-dark" type="submit">Save Account</button><span>Changes are written to the shared Cognitus records immediately.</span></div>` : ""}
      </form>
      ${editable ? `<section class="registry-danger"><div><strong>Delete account</strong><p>Removes the Cognitus user record and immediately blocks product access. Historical reports and profile records are retained for referential integrity. Firebase Authentication credentials cannot be physically removed from this static client portal.</p></div><button class="button" type="button" id="registry-delete-account" ${isStaffAccount ? "disabled" : ""}>${isStaffAccount ? "Staff Account Protected" : "Delete Account"}</button></section>` : ""}`);

    const form = drawerHost.querySelector("#registry-account-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editable) return;
      const message = drawerHost.querySelector("#registry-editor-message");
      const data = formObject(form);
      const trust = Math.max(0, Math.min(100, Number(data.identityConfidence || 0)));
      const button = form.querySelector('button[type="submit"]');
      try {
        setBusy(button, true, "Saving…", "Save Account");
        await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "users", uid), {
          displayName: clean(data.displayName).slice(0, 120),
          discordUsername: clean(data.discordUsername).slice(0, 100),
          role: clean(data.role),
          status: clean(data.status),
          organizationId: clean(data.organizationId) || null,
          identityVerified: Boolean(form.querySelector('[name="identityVerified"]')?.checked),
          updatedAt: g3.Fire.serverTimestamp()
        });
        if (profile) {
          await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "profiles", uid), {
            displayName: clean(data.displayName).slice(0, 120),
            identityStatus: clean(data.identityStatus),
            identityConfidence: trust,
            professionalStanding: clean(data.professionalStanding),
            riskLevel: clean(data.riskLevel),
            lastReviewedAt: g3.Fire.serverTimestamp(),
            updatedAt: g3.Fire.serverTimestamp()
          });
        }
        await writeActivity("EXEC_ACCOUNT_UPDATED", "user", uid, `Executive updated account ${account.cognitusId || uid}.`, { role: clean(data.role), status: clean(data.status), organizationId: clean(data.organizationId) || null, identityVerified: Boolean(form.querySelector('[name="identityVerified"]')?.checked), trustRating: profile ? trust : null });
        toast("Account updated.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        showNotice(message, error?.message || "Account could not be updated.", "error");
      } finally {
        setBusy(button, false, "Saving…", "Save Account");
      }
    });

    drawerHost.querySelector("#registry-delete-account")?.addEventListener("click", async () => {
      if (!editable || isStaffAccount) return;
      if (!confirm(`Delete ${account.displayName || account.cognitusId || "this account"}? This removes the Cognitus user record and blocks product access.`)) return;
      if (prompt('Type DELETE to confirm this account deletion.') !== 'DELETE') return;
      try {
        await writeActivity("EXEC_ACCOUNT_DELETED", "user", uid, `Executive deleted account ${account.cognitusId || uid}.`);
        await g3.Fire.deleteDoc(g3.Fire.doc(g3.db, "users", uid));
        toast("Account deleted.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        alert(error?.message || "Account deletion failed.");
      }
    });
  };

  const openOrganization = (orgId) => {
    const org = organizations.find((entry) => entry.id === orgId);
    if (!org) return;
    const editable = canManageRegistry;
    const linkedAccounts = accounts.filter((account) => account.organizationId === orgId);
    const verification = ["pending_verification", "verified", "unverified", "suspended", "restricted"];
    const trust = ["unreviewed", "good", "watch", "concern", "high_risk"];
    const disabled = editable ? "" : "disabled";

    showDrawer(`<header class="registry-drawer-header"><div><p class="eyebrow">Organization · ${safe(org.cognitusId || org.id)}</p><h2>${safe(org.name || "Unnamed Organization")}</h2><p>${editable ? "Edit organization identity, verification, trust, and public metadata." : "Read-only executive organization view."}</p></div><button class="button button-small" type="button" data-registry-close>Close</button></header>
      <div id="registry-editor-message" class="notice" hidden></div>
      <form id="registry-org-form" class="registry-form">
        <section class="registry-section"><div class="form-row"><label>Name<input name="name" value="${safe(org.name || "")}" maxlength="140" ${disabled}></label><label>Type<input name="organizationType" value="${safe(org.organizationType || "")}" maxlength="100" ${disabled}></label></div><label>Country<input name="country" value="${safe(org.country || "")}" maxlength="100" ${disabled}></label><div class="form-row"><label>Verification<select name="verificationStatus" ${disabled}>${verification.map((value) => `<option value="${value}" ${value === org.verificationStatus ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label><label>Trust level<select name="trustLevel" ${disabled}>${trust.map((value) => `<option value="${value}" ${value === org.trustLevel ? "selected" : ""}>${safe(titleCase(value))}</option>`).join("")}</select></label></div><label>Public notes<textarea name="publicNotes" rows="5" maxlength="3000" ${disabled}>${safe(org.publicNotes || "")}</textarea></label></section>
        <section class="registry-section registry-readonly"><dl class="registry-dl"><dt>Linked accounts</dt><dd>${linkedAccounts.length}</dd><dt>Stored member count</dt><dd>${safe(org.memberCount ?? 0)}</dd><dt>Document ID</dt><dd>${safe(org.id)}</dd></dl></section>
        ${editable ? `<div class="registry-savebar"><button class="button button-dark" type="submit">Save Organization</button><span>Verification and trust changes are reflected throughout Cognitus.</span></div>` : ""}
      </form>
      ${editable ? `<section class="registry-danger"><div><strong>Delete organization</strong><p>Linked accounts are detached first. Historical records keep their original organization references for audit and reporting continuity.</p></div><button class="button" type="button" id="registry-delete-org">Delete Organization</button></section>` : ""}`);

    const form = drawerHost.querySelector("#registry-org-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editable) return;
      const data = formObject(form);
      const message = drawerHost.querySelector("#registry-editor-message");
      const button = form.querySelector('button[type="submit"]');
      try {
        setBusy(button, true, "Saving…", "Save Organization");
        await g3.Fire.updateDoc(g3.Fire.doc(g3.db, "organizations", orgId), {
          name: clean(data.name).slice(0, 140),
          searchableName: lower(data.name),
          organizationType: clean(data.organizationType).slice(0, 100),
          country: clean(data.country).slice(0, 100),
          verificationStatus: clean(data.verificationStatus),
          trustLevel: clean(data.trustLevel),
          publicNotes: clean(data.publicNotes).slice(0, 3000),
          updatedAt: g3.Fire.serverTimestamp()
        });
        await writeActivity("EXEC_ORG_UPDATED", "organization", orgId, `Executive updated organization ${org.cognitusId || orgId}.`, { verificationStatus: clean(data.verificationStatus), trustLevel: clean(data.trustLevel) });
        toast("Organization updated.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        showNotice(message, error?.message || "Organization could not be updated.", "error");
      } finally {
        setBusy(button, false, "Saving…", "Save Organization");
      }
    });

    drawerHost.querySelector("#registry-delete-org")?.addEventListener("click", async () => {
      if (!editable) return;
      if (!confirm(`Delete ${org.name || org.cognitusId || "this organization"}? ${linkedAccounts.length} linked account(s) will be detached.`)) return;
      if (prompt('Type DELETE to confirm this organization deletion.') !== 'DELETE') return;
      try {
        for (let index = 0; index < linkedAccounts.length; index += 400) {
          const batch = g3.Fire.writeBatch(g3.db);
          linkedAccounts.slice(index, index + 400).forEach((account) => {
            const uid = account.uid || account.id;
            batch.update(g3.Fire.doc(g3.db, "users", uid), { organizationId: null, updatedAt: g3.Fire.serverTimestamp() });
          });
          await batch.commit();
        }
        await writeActivity("EXEC_ORG_DELETED", "organization", orgId, `Executive deleted organization ${org.cognitusId || orgId}.`, { detachedAccounts: linkedAccounts.length });
        await g3.Fire.deleteDoc(g3.Fire.doc(g3.db, "organizations", orgId));
        toast("Organization deleted.");
        closeDrawer();
        await accountsPage();
      } catch (error) {
        alert(error?.message || "Organization deletion failed.");
      }
    });
  };

  const renderAccounts = () => {
    activeTab = "accounts";
    root.querySelectorAll("[data-registry-tab]").forEach((button) => button.classList.toggle("button-dark", button.dataset.registryTab === "accounts"));
    surface.innerHTML = `<section class="panel"><header class="panel-header"><div><p class="eyebrow">Account directory</p><h2>Every account</h2></div><span>${canManageRegistry ? "Owner controls enabled" : "Executive read-only"}</span></header><div class="panel-body"><div class="registry-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="executive-account-search" type="search" placeholder="Name, Discord, Cognitus ID, UID, organization…" autocomplete="off"></div><select id="executive-account-role"><option value="">All roles</option><option value="user">User</option><option value="verified_employer_member">Verified Employer Member</option><option value="org_admin">Organization Admin</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option><option value="owner">Owner</option></select><select id="executive-account-status"><option value="">All statuses</option><option value="active">Active</option><option value="pending_verification">Pending Verification</option><option value="restricted">Restricted</option><option value="suspended">Suspended</option><option value="banned">Banned</option><option value="password_reset_required">Password Reset Required</option></select><select id="executive-account-verified"><option value="">Any verification</option><option value="verified">Verified</option><option value="unverified">Not verified</option></select></div><div id="executive-account-results"></div></div></section>`;
    const search = surface.querySelector("#executive-account-search");
    const roleFilter = surface.querySelector("#executive-account-role");
    const statusFilter = surface.querySelector("#executive-account-status");
    const verifiedFilter = surface.querySelector("#executive-account-verified");
    const results = surface.querySelector("#executive-account-results");
    const render = () => {
      const query = lower(search?.value || "");
      const selectedRole = roleFilter?.value || "";
      const selectedStatus = statusFilter?.value || "";
      const selectedVerified = verifiedFilter?.value || "";
      const filtered = accounts.filter((account) => {
        if (selectedRole && account.role !== selectedRole) return false;
        if (selectedStatus && account.status !== selectedStatus) return false;
        if (selectedVerified === "verified" && account.identityVerified !== true) return false;
        if (selectedVerified === "unverified" && account.identityVerified === true) return false;
        if (!query) return true;
        const orgName = orgById.get(account.organizationId)?.name || "";
        return [account.displayName, account.discordUsername, account.discordId, account.cognitusId, account.uid || account.id, account.role, account.organizationId, orgName, account.status].some((value) => lower(String(value || "")).includes(query));
      });
      results.innerHTML = filtered.length ? `<div class="registry-list">${filtered.map((account) => {
        const uid = account.uid || account.id;
        const org = orgById.get(account.organizationId);
        return `<article class="registry-row"><div class="registry-main"><div class="registry-name"><strong>${safe(account.displayName || account.discordUsername || "Cognitus Account")}</strong>${staffIds.has(uid) ? `<span class="registry-staff">STAFF</span>` : ""}</div><p>${safe(account.discordUsername || "No Discord username")} · ${safe(account.discordId || "No Discord ID")}</p><small>${safe(account.cognitusId || uid)}${org ? ` · ${safe(org.name)}` : account.organizationId ? ` · Org ${safe(account.organizationId)}` : ""}</small></div><div class="registry-badges">${badge(account.role)} ${badge(account.status)} ${account.identityVerified === true ? `<span class="badge active">Verified</span>` : `<span class="badge">Unverified</span>`}</div><div class="registry-actions"><button class="button button-small ${canManageRegistry && account.role !== 'owner' ? 'button-dark' : ''}" type="button" data-open-account="${safe(uid)}">${canManageRegistry && account.role !== 'owner' ? "Edit" : "View"}</button>${staffIds.has(uid) ? `<a class="button button-small" href="#/staff/${safe(uid)}">Staff</a>` : ""}</div></article>`;
      }).join("")}</div>` : emptyState("UA", "No accounts matched", "Change the search or filters to see other Cognitus accounts.");
      results.querySelectorAll("[data-open-account]").forEach((button) => button.addEventListener("click", () => openAccount(button.dataset.openAccount)));
    };
    [search, roleFilter, statusFilter, verifiedFilter].forEach((node) => node?.addEventListener(node?.tagName === "INPUT" ? "input" : "change", debounce(render, 70)));
    render();
  };

  const renderOrganizations = () => {
    activeTab = "organizations";
    root.querySelectorAll("[data-registry-tab]").forEach((button) => button.classList.toggle("button-dark", button.dataset.registryTab === "organizations"));
    surface.innerHTML = `<section class="panel"><header class="panel-header"><div><p class="eyebrow">Organization registry</p><h2>Every organization</h2></div><span>${organizations.length} organizations</span></header><div class="panel-body"><div class="registry-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="executive-org-search" type="search" placeholder="Organization name, Cognitus ID, type, country…" autocomplete="off"></div><select id="executive-org-verification"><option value="">All verification</option><option value="pending_verification">Pending Verification</option><option value="verified">Verified</option><option value="unverified">Unverified</option><option value="suspended">Suspended</option><option value="restricted">Restricted</option></select><select id="executive-org-trust"><option value="">All trust levels</option><option value="unreviewed">Unreviewed</option><option value="good">Good</option><option value="watch">Watch</option><option value="concern">Concern</option><option value="high_risk">High Risk</option></select></div><div id="executive-org-results"></div></div></section>`;
    const search = surface.querySelector("#executive-org-search");
    const verificationFilter = surface.querySelector("#executive-org-verification");
    const trustFilter = surface.querySelector("#executive-org-trust");
    const results = surface.querySelector("#executive-org-results");
    const render = () => {
      const query = lower(search?.value || "");
      const verificationValue = verificationFilter?.value || "";
      const trustValue = trustFilter?.value || "";
      const filtered = organizations.filter((org) => {
        if (verificationValue && org.verificationStatus !== verificationValue) return false;
        if (trustValue && org.trustLevel !== trustValue) return false;
        return !query || [org.name, org.cognitusId, org.id, org.organizationType, org.country, org.verificationStatus, org.trustLevel].some((value) => lower(String(value || "")).includes(query));
      });
      results.innerHTML = filtered.length ? `<div class="registry-list">${filtered.map((org) => {
        const linked = accounts.filter((account) => account.organizationId === org.id).length;
        return `<article class="registry-row"><div class="registry-main"><strong>${safe(org.name || "Unnamed Organization")}</strong><p>${safe(org.organizationType || "Organization")}${org.country ? ` · ${safe(org.country)}` : ""}</p><small>${safe(org.cognitusId || org.id)} · ${linked} linked account${linked === 1 ? "" : "s"}</small></div><div class="registry-badges">${badge(org.verificationStatus)} ${badge(org.trustLevel)}</div><div class="registry-actions"><button class="button button-small ${canManageRegistry ? 'button-dark' : ''}" type="button" data-open-org="${safe(org.id)}">${canManageRegistry ? "Edit" : "View"}</button></div></article>`;
      }).join("")}</div>` : emptyState("OR", "No organizations matched", "Change the search or filters to see other organizations.");
      results.querySelectorAll("[data-open-org]").forEach((button) => button.addEventListener("click", () => openOrganization(button.dataset.openOrg)));
    };
    [search, verificationFilter, trustFilter].forEach((node) => node?.addEventListener(node?.tagName === "INPUT" ? "input" : "change", debounce(render, 70)));
    render();
  };

  root.querySelectorAll("[data-registry-tab]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.registryTab === activeTab) return;
    button.dataset.registryTab === "organizations" ? renderOrganizations() : renderAccounts();
  }));
  renderAccounts();
}
'''

text = text[:start] + replacement + text[end:]

style_marker = '    @media(max-width:1080px)'
registry_css = r'''    .registry-tabs{display:flex;gap:8px;align-items:center;margin:18px 0 12px}.registry-count{opacity:.65;margin-left:5px}.registry-toolbar{display:grid;grid-template-columns:minmax(250px,1fr) repeat(3,minmax(145px,.35fr));gap:8px;margin-bottom:14px}.registry-list{border:1px solid #eee}.registry-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(220px,.65fr) auto;gap:14px;align-items:center;padding:15px 16px;border-bottom:1px solid #eee;background:#fff}.registry-row:last-child{border-bottom:0}.registry-main{min-width:0}.registry-main strong{font-size:12px}.registry-main p{font-size:9px;color:#666;margin:5px 0}.registry-main small{display:block;font-size:8px;color:#888;overflow-wrap:anywhere}.registry-name{display:flex;align-items:center;gap:7px}.registry-staff{font-size:7px;font-weight:900;letter-spacing:.08em;border:1px solid #111;padding:2px 4px}.registry-badges,.registry-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.registry-actions{justify-content:flex-end}.registry-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.46);z-index:140}.registry-drawer{position:fixed;top:0;right:0;bottom:0;width:min(620px,94vw);background:#fff;z-index:141;overflow:auto;box-shadow:-18px 0 50px rgba(0,0,0,.16);padding:22px}.registry-drawer-open{overflow:hidden}.registry-drawer-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding-bottom:16px;border-bottom:1px solid #e8e8e8}.registry-drawer-header h2{margin:3px 0 7px;font-size:24px;letter-spacing:-.04em}.registry-drawer-header p:not(.eyebrow){font-size:10px;line-height:1.6;color:#666;max-width:470px}.registry-form{display:grid;gap:14px;margin-top:14px}.registry-section{border:1px solid #e7e7e7;padding:16px}.registry-section-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:13px}.registry-section-title strong{font-size:11px}.registry-section-title span{font-size:8px;color:#888}.registry-check{display:flex!important;flex-direction:row!important;align-items:flex-start;gap:10px;border:1px solid #e7e7e7;padding:12px;margin-top:12px}.registry-check input{width:auto!important;margin-top:2px}.registry-check span,.registry-check strong,.registry-check small{display:block}.registry-check small{margin-top:3px;color:#777}.registry-dl{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;margin:0}.registry-dl dt{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#777}.registry-dl dd{margin:0;font-size:9px;overflow-wrap:anywhere}.registry-savebar{position:sticky;bottom:-22px;background:#fff;border-top:1px solid #ddd;padding:14px 0 2px;display:flex;align-items:center;gap:12px;z-index:2}.registry-savebar span{font-size:8px;color:#777}.registry-danger{margin-top:18px;border:1px solid #111;padding:16px;display:flex;justify-content:space-between;gap:16px;align-items:center}.registry-danger strong{font-size:11px}.registry-danger p{font-size:9px;color:#666;line-height:1.55;margin:5px 0 0;max-width:390px}.registry-readonly{background:#fafafa}
'''
if 'registry-drawer{' not in text:
    text = text.replace(style_marker, registry_css + style_marker)
text = text.replace('const BUILD = "command-g3-2026-09-06";', 'const BUILD = "command-g3-executive-registry-2026-09-07";')
text = text.replace('@media(max-width:720px){.g3-grid,.g3-grid.two,.g3-kpi{grid-template-columns:1fr}.g3-queue-item{grid-template-columns:1fr}.g3-actions{justify-content:flex-start}.g3-page-header{align-items:flex-start}}', '@media(max-width:720px){.g3-grid,.g3-grid.two,.g3-kpi{grid-template-columns:1fr}.g3-queue-item{grid-template-columns:1fr}.g3-actions{justify-content:flex-start}.g3-page-header{align-items:flex-start}.registry-toolbar{grid-template-columns:1fr}.registry-row{grid-template-columns:1fr;gap:9px}.registry-actions{justify-content:flex-start}.registry-drawer{width:100vw;padding:16px}.registry-drawer-header{position:sticky;top:-16px;background:#fff;z-index:3;padding-top:16px}.registry-danger{align-items:flex-start;flex-direction:column}.registry-savebar{bottom:-16px}.registry-dl{grid-template-columns:95px minmax(0,1fr)}}')

path.write_text(text)
print('Executive Registry v2 applied')
