export const DEPARTMENTS = Object.freeze([
  {
    id: "executive-office",
    code: "EXEC",
    name: "Executive Office",
    shortName: "Executive",
    chiefTitle: "Founder / Chief Executive Officer",
    description: "Company-wide direction, executive governance, cross-department approvals, and Cognitus command oversight.",
    focus: ["Executive governance", "Company strategy", "Critical approvals", "Department oversight"]
  },
  {
    id: "public-relations",
    code: "PR",
    name: "Public Relations",
    shortName: "Public Relations",
    chiefTitle: "Chief Public Relations Officer",
    description: "Cognitus public communications, campaigns, partnerships, publications, events, and brand stewardship.",
    focus: ["Campaigns", "Publications", "Partnerships", "Brand & media"]
  },
  {
    id: "customer-service",
    code: "CS",
    name: "Customer Service",
    shortName: "Customer Service",
    chiefTitle: "Chief Customer Service Officer",
    description: "Customer support, service tickets, user assistance, complaint intake, and cross-department escalation routing.",
    focus: ["Support tickets", "Customer assistance", "Complaints", "Escalations"]
  },
  {
    id: "finance",
    code: "FIN",
    name: "Finance",
    shortName: "Finance",
    chiefTitle: "Chief Financial Officer",
    description: "Payroll, budgets, expenses, revenue, purchase approvals, financial controls, and finance auditing.",
    focus: ["Payroll", "Budgets", "Expenses & revenue", "Financial approvals"]
  },
  {
    id: "human-resources",
    code: "HR",
    name: "Human Resources",
    shortName: "Human Resources",
    chiefTitle: "Chief Human Resources Officer",
    description: "Employee lifecycle management, onboarding, leave, transfers, internal affairs, and staff records.",
    focus: ["People operations", "Onboarding", "Employee records", "Internal affairs"]
  },
  {
    id: "quality-assurance",
    code: "QA",
    name: "Quality Assurance",
    shortName: "Quality Assurance",
    chiefTitle: "Chief Quality Assurance Officer",
    description: "Operational quality review, audits, compliance, corrective action, and company-wide quality standards.",
    focus: ["QA reviews", "Audits", "Compliance", "Corrective actions"]
  }
]);

export const DEPARTMENT_MAP = Object.freeze(
  Object.fromEntries(DEPARTMENTS.map((department) => [department.id, department]))
);

export const RANKS = Object.freeze([
  { id: "owner", label: "Owner", level: 100 },
  { id: "co-owner", label: "Co-Owner", level: 100 },
  { id: "chief-officer", label: "Chief Officer", level: 90 },
  { id: "director", label: "Director", level: 75 },
  { id: "manager", label: "Manager", level: 60 },
  { id: "supervisor", label: "Supervisor", level: 50 },
  { id: "senior-staff", label: "Senior Staff", level: 40 },
  { id: "staff", label: "Staff", level: 30 },
  { id: "trainee", label: "Trainee", level: 20 },
  { id: "restricted", label: "Restricted", level: 0 }
]);

export const RANK_MAP = Object.freeze(
  Object.fromEntries(RANKS.map((rank) => [rank.id, rank]))
);

export function getDepartment(id) {
  return DEPARTMENT_MAP[id] || {
    id: id || "unknown",
    code: "—",
    name: "Unassigned",
    shortName: "Unassigned",
    chiefTitle: "Department Leadership",
    description: "This employee has not been assigned to a recognized Cognitus department.",
    focus: []
  };
}

export function getRank(id) {
  return RANK_MAP[id] || { id: id || "unknown", label: "Staff", level: 0 };
}
