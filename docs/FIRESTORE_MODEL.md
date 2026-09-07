# Cognitus Staff / Command — Firestore Model

Generation 1 uses the existing `cognitus-solutions` Firebase project. The staff portal does not own a second database.

## Identity relationship

```text
Firebase Auth UID
      │
      ├── users/{uid}            main Cognitus account
      ├── profiles/{uid}         main Cognitus person profile
      │
      ├── staffDirectory/{uid}   internal-safe staff identity
      ├── staffAccess/{uid}      staff security/permission boundary
      └── staffEmployment/{uid}  restricted employment record
```

The UID is the canonical link. There is no duplicate staff authentication account.

## staffDirectory/{uid}

Safe internal-directory information:

```text
uid
employeeId
displayName
discordUsername
title
departmentId
rank
status
joinedAt
createdAt
updatedAt
```

Active Cognitus staff may read this collection for the company directory.

## staffAccess/{uid}

Security-sensitive staff authorization:

```text
uid
employeeId
departmentId
rank
accessLevel
status
permissions[]
grantedByUid
createdAt
updatedAt
```

This is the primary Staff / Command authorization record. Frontend navigation mirrors it for usability; Firestore rules remain authoritative.

### Staff statuses

```text
active
training
on_leave
suspended
former
```

Only `active`, `training`, and `on_leave` may enter Command when `portal.access` is present.

### Rank levels

```text
owner           100
chief-officer    90
director         75
manager          60
supervisor       50
senior-staff     40
staff            30
trainee          20
restricted        0
```

Rank is organizational metadata. Sensitive authorization should use explicit permission IDs rather than assuming rank alone grants access.

## staffEmployment/{uid}

Restricted employment information:

```text
uid
employeeId
employmentStatus
managerUid
hireDate
positionHistory[]
notes
createdAt
updatedAt
```

Ordinary staff can read their own record. HR/private-staff permissions are required for other employees' records.

## staffInbox/{notificationId}

Generation 1 notification foundation:

```text
id
recipientUid
senderUid
kind
title
message
href
readAt
createdAt
updatedAt
```

The recipient can read the notification. Generation 2 will expand this into the action inbox for tickets, approvals, tasks, payroll events, HR actions, and policy acknowledgements.

## Departments

Generation 1 recognizes:

```text
executive-office
public-relations
customer-service
finance
human-resources
quality-assurance
```

Board-level department leadership titles:

- Founder / Chief Executive Officer
- Chief Public Relations Officer
- Chief Customer Service Officer
- Chief Financial Officer
- Chief Human Resources Officer
- Chief Quality Assurance Officer

## No composite-index policy

All Generation 1 queries are intentionally simple:

- entire authorized staff directory, sorted in browser
- exact `users.discordId` lookup during staff provisioning
- `staffInbox.recipientUid == currentUid`

No manually maintained composite index is required.
