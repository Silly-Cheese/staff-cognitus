# Cognitus Staff / Command

Cognitus Staff / Command is the internal employee, company-operations, department-command, and executive portal for Cognitus Solutions.

It is intentionally separate from the public/product Cognitus portal while using the same Firebase project, the same Cognitus Authentication identity, and the same authoritative Firestore database.

```text
projectId: cognitus-solutions
```

## Generation 1 — Command Foundation

Generation 1 established the secure staff layer:

- same Firebase project and Cognitus credentials as the main site
- staff-only access gate backed by `staffAccess/{uid}`
- safe first-owner Command bootstrap
- staff directory and employee profiles
- departments and Chief Officer / Board-level structure
- permission-driven navigation
- Command search
- Staff Inbox
- existing-Cognitus-user staff provisioning
- audit activity integration
- responsive Cognitus design
- no composite-index dependency

## Generation 2 — Company Portal

Generation 2 added the day-to-day company operating systems:

- Tasks
- Requests
- Projects
- Meetings
- Announcements
- Documents
- Service Desk / Tickets
- Leave
- Employee Lifecycle / HR
- Finance
- Payroll

Generation 2 collections:

- `commandTasks`
- `commandRequests`
- `commandProjects`
- `commandMeetings`
- `commandAnnouncements`
- `commandDocuments`
- `commandTickets`
- `commandLeave`
- `commandLifecycle`
- `commandFinance`
- `commandPayroll`

See `docs/GENERATION_2.md`.

## Generation 3 — Command Operations

Generation 3 turns the portal into the full operational center for Cognitus.

### Command

- **Command Overview** — live human-review and casework workload
- **Report Review** — submitted-report decisions
- **Claims** — standard claims and employer-created profile claims
- **Appeals** — appeal/correction decisions and linked report handling
- **Organization Review** — organization verification and employer-status requests
- **Case Files** — internal operational investigations/casework
- **Evidence Register** — case-linked evidence metadata and HTTPS references
- **Accreditation** — organization accreditation lifecycle
- **Escalations** — cross-department escalation records
- **Incidents** — exceptional security, data, abuse, organization, and system incidents

**Background checks remain automatic and self-service. There is no staff background-check approval queue.**

### Department Command

Every department receives a live department dashboard combining roster, leadership, tasks, tickets, requests, projects, and its specialist system.

Specialist workspaces include:

- Public Relations Command
- Customer Service Command
- Quality Assurance Command
- Finance + Payroll
- Human Resources / Employee Lifecycle
- Executive Command

### Quality Assurance

- QA reviews
- 0–100 scoring
- findings
- corrective actions
- department and employee attribution
- QA workload metrics

QA is a sampling/improvement system, not a mandatory approval gate for all Cognitus work.

### Public Relations

- campaigns
- publications
- partnerships
- media inquiries
- brand resources
- crisis communications
- PR approval queue

### Customer Service

- Customer Service service-health dashboard
- support-ticket metrics
- saved-response guidance
- escalation-oriented support workflow

Customer Service may help users with background-check problems, but it does not approve or alter background checks merely because a user asked for help.

### Executive / Board of Directors

- company-wide Executive Command dashboard
- Chief Officer roster
- department workload snapshots
- incidents and escalations
- executive approval center
- searchable Audit Center

Generation 3 collections:

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

See `docs/GENERATION_3.md`.

## Main Cognitus integration

The main `Silly-Cheese/cognitus-solutions` site is now treated as the customer/product application.

For an account with active Command access, the main navigation exposes **Staff Command**.

The old main-site `#/review` and `#/admin` routes are retired as working internal interfaces and instead direct staff to Cognitus Staff / Command. The product role system remains for compatibility, while internal authority is increasingly based on explicit staff permissions such as:

- `reports.review`
- `claims.review`
- `appeals.review`
- `verification.review`
- `organizations.review`
- `cases.read`
- `cases.manage`
- `evidence.read`
- `evidence.manage`
- `accreditation.manage`
- `escalations.manage`
- `incidents.manage`
- `qa.read`
- `qa.manage`
- `qa.audit`
- `pr.manage`
- `pr.approve`
- `cs.manage`
- `audit.read`
- `system.manage`

## Authentication and staff identity

Employees use their normal Cognitus credentials:

- Discord ID
- Cognitus password

The Discord ID maps to the same synthetic Firebase Authentication address used by the main site:

```text
<discordId>@cognitus.local
```

There is no public Staff / Command signup flow.

Staff data is separated by sensitivity:

- `staffDirectory/{uid}` — internal-safe directory information
- `staffAccess/{uid}` — rank, department, status, and permissions
- `staffEmployment/{uid}` — restricted HR/employment data
- `staffInbox/{notificationId}` — employee-scoped action notifications

## Security model

Frontend route hiding is never treated as authorization. Firestore Security Rules are the real boundary.

Key rules:

- authenticated product access does not imply staff access
- Command requires active `staffAccess` with `portal.access`
- department/rank labels are not a substitute for explicit permissions
- sensitive HR, Finance, Payroll, QA, case, evidence, and executive areas have separate authorization
- `tickets.all.read` remains read-only authority
- PR management and PR approval are distinct
- Customer Service does not inherit report/profile mutation authority
- destructive deletes are denied for the Command operational collections
- no composite indexes are required

## Firestore ownership

The authoritative production rules remain in:

`Silly-Cheese/cognitus-solutions/firestore.rules`

This repository contains reference fragments:

- `firestore.command.rules.fragment` — Generation 1
- `firestore.command.g2.rules.fragment` — Generation 2
- `firestore.command.g3.rules.fragment` — Generation 3

Do not deploy a competing ruleset from this repository to the shared database.

Committing the rules to GitHub does not publish them to Firebase. Production activation still requires the current main-site rules to be deployed:

```bash
firebase deploy --only firestore:rules
```

## Audit limitation

Cognitus records authenticated client activity in `auditLogs`. This provides operational traceability, but it is not equivalent to a trusted-server tamper-evident audit ledger. A future backend can strengthen that guarantee without changing the portal architecture.

## Hosting

The portal is static and designed for GitHub Pages. Generations 1–3 require no Firebase Hosting or Cloud Functions.
