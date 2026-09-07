# Cognitus Staff / Command — Generation 3

Generation 3 completes the initial three-generation Cognitus Staff / Command build by adding the operational, department-specialist, quality, and executive systems that belong outside the customer-facing Cognitus product.

## Core principle

**Cognitus background checks remain automatic and self-service.**

Generation 3 does not create a background-check approval queue. Human Cognitus staff enter the workflow only when the work genuinely requires staff judgment: submitted reports, claims, appeals, organization/verification review, corrections, investigations, evidence, escalations, incidents, quality assurance, accreditation, support operations, public-relations work, or executive action.

## Command operations

Generation 3 adds these Command routes:

- `#/command` — Command operating overview
- `#/command/reports` — submitted-report review
- `#/command/claims` — standard claims and employer-created profile claims
- `#/command/appeals` — appeal and correction decisions
- `#/command/organizations` — organization verification and employer-status review
- `#/command/cases` — internal operational case files
- `#/command/evidence` — case-linked evidence register
- `#/command/accreditation` — organization accreditation lifecycle
- `#/command/escalations` — cross-department escalation center
- `#/command/incidents` — major operational/security/data incidents

The report, claim, appeal, organization, and employer-status queues work against the same product records used by the main Cognitus site. There is no duplicate synchronization database.

## Department Command

`#/department-command` gives every employee a live workspace for their assigned department. It brings together:

- department roster and Chief Officer
- open department tasks
- open department tickets
- pending department requests
- department projects
- the department's specialist system

Specialist systems are linked by department:

- Executive Office → Executive Command
- Public Relations → Public Relations Command
- Customer Service → Customer Service Command
- Finance → Finance and Payroll from Generation 2
- Human Resources → Employee Lifecycle / people operations from Generation 2
- Quality Assurance → Quality Assurance Command

## Quality Assurance

`#/quality` provides:

- QA review records
- 0–100 quality scoring
- findings
- department and employee attribution
- corrective-action creation
- open-finding tracking
- corrective-action completion
- quality metrics

QA is designed as sampling and improvement, not as a mandatory approval gate for every Cognitus action.

Collections:

- `commandQaReviews`
- `commandCorrectiveActions`

## Public Relations

`#/public-relations` provides:

- campaign records
- campaign objectives and audiences
- publication queue
- partnership work
- media inquiries
- brand resources
- crisis-communication items
- approval workflow for PR items

Collections:

- `commandPrCampaigns`
- `commandPrItems`

## Customer Service

`#/customer-service` provides:

- Customer Service ticket health
- open/high-priority/waiting ticket metrics
- direct link into the Generation 2 Service Desk
- saved-response guidance library
- background-check help as a **support category only**, never an approval queue

Collection:

- `commandCsMacros`

## Casework and intelligence

### Case files

`commandCases` stores internal operational cases. A case may reference a Cognitus profile, organization, report, or ticket. It provides a controlled place for work that spans more than one product record.

### Evidence

`commandEvidence` stores evidence metadata, notes, and optional HTTPS source references. It does not introduce unrestricted file uploads or Firebase Storage.

### Escalations

`commandEscalations` records cross-department or higher-authority escalations and keeps the source record linked.

### Incidents

`commandIncidents` is for exceptional situations such as security incidents, coordinated abuse, data-integrity concerns, major organization disputes, or system incidents.

## Accreditation

`commandAccreditations` supports:

- preliminary review
- documentation review
- risk assessment
- final review
- accredited
- denied
- conditional
- suspended
- expired

This is separate from ordinary organization verification.

## Executive / Board of Directors

Generation 3 adds:

- `#/executive` — company-wide executive operating dashboard
- `#/executive/approvals` — consequential approval queue
- `#/executive/audit` — searchable recent authenticated activity

Executive Command shows:

- active staff
- open tasks
- open cases
- open tickets
- active incidents
- escalations
- pending executive approvals
- employee-lifecycle actions
- Board-level Chief Officer roster
- department workload snapshots

### Executive approvals

`commandExecutiveApprovals` is intentionally separate from tickets. It is for consequential cross-company decisions such as policy exceptions, access changes, staffing decisions, financial decisions, and major operational approvals.

## New Generation 3 collections

- `commandCases`
- `commandEvidence`
- `commandAccreditations`
- `commandEscalations`
- `commandIncidents`
- `commandQaReviews`
- `commandCorrectiveActions`
- `commandPrCampaigns`
- `commandPrItems`
- `commandCsMacros`
- `commandExecutiveApprovals`

All collections are protected by the Generation 3 Firestore rule block in `firestore.command.g3.rules.fragment` and the matching integrated block in the authoritative main Cognitus `firestore.rules`.

## Existing product collection authority

Generation 3 also extends the shared Firestore rules so explicit Staff / Command permissions can perform the product-side work that has moved out of the main UI:

- `reports.review`
- `claims.review`
- `appeals.review`
- `verification.review`
- `organizations.review`
- `audit.read`

The product role system remains present for backward compatibility, but the Command portal uses explicit `staffAccess/{uid}` permissions for internal authority.

## Main-site migration

The main `cognitus-solutions` site now treats itself as the customer/product application.

For staff accounts with an active Command identity, the main navigation exposes **Staff Command**.

The old main-site `#/review` and `#/admin` routes no longer render their internal working interfaces. They display a migration surface directing authorized employees to Cognitus Staff / Command instead.

This prevents Cognitus from maintaining two competing internal operations interfaces.

## Security boundaries

Generation 3 follows these rules:

- an authenticated Cognitus account is not automatically a staff account
- Command requires an active `staffAccess/{uid}` record with `portal.access`
- report/claim/appeal permissions are explicit and separate
- case read and case management are separate permissions
- evidence read and evidence management are separate permissions
- QA permissions do not automatically grant arbitrary access to every Cognitus collection
- PR management and PR approval are distinct
- Customer Service does not receive report/profile mutation authority merely because it can handle tickets
- executive approval and system authority require Owner / `system.manage`
- audit viewing requires Owner / `audit.read`
- destructive deletes are denied for Generation 3 operational collections
- the no-composite-index policy remains in force

## Audit limitation

Cognitus continues to write authenticated client activity into `auditLogs`. This provides operational traceability, but it is not equivalent to a server-generated tamper-evident ledger. A future trusted backend could strengthen finance/security/audit guarantees without changing the Staff / Command information architecture.

## Firebase deployment

The authoritative Firestore rules are still owned by:

`Silly-Cheese/cognitus-solutions/firestore.rules`

The Staff / Command repository must not deploy an independent competing ruleset to the shared Firebase project.

After Generation 3 rule changes are committed, production activation still requires the current main rules to be deployed to Firebase:

```bash
firebase deploy --only firestore:rules
```

GitHub Pages deployment and Firestore rules deployment are separate actions.
