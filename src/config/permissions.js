export const PERMISSIONS = Object.freeze({
  PORTAL_ACCESS: "portal.access",
  DIRECTORY_READ: "directory.read",
  PROFILE_READ: "profile.read",
  ACCOUNTS_READ_ALL: "accounts.read.all",
  DEPARTMENT_READ: "department.read",
  DEPARTMENT_MANAGE: "department.manage",
  STAFF_PROVISION: "staff.provision",
  STAFF_MANAGE: "staff.manage",
  STAFF_PRIVATE_READ: "staff.private.read",
  PERMISSIONS_MANAGE: "permissions.manage",
  TICKETS_READ: "tickets.read",
  TICKETS_MANAGE: "tickets.manage",
  TICKETS_ALL_READ: "tickets.all.read",
  CS_MANAGE: "cs.manage",
  PR_MANAGE: "pr.manage",
  PR_APPROVE: "pr.approve",
  FINANCE_READ: "finance.read",
  FINANCE_MANAGE: "finance.manage",
  PAYROLL_READ: "payroll.read",
  PAYROLL_MANAGE: "payroll.manage",
  PAYROLL_APPROVE: "payroll.approve",
  HR_RECORDS_READ: "hr.records.read",
  HR_RECORDS_MANAGE: "hr.records.manage",
  INTERNAL_AFFAIRS_READ: "internalAffairs.read",
  INTERNAL_AFFAIRS_MANAGE: "internalAffairs.manage",
  QA_READ: "qa.read",
  QA_MANAGE: "qa.manage",
  QA_AUDIT: "qa.audit",
  REPORTS_REVIEW: "reports.review",
  CLAIMS_REVIEW: "claims.review",
  APPEALS_REVIEW: "appeals.review",
  VERIFICATION_REVIEW: "verification.review",
  ORGANIZATIONS_REVIEW: "organizations.review",
  CASES_READ: "cases.read",
  CASES_MANAGE: "cases.manage",
  EVIDENCE_READ: "evidence.read",
  EVIDENCE_MANAGE: "evidence.manage",
  ACCREDITATION_MANAGE: "accreditation.manage",
  ESCALATIONS_MANAGE: "escalations.manage",
  INCIDENTS_MANAGE: "incidents.manage",
  AUDIT_READ: "audit.read",
  SYSTEM_MANAGE: "system.manage",
  DISCORD_MEMBERS_KICK: "discord.members.kick"
});

export const PERMISSION_VALUES = Object.freeze(Object.values(PERMISSIONS));

const CORE = [
  PERMISSIONS.PORTAL_ACCESS,
  PERMISSIONS.DIRECTORY_READ,
  PERMISSIONS.PROFILE_READ,
  PERMISSIONS.DEPARTMENT_READ
];

export const PERMISSION_BUNDLES = Object.freeze({
  staff: CORE,
  supervisor: [
    ...CORE,
    PERMISSIONS.TICKETS_READ
  ],
  "chief-public-relations": [
    ...CORE,
    PERMISSIONS.ACCOUNTS_READ_ALL,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.PR_MANAGE,
    PERMISSIONS.PR_APPROVE,
    PERMISSIONS.TICKETS_READ
  ],
  "chief-customer-service": [
    ...CORE,
    PERMISSIONS.ACCOUNTS_READ_ALL,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.CS_MANAGE
  ],
  "chief-financial-officer": [
    ...CORE,
    PERMISSIONS.ACCOUNTS_READ_ALL,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_MANAGE,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.PAYROLL_APPROVE,
    PERMISSIONS.TICKETS_READ
  ],
  "chief-human-resources": [
    ...CORE,
    PERMISSIONS.ACCOUNTS_READ_ALL,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.STAFF_PRIVATE_READ,
    PERMISSIONS.HR_RECORDS_READ,
    PERMISSIONS.HR_RECORDS_MANAGE,
    PERMISSIONS.INTERNAL_AFFAIRS_READ,
    PERMISSIONS.INTERNAL_AFFAIRS_MANAGE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_MANAGE
  ],
  "chief-quality-assurance": [
    ...CORE,
    PERMISSIONS.ACCOUNTS_READ_ALL,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.QA_READ,
    PERMISSIONS.QA_MANAGE,
    PERMISSIONS.QA_AUDIT,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.AUDIT_READ
  ],
  "co-owner": PERMISSION_VALUES,
  owner: PERMISSION_VALUES
});

export const PERMISSION_LABELS = Object.freeze({
  "portal.access": "Staff / Command access",
  "directory.read": "Staff directory",
  "profile.read": "Staff profiles",
  "accounts.read.all": "All Cognitus accounts",
  "department.read": "Department workspaces",
  "department.manage": "Department management",
  "staff.provision": "Provision staff",
  "staff.manage": "Manage staff",
  "staff.private.read": "Private staff records",
  "permissions.manage": "Manage permissions",
  "tickets.read": "Read service tickets",
  "tickets.manage": "Manage service tickets",
  "tickets.all.read": "Read all service tickets",
  "cs.manage": "Customer Service management",
  "pr.manage": "Public Relations management",
  "pr.approve": "Approve Public Relations work",
  "finance.read": "Finance records",
  "finance.manage": "Manage finance",
  "payroll.read": "Payroll records",
  "payroll.manage": "Manage payroll",
  "payroll.approve": "Approve payroll",
  "hr.records.read": "HR records",
  "hr.records.manage": "Manage HR records",
  "internalAffairs.read": "Internal Affairs records",
  "internalAffairs.manage": "Manage Internal Affairs",
  "qa.read": "Quality Assurance records",
  "qa.manage": "Manage Quality Assurance",
  "qa.audit": "Conduct QA audits",
  "reports.review": "Review reports",
  "claims.review": "Review claims",
  "appeals.review": "Review appeals",
  "verification.review": "Review verification",
  "organizations.review": "Review organizations",
  "cases.read": "Read case files",
  "cases.manage": "Manage case files",
  "evidence.read": "Read evidence",
  "evidence.manage": "Manage evidence",
  "accreditation.manage": "Manage accreditation",
  "escalations.manage": "Manage escalations",
  "incidents.manage": "Manage incidents",
  "audit.read": "Audit Center",
  "system.manage": "System administration",
  "discord.members.kick": "Kick Discord members"
});

export const PROTECTED_PERMISSIONS = Object.freeze([
  PERMISSIONS.PERMISSIONS_MANAGE,
  PERMISSIONS.SYSTEM_MANAGE,
  PERMISSIONS.STAFF_PROVISION,
  PERMISSIONS.STAFF_MANAGE,
  PERMISSIONS.PAYROLL_APPROVE,
  PERMISSIONS.INTERNAL_AFFAIRS_MANAGE,
  PERMISSIONS.DISCORD_MEMBERS_KICK
]);

const RANK_BASE = Object.freeze({
  trainee: CORE,
  staff: CORE,
  "senior-staff": [...CORE, PERMISSIONS.TICKETS_READ],
  supervisor: [...CORE, PERMISSIONS.TICKETS_READ, PERMISSIONS.DEPARTMENT_MANAGE],
  manager: [...CORE, PERMISSIONS.TICKETS_READ, PERMISSIONS.DEPARTMENT_MANAGE],
  director: [...CORE, PERMISSIONS.TICKETS_READ, PERMISSIONS.DEPARTMENT_MANAGE],
  "chief-officer": [...CORE, PERMISSIONS.ACCOUNTS_READ_ALL, PERMISSIONS.DEPARTMENT_MANAGE],
  "co-owner": PERMISSION_VALUES,
  owner: PERMISSION_VALUES,
  restricted: [PERMISSIONS.PORTAL_ACCESS, PERMISSIONS.PROFILE_READ]
});

export function bundle(name) {
  return [...(PERMISSION_BUNDLES[name] || PERMISSION_BUNDLES.staff)];
}

export function recommendedPermissions(rank = "staff", departmentId = "") {
  if (rank === "owner" || rank === "co-owner") return [...PERMISSION_VALUES];
  const base = [...(RANK_BASE[rank] || RANK_BASE.staff)];
  const level = ({ trainee:20, staff:30, "senior-staff":40, supervisor:50, manager:60, director:75, "chief-officer":90 }[rank] || 30);
  const add = (...permissions) => permissions.forEach((permission) => {
    if (permission && !base.includes(permission)) base.push(permission);
  });

  if (departmentId === "customer-service") {
    add(PERMISSIONS.TICKETS_READ);
    if (level >= 50) add(PERMISSIONS.TICKETS_MANAGE, PERMISSIONS.CS_MANAGE);
    if (level >= 75) add(PERMISSIONS.TICKETS_ALL_READ);
  }
  if (departmentId === "public-relations") {
    if (level >= 40) add(PERMISSIONS.PR_MANAGE);
    if (level >= 75) add(PERMISSIONS.PR_APPROVE);
  }
  if (departmentId === "finance") {
    if (level >= 40) add(PERMISSIONS.FINANCE_READ, PERMISSIONS.PAYROLL_READ);
    if (level >= 60) add(PERMISSIONS.FINANCE_MANAGE, PERMISSIONS.PAYROLL_MANAGE);
    if (level >= 90) add(PERMISSIONS.PAYROLL_APPROVE);
  }
  if (departmentId === "human-resources") {
    if (level >= 40) add(PERMISSIONS.HR_RECORDS_READ, PERMISSIONS.STAFF_PRIVATE_READ);
    if (level >= 60) add(PERMISSIONS.HR_RECORDS_MANAGE, PERMISSIONS.TICKETS_MANAGE);
    if (level >= 75) add(PERMISSIONS.INTERNAL_AFFAIRS_READ);
    if (level >= 90) add(PERMISSIONS.STAFF_MANAGE, PERMISSIONS.INTERNAL_AFFAIRS_MANAGE);
  }
  if (departmentId === "quality-assurance") {
    if (level >= 40) add(PERMISSIONS.QA_READ);
    if (level >= 50) add(PERMISSIONS.QA_AUDIT);
    if (level >= 60) add(PERMISSIONS.QA_MANAGE);
    if (level >= 75) add(PERMISSIONS.AUDIT_READ);
  }
  if (departmentId === "executive-office" && level >= 75) {
    add(PERMISSIONS.ACCOUNTS_READ_ALL, PERMISSIONS.AUDIT_READ);
    if (level >= 90) add(PERMISSIONS.SYSTEM_MANAGE);
  }
  return [...new Set(base)];
}

export function permissionLabel(permission) {
  return PERMISSION_LABELS[permission] || permission;
}

export function effectivePermissions(staffAccess) {
  const direct = Array.isArray(staffAccess?.permissions) ? staffAccess.permissions : [];
  const discordManaged = Array.isArray(staffAccess?.discordRoleSync?.managedPermissions)
    ? staffAccess.discordRoleSync.managedPermissions
    : [];
  const denied = new Set(Array.isArray(staffAccess?.deniedPermissions) ? staffAccess.deniedPermissions : []);
  return [...new Set([...direct, ...discordManaged])].filter((permission) => !denied.has(permission));
}

export function permissionSources(staffAccess, permission) {
  const sources = [];
  if (Array.isArray(staffAccess?.permissions) && staffAccess.permissions.includes(permission)) sources.push("Cognitus");
  if (Array.isArray(staffAccess?.discordRoleSync?.managedPermissions) && staffAccess.discordRoleSync.managedPermissions.includes(permission)) sources.push("Discord role");
  if (Array.isArray(staffAccess?.deniedPermissions) && staffAccess.deniedPermissions.includes(permission)) sources.push("Explicitly denied");
  return sources;
}

export function hasPermission(staffAccess, permission) {
  return Boolean(
    staffAccess?.status &&
    ["active", "training", "on_leave"].includes(staffAccess.status) &&
    effectivePermissions(staffAccess).includes(permission)
  );
}

export function hasAnyPermission(staffAccess, permissions = []) {
  return permissions.some((permission) => hasPermission(staffAccess, permission));
}

export function isActiveStaff(staffAccess) {
  return Boolean(
    staffAccess &&
    ["active", "training", "on_leave"].includes(staffAccess.status) &&
    hasPermission(staffAccess, PERMISSIONS.PORTAL_ACCESS)
  );
}
