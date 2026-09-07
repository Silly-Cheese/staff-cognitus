from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise RuntimeError(f"Missing expected pattern for {label}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Rank + permission model
# ---------------------------------------------------------------------------
departments_path = Path("src/config/departments.js")
departments = departments_path.read_text(encoding="utf-8")
departments = replace_once(
    departments,
    '  { id: "owner", label: "Owner", level: 100 },\n  { id: "chief-officer", label: "Chief Officer", level: 90 },',
    '  { id: "owner", label: "Owner", level: 100 },\n  { id: "co-owner", label: "Co-Owner", level: 100 },\n  { id: "chief-officer", label: "Chief Officer", level: 90 },',
    "co-owner rank",
)
departments_path.write_text(departments, encoding="utf-8")

permissions_path = Path("src/config/permissions.js")
permissions = permissions_path.read_text(encoding="utf-8")
permissions = replace_once(
    permissions,
    '  PROFILE_READ: "profile.read",\n  DEPARTMENT_READ: "department.read",',
    '  PROFILE_READ: "profile.read",\n  ACCOUNTS_READ_ALL: "accounts.read.all",\n  DEPARTMENT_READ: "department.read",',
    "all-accounts permission",
)
for bundle_name in [
    '"chief-public-relations"',
    '"chief-customer-service"',
    '"chief-financial-officer"',
    '"chief-human-resources"',
    '"chief-quality-assurance"',
]:
    permissions = replace_once(
        permissions,
        f"  {bundle_name}: [\n    ...CORE,",
        f"  {bundle_name}: [\n    ...CORE,\n    PERMISSIONS.ACCOUNTS_READ_ALL,",
        f"executive account visibility for {bundle_name}",
    )
permissions = replace_once(
    permissions,
    "  owner: PERMISSION_VALUES\n});",
    "  \"co-owner\": PERMISSION_VALUES,\n  owner: PERMISSION_VALUES\n});",
    "co-owner full permission bundle",
)
permissions_path.write_text(permissions, encoding="utf-8")

# ---------------------------------------------------------------------------
# Base router + Staff Administration
# ---------------------------------------------------------------------------
app_path = Path("src/app.js")
app = app_path.read_text(encoding="utf-8")
extension_routes = '''const EXTENSION_ROUTES = new Set([\n  "/tasks", "/requests", "/projects", "/meetings", "/announcements", "/documents",\n  "/tickets", "/leave", "/hr/lifecycle", "/finance", "/payroll",\n  "/command", "/command/reports", "/command/claims", "/command/appeals",\n  "/command/organizations", "/command/cases", "/command/evidence",\n  "/command/accreditation", "/command/escalations", "/command/incidents",\n  "/department-command", "/quality", "/public-relations", "/customer-service",\n  "/executive", "/executive/accounts", "/executive/approvals", "/executive/audit"\n]);\n\n'''
app = replace_once(app, "]);\n\nfunction setTitle(title) {", "]);\n\n" + extension_routes + "function setTitle(title) {", "extension route deferral")
app = replace_once(
    app,
    '''function isMainOwner() {\n  return state.userRecord?.status === "active" && state.userRecord?.role === "owner";\n}\n\nfunction can(permission) {\n  return hasPermission(state.staffAccess, permission) || (isMainOwner() && state.staffAccess?.status === "active");\n}''',
    '''function isMainOwner() {\n  return state.userRecord?.status === "active" && state.userRecord?.role === "owner";\n}\n\nfunction isCoOwner() {\n  return Boolean(isActiveStaff(state.staffAccess) && state.staffAccess?.rank === "co-owner");\n}\n\nfunction isExecutiveOwner() {\n  return isMainOwner() || isCoOwner();\n}\n\nfunction can(permission) {\n  return hasPermission(state.staffAccess, permission) || (isExecutiveOwner() && state.staffAccess?.status === "active");\n}''',
    "co-owner client authority",
)
app = app.replace("return isMainOwner() || can(PERMISSIONS.STAFF_PROVISION);", "return isExecutiveOwner() || can(PERMISSIONS.STAFF_PROVISION);")
app = app.replace("&& !isMainOwner()) return false;", "&& !isExecutiveOwner()) return false;")
app = app.replace("if (!isActiveStaff(state.staffAccess) && !isMainOwner()) return;", "if (!isActiveStaff(state.staffAccess) && !isExecutiveOwner()) return;")
app = app.replace('department.id !== "executive-office" || isMainOwner()', 'department.id !== "executive-office" || isExecutiveOwner()')
app = replace_once(
    app,
    '${RANKS.filter((rank) => rank.id !== "owner").map((rank) => `<option value="${safe(rank.id)}">${safe(rank.label)}</option>`).join("")}',
    '${RANKS.filter((rank) => rank.id !== "owner" && (rank.id !== "co-owner" || isExecutiveOwner())).map((rank) => `<option value="${safe(rank.id)}">${safe(rank.label)}</option>`).join("")}',
    "co-owner staff rank option",
)
app = replace_once(
    app,
    '<option value="chief-quality-assurance">Chief Quality Assurance Officer</option></select></label>',
    '<option value="chief-quality-assurance">Chief Quality Assurance Officer</option>${isExecutiveOwner() ? `<option value="co-owner">Co-Owner — Full Executive Access</option>` : ""}</select></label>',
    "co-owner preset option",
)
app = replace_once(
    app,
    '  if (!RANKS.some((rank) => rank.id === data.rank) || data.rank === "owner") return showNotice(message, "Choose a valid non-owner rank.", "error");\n  try {',
    '  if (!RANKS.some((rank) => rank.id === data.rank) || data.rank === "owner") return showNotice(message, "Choose a valid non-owner rank.", "error");\n  if (data.rank === "co-owner" && !isExecutiveOwner()) return showNotice(message, "Only an Owner or Co-Owner can appoint another Co-Owner.", "error");\n  if (data.rank === "co-owner" && data.departmentId !== "executive-office") return showNotice(message, "Co-Owners must be assigned to the Executive Office.", "error");\n  try {',
    "co-owner provisioning guard",
)
app = replace_once(
    app,
    "    const permissions = bundle(data.preset);",
    '    const permissions = bundle(data.rank === "co-owner" ? "co-owner" : data.preset);',
    "co-owner forced full permissions",
)
app = replace_once(
    app,
    '  root.querySelector("#provision-form")?.addEventListener("submit", provisionStaff);\n}',
    '''  const provisionForm = root.querySelector("#provision-form");\n  provisionForm?.addEventListener("submit", provisionStaff);\n  provisionForm?.querySelector('[name="rank"]')?.addEventListener("change", (event) => {\n    if (event.currentTarget.value !== "co-owner") return;\n    const departmentSelect = provisionForm.querySelector('[name="departmentId"]');\n    const presetSelect = provisionForm.querySelector('[name="preset"]');\n    if (departmentSelect) departmentSelect.value = "executive-office";\n    if (presetSelect?.querySelector('option[value="co-owner"]')) presetSelect.value = "co-owner";\n  });\n}''',
    "co-owner form behavior",
)
app = replace_once(
    app,
    '  if (current === "/admin/staff") return staffAdminPage();\n  return notFoundPage("Page not found", "The requested Cognitus Command route does not exist.");',
    '  if (current === "/admin/staff") return staffAdminPage();\n  if (EXTENSION_ROUTES.has(current)) return;\n  return notFoundPage("Page not found", "The requested Cognitus Command route does not exist.");',
    "base router extension deferral",
)
app_path.write_text(app, encoding="utf-8")

# ---------------------------------------------------------------------------
# Generation 2: Co-Owner gets the exact same client-side authority path as Owner.
# ---------------------------------------------------------------------------
g2_path = Path("src/generation2.js")
g2 = g2_path.read_text(encoding="utf-8")
g2 = replace_once(
    g2,
    '''function owner() {\n  return g2.userRecord?.status === "active" && g2.userRecord?.role === "owner";\n}''',
    '''function owner() {\n  return Boolean(\n    (g2.userRecord?.status === "active" && g2.userRecord?.role === "owner")\n    || (g2.userRecord?.status === "active" && isActiveStaff(g2.staffAccess) && g2.staffAccess?.rank === "co-owner")\n  );\n}''',
    "generation 2 co-owner authority",
)
g2_path.write_text(g2, encoding="utf-8")

# ---------------------------------------------------------------------------
# Generation 3: executive all-accounts page + Co-Owner authority.
# ---------------------------------------------------------------------------
g3_path = Path("src/generation3.js")
g3 = g3_path.read_text(encoding="utf-8")
g3 = replace_once(
    g3,
    '  "/executive",\n  "/executive/approvals",',
    '  "/executive",\n  "/executive/accounts",\n  "/executive/approvals",',
    "executive accounts route",
)
g3 = replace_once(
    g3,
    '["Executive Command", "Board-level company overview", "#/executive", "EX", [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ]],\n  ["Executive Approvals",',
    '["Executive Command", "Board-level company overview", "#/executive", "EX", [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ]],\n  ["All Accounts", "Every Cognitus account in one executive directory", "#/executive/accounts", "UA", PERMISSIONS.ACCOUNTS_READ_ALL],\n  ["Executive Approvals",',
    "command palette all-accounts entry",
)
g3 = replace_once(
    g3,
    '''function owner() {\n  return g3.userRecord?.status === "active" && g3.userRecord?.role === "owner";\n}''',
    '''function owner() {\n  return Boolean(\n    (g3.userRecord?.status === "active" && g3.userRecord?.role === "owner")\n    || (g3.userRecord?.status === "active" && isActiveStaff(g3.staffAccess) && g3.staffAccess?.rank === "co-owner")\n  );\n}''',
    "generation 3 co-owner authority",
)
g3 = replace_once(
    g3,
    '{ path: "/executive", label: "Executive Command", icon: "EX", permission: [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ] },\n      { path: "/executive/approvals",',
    '{ path: "/executive", label: "Executive Command", icon: "EX", permission: [PERMISSIONS.SYSTEM_MANAGE, PERMISSIONS.AUDIT_READ] },\n      { path: "/executive/accounts", label: "All Accounts", icon: "UA", permission: PERMISSIONS.ACCOUNTS_READ_ALL },\n      { path: "/executive/approvals",',
    "executive all-accounts navigation",
)
accounts_page = r'''async function accountsPage() {
  setTitle("All Accounts");
  if (!can(PERMISSIONS.ACCOUNTS_READ_ALL)) return forbidden("All Accounts");
  const accounts = alphabetic(await readCollection("users"), "displayName");
  const staffIds = new Set(g3.directory.map((entry) => entry.uid || entry.id));
  const activeCount = accounts.filter((entry) => entry.status === "active").length;
  const organizationCount = accounts.filter((entry) => entry.organizationId).length;
  const staffCount = accounts.filter((entry) => staffIds.has(entry.uid || entry.id)).length;

  root.innerHTML = `<div class="page-inner" data-g3-page="accounts">
    ${pageHeader("Executive · Account directory", "All Cognitus accounts.", "Executive visibility across every Cognitus account. Search by display name, Discord username/ID, Cognitus ID, UID, role, organization, or status.")}
    <section class="g3-kpi"><article><span>Total Accounts</span><strong>${accounts.length}</strong></article><article><span>Active</span><strong>${activeCount}</strong></article><article><span>Organization Linked</span><strong>${organizationCount}</strong></article><article><span>Staff Accounts</span><strong>${staffCount}</strong></article></section>
    <section class="panel" style="margin-top:18px"><header class="panel-header"><div><p class="eyebrow">Account directory</p><h2>Every account</h2></div></header><div class="panel-body"><div class="g3-toolbar"><div class="input-shell"><span class="input-icon">⌕</span><input id="executive-account-search" type="search" placeholder="Search all accounts…" autocomplete="off"></div><select id="executive-account-role"><option value="">All roles</option><option value="user">User</option><option value="verified_employer_member">Verified Employer Member</option><option value="org_admin">Organization Admin</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option><option value="owner">Owner</option></select></div><div id="executive-account-results"></div></div></section>
  </div>`;

  const search = root.querySelector("#executive-account-search");
  const roleFilter = root.querySelector("#executive-account-role");
  const results = root.querySelector("#executive-account-results");
  const render = () => {
    const query = lower(search?.value || "");
    const selectedRole = roleFilter?.value || "";
    const filtered = accounts.filter((account) => {
      if (selectedRole && account.role !== selectedRole) return false;
      if (!query) return true;
      return [
        account.displayName, account.discordUsername, account.discordId, account.cognitusId,
        account.uid || account.id, account.role, account.organizationId, account.status
      ].some((value) => lower(String(value || "")).includes(query));
    });
    results.innerHTML = filtered.length ? `<div class="g3-queue">${filtered.map((account) => {
      const uid = account.uid || account.id;
      const isStaffAccount = staffIds.has(uid);
      return `<article class="g3-queue-item"><div class="g3-queue-copy"><strong>${safe(account.displayName || account.discordUsername || "Cognitus Account")}</strong><p>${safe(account.discordUsername || "No Discord username")} · ${safe(account.discordId || "No Discord ID")}</p><small>${safe(account.cognitusId || uid)}${account.organizationId ? ` · Org ${safe(account.organizationId)}` : ""}</small></div><div>${badge(account.role)} ${badge(account.status)}</div><div>${isStaffAccount ? `<a class="button button-small" href="#/staff/${safe(uid)}">Staff Profile</a>` : ""}</div></article>`;
    }).join("")}</div>` : emptyState("UA", "No accounts matched", "Change the search or role filter to see other Cognitus accounts.");
  };
  search?.addEventListener("input", debounce(render, 80));
  roleFilter?.addEventListener("change", render);
  render();
}

'''
g3 = replace_once(g3, "async function executivePage() {", accounts_page + "async function executivePage() {", "all-accounts page implementation")
g3 = replace_once(
    g3,
    '    else if (current === "/executive") await executivePage();\n    else if (current === "/executive/approvals") await approvalsPage();',
    '    else if (current === "/executive") await executivePage();\n    else if (current === "/executive/accounts") await accountsPage();\n    else if (current === "/executive/approvals") await approvalsPage();',
    "all-accounts route handler",
)
g3_path.write_text(g3, encoding="utf-8")

# Basic invariants so the automated patch refuses to silently ship a partial edit.
checks = {
    "src/config/departments.js": ['id: "co-owner"'],
    "src/config/permissions.js": ['ACCOUNTS_READ_ALL: "accounts.read.all"', '"co-owner": PERMISSION_VALUES'],
    "src/app.js": ['const EXTENSION_ROUTES = new Set', 'function isExecutiveOwner()', 'data.rank === "co-owner"', 'if (EXTENSION_ROUTES.has(current)) return;'],
    "src/generation2.js": ['g2.staffAccess?.rank === "co-owner"'],
    "src/generation3.js": ['"/executive/accounts"', 'async function accountsPage()', 'PERMISSIONS.ACCOUNTS_READ_ALL', 'g3.staffAccess?.rank === "co-owner"'],
}
for filename, needles in checks.items():
    contents = Path(filename).read_text(encoding="utf-8")
    missing = [needle for needle in needles if needle not in contents]
    if missing:
        raise RuntimeError(f"{filename} missing required upgrades: {missing}")

print("Navigation, Co-Owner, and executive account visibility upgrade prepared successfully.")
