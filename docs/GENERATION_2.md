# Cognitus Staff / Command — Generation 2

Generation 2 is the company-operations layer of Cognitus Command. It extends the Generation 1 staff identity and permission boundary; it does not introduce a second account system or a second Firebase project.

## Operating surfaces

| Surface | Collection | Core access model |
| --- | --- | --- |
| Tasks | `commandTasks` | assignee, creator, authorized department leadership, Owner |
| Requests | `commandRequests` | requestor and authorized destination-department leadership |
| Projects | `commandProjects` | company/department visibility; lead or department leadership controls state |
| Meetings | `commandMeetings` | company or department visibility; controlled publishing |
| Announcements | `commandAnnouncements` | company or department visibility; controlled publishing |
| Documents | `commandDocuments` | company or department visibility; controlled library publishing |
| Service Desk | `commandTickets` | requestor or authorized ticket readers/managers |
| Leave | `commandLeave` | employee and explicit HR readers/managers |
| Employee Lifecycle | `commandLifecycle` | explicit HR read/manage permissions |
| Finance | `commandFinance` | explicit finance read/manage permissions |
| Payroll | `commandPayroll` | employee's own statement or explicit payroll authority |

## Authorization principles

### Staff session requirement

Every Generation 2 operational surface requires the existing Generation 1 Command security boundary:

1. authenticated Cognitus user;
2. active Cognitus account;
3. `staffAccess/{uid}` exists;
4. staff status is active/training/on-leave;
5. `portal.access` is present.

The Cognitus Owner initializes Command through Generation 1 before Generation 2 is available.

### Department authority

Department leadership is explicit rather than inferred from a title. Where department-level management is supported, the signed-in staff record must carry the relevant permission and the target record must belong to that same department.

### Sensitive operations

HR, Finance, and Payroll never rely on the ordinary staff permission bundle:

- HR reading: `hr.records.read` / `hr.records.manage`
- HR changes: `hr.records.manage`
- Finance reading: `finance.read` / `finance.manage`
- Finance changes: `finance.manage`
- Payroll broad reading: `payroll.read` / `payroll.manage`
- Payroll creation/status changes: `payroll.manage`

An employee may still read their own payroll statement without receiving company-wide payroll visibility.

### Ticket distinction

`tickets.all.read` is intentionally read-only. Ticket status changes require the Owner or a `tickets.manage` staff member operating within the appropriate department.

## Collection shapes

The schemas below summarize the fields created by Generation 2. Firestore Security Rules contain the authoritative schema validation.

### `commandTasks/{taskId}`

- `id`
- `title`
- `description`
- `priority`
- `status`
- `assignedToUid`
- `ownerUid`
- `createdByUid`
- `departmentId`
- `dueAt`
- `completedAt`
- `createdAt`
- `updatedAt`

### `commandRequests/{requestId}`

- `id`
- `requestorUid`
- `departmentId`
- `type`
- `title`
- `details`
- `status`
- `reviewedByUid`
- `reviewedAt`
- `resolutionNote`
- timestamps

### `commandProjects/{projectId}`

- project title/description
- lifecycle status
- company or department visibility
- department
- lead UID
- member UID list
- due date
- creator/timestamps

### `commandMeetings/{meetingId}`

- title and summary
- start/end timestamps
- location
- optional HTTPS meeting URL
- company/department visibility
- organizer UID
- timestamps

### `commandAnnouncements/{announcementId}`

- title/body
- company/department audience
- department where applicable
- priority
- pinned flag
- publish/expiration timestamps
- creator UID

### `commandDocuments/{documentId}`

Generation 2 intentionally uses links instead of storing files in Firebase:

- title/description
- HTTPS document URL
- category
- company/department visibility
- department where applicable
- creator/timestamps

### `commandTickets/{ticketId}`

- requester UID
- destination department
- category and priority
- subject/details
- status
- assigned staff UID
- resolution timestamp
- timestamps

### `commandLeave/{leaveId}`

- requestor UID / Employee ID
- leave type
- start/end timestamps
- reason
- review status
- reviewer UID/time/note
- timestamps

### `commandLifecycle/{recordId}`

- employee UID
- action (`onboarding`, `transfer`, `promotion`, `status_change`, `offboarding`)
- title/notes
- checklist and completed-step arrays
- status/completion timestamp
- opener UID/timestamps

### `commandFinance/{entryId}`

- entry type
- amount in integer cents
- category/memo
- department
- status
- submitter/approver UIDs
- approval and occurrence timestamps

Money is stored as integer cents rather than floating point.

### `commandPayroll/{statementId}`

- employee UID
- period label/start/end
- gross, adjustments, and net amounts in integer cents
- status
- notes
- creator/approver UIDs
- paid timestamp
- record timestamps

## Notifications and audit

Generation 2 reuses existing shared collections rather than creating duplicate subsystems:

- actionable events may write to `staffInbox` for the relevant employee;
- significant mutations make best-effort entries in the main Cognitus `auditLogs` collection.

Firestore remains authoritative even if an auxiliary notification or audit write cannot be completed.

## Query / index policy

Generation 2 intentionally does not add a composite-index configuration. Client data access is designed around automatically indexed single-field queries such as:

- tasks by assignee, creator, or department;
- requests by requestor or department;
- records by company visibility or department;
- leave by requestor;
- payroll by employee;
- tickets by requester or destination department.

Where a user is authorized through more than one relationship, Command performs several permitted single-field queries, deduplicates the results, and sorts them in the browser.

## Deployment boundary

The authoritative rules are in `Silly-Cheese/cognitus-solutions/firestore.rules`. The fragment in this repository exists for documentation, validation, and controlled integration. GitHub commits do not deploy Firestore Security Rules to Firebase; the production rules still need to be deployed through Firebase after integration.
