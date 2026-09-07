export const PERMISSIONS = Object.freeze({
  PORTAL_ACCESS: "portal.access",
  DIRECTORY_READ: "directory.read",
  PROFILE_READ: "profile.read",
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
  SYSTEM_MANAGE: "system.manage"
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
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.PR_MANAGE,
    PERMISSIONS.PR_APPROVE,
    PERMISSIONS.TICKETS_READ
  ],
  "chief-customer-service": [
    ...CORE,
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.CS_MANAGE
  ],
  "chief-financial-officer": [
    ...CORE,
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
    PERMISSIONS.DEPARTMENT_MANAGE,
    PERMISSIONS.QA_READ,
    PERMISSIONS.QA_MANAGE,
    PERMISSIONS.QA_AUDIT,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.AUDIT_READ
  ],
  owner: PERMISSION_VALUES
});

export function bundle(name) {
  return [...(PERMISSION_BUNDLES[name] || PERMISSION_BUNDLES.staff)];
}

export function hasPermission(staffAccess, permission) {
  return Boolean(
    staffAccess?.status &&
    ["active", "training", "on_leave"].includes(staffAccess.status) &&
    Array.isArray(staffAccess.permissions) &&
    staffAccess.permissions.includes(permission)
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
