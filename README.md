# Cognitus Staff / Command

Cognitus Staff / Command is the internal employee, company-operations, and leadership portal for Cognitus Solutions.

It is intentionally a separate website from the public/product Cognitus portal while using the same Firebase project, the same Cognitus Authentication identity, and the same authoritative Firestore database.

```text
projectId: cognitus-solutions
```

## Generation 1 — Command Foundation

Generation 1 established the secure staff layer:

- same Firebase project and Cognitus account credentials as the main Cognitus Solutions portal
- staff-only access gate backed by `staffAccess/{uid}`
- safe first-owner Command bootstrap
- employee directory and employee profile surfaces
- department workspaces for Executive Office, Public Relations, Customer Service, Finance, Human Resources, and Quality Assurance
- Chief Officer / Board-level department structure
- permission-driven navigation and authorization helpers
- staff search / Command palette foundation
- staff Inbox
- existing-Cognitus-user staff provisioning
- audit activity writes into the existing Cognitus `auditLogs` collection
- responsive black-and-white Cognitus interface
- no composite-index dependency

## Generation 2 — Company Portal

Generation 2 turns Command into the day-to-day operating system for Cognitus staff.

### Work management

- **Tasks** — personal assignments, department delegation, priority, due dates, blocked/in-progress/completed states
- **Requests** — internal requests routed to Cognitus departments with approval, decline, and closure workflows
- **Projects** — larger company or department initiatives with project leads, visibility, due dates, and lifecycle states
- **Meetings** — company/department meeting schedule with agendas, times, locations, and secure HTTPS meeting links

### Staff resources

- **Announcements** — official company-wide or department notices with priority, pinning, and expiration
- **Documents** — link-based policy, procedure, form, guide, training, and reference library
- **Service Desk** — internal support tickets with department routing, priority, claiming, and resolution
- **Leave** — employee time-away requests with HR review

### Management operations

- **Employee Lifecycle** — HR-controlled onboarding, transfer, promotion, status-change, and offboarding records
- **Finance** — internal operational ledger for expenses, income, purchases, reimbursements, and disposition
- **Payroll** — employee-scoped payroll statements with controlled payroll-management access

### Command integration

Generation 2 also extends the existing Command experience rather than creating a second internal app:

- the Generation 1 sidebar gains Work, Resources, and Management sections
- the Command palette includes Generation 2 destinations
- the dashboard receives an operations snapshot for open tasks, pending requests, and current announcements
- task/request/ticket/project/leave events can create notifications in the existing `staffInbox`
- significant actions make best-effort audit writes to the existing `auditLogs` collection

## Architecture

Employees still use their normal Cognitus credentials:

- Discord ID
- Cognitus password

The Discord ID is converted to the same internal Firebase Authentication address used by the main portal:

```text
<discordId>@cognitus.local
```

There is no public Staff / Command signup flow.

### Staff identity records

Staff data remains separated by sensitivity:

- `staffDirectory/{uid}` — internal-safe directory information
- `staffAccess/{uid}` — rank, department, status, and security permissions
- `staffEmployment/{uid}` — restricted HR/employment record
- `staffInbox/{notificationId}` — employee-scoped Command notifications

### Generation 2 operational collections

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

See `docs/GENERATION_2.md` for the detailed authorization and data model.

## Security model

Frontend route hiding is never treated as authorization. Firestore Security Rules remain the real security boundary.

Generation 2 follows these rules:

- Staff / Command requires an active `staffAccess` record with `portal.access`.
- Ordinary staff generally see records they own, created, or are assigned.
- department-management permissions expand authority only within the employee's department where appropriate.
- HR, Finance, Payroll, and administrative areas require their explicit existing permission families.
- `tickets.all.read` is read authority only; it does not grant ticket-write authority.
- company-wide publishing is restricted to Owner/system-management authority.
- Firestore records are schema constrained and destructive deletes are denied by the Generation 2 rules.

## Firestore rules

The authoritative production rules remain in the **main `Silly-Cheese/cognitus-solutions` repository** because both portals share one database.

This repository contains:

- `firestore.command.rules.fragment` — Generation 1 staff boundary
- `firestore.command.g2.rules.fragment` — Generation 2 company-operations boundary

The Generation 2 block is integrated into the main Cognitus `firestore.rules`. Committing rules to GitHub does **not** by itself publish them to Firebase; deployment remains a Firebase step.

## No composite indexes

Command deliberately avoids a `firestore.indexes.json` dependency. Generation 2 uses automatically indexed single-field query shapes and performs authorized combination/sorting in the browser when practical.

## Hosting

The portal is static and designed for GitHub Pages. It does not require Firebase Hosting or Cloud Functions for Generations 1–2.

If GitHub Pages is not yet enabled for this repository, enable Pages with **GitHub Actions** as the source and run the included deployment workflow.
