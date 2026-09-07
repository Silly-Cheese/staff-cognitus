# Cognitus Staff / Command

Cognitus Staff / Command is the internal employee and command portal for Cognitus Solutions.

## Generation 1

This build establishes the shared Cognitus staff foundation:

- same Firebase project and Cognitus account credentials as the main Cognitus Solutions portal
- staff-only access gate backed by `staffAccess/{uid}`
- safe first-owner Command bootstrap
- employee directory and employee profile surfaces
- department workspaces for Executive Office, Public Relations, Customer Service, Finance, Human Resources, and Quality Assurance
- Chief Officer / Board-level department structure
- permission-driven navigation and authorization helpers
- staff search / command palette foundation
- inbox foundation
- staff administration and existing-Cognitus-user provisioning for authorized leadership
- audit activity writes into the existing Cognitus `auditLogs` collection
- responsive black-and-white Cognitus interface
- no composite-index dependency

## Architecture

This portal is a separate website, but it intentionally connects to the existing Firebase project:

```text
projectId: cognitus-solutions
```

Cognitus users continue to use the public/product portal. Cognitus employees use this portal for internal work. The same Firebase Authentication identity is used on both sides.

### Staff records

Generation 1 separates staff data by sensitivity:

- `staffDirectory/{uid}` — safe internal directory data
- `staffAccess/{uid}` — rank, department, status, and security permissions
- `staffEmployment/{uid}` — restricted employment record

This separation is intentional because Firestore Security Rules authorize whole documents, not individual fields.

## Login

Employees use the same credentials as the main Cognitus portal:

- Discord ID
- Cognitus password

The Discord ID is converted to the same internal Firebase Authentication address used by the public portal:

```text
<discordId>@cognitus.local
```

There is no public staff signup flow.

## First owner setup

If the authenticated Cognitus account is an active main-site `owner` and no `staffAccess/{uid}` record exists, Command presents a one-time **Initialize Cognitus Command** action. It creates the owner's initial staff records with the Executive Office / Founder role.

This is not a public privilege-escalation mechanism: the matching Firestore rules must require the already-authenticated main Cognitus account to be an active `owner`.

## Hosting

The portal is static and designed for GitHub Pages. No Firebase Hosting or Cloud Functions are required for Generation 1.

Enable GitHub Pages from the `main` branch at repository root, or use the included Pages workflow.

## Firestore rules

The authoritative production rules remain in the **main `Silly-Cheese/cognitus-solutions` repository**. Do not deploy an independent ruleset from this repository to the shared database.

`docs/SHARED_FIRESTORE_RULES.md` documents the Generation 1 staff collections and required authorization model.

## No composite indexes

Generation 1 follows the same policy as the main Cognitus product:

- use automatically indexed fields
- keep security-compatible queries simple
- sort/filter authorized result sets in the browser when practical
- do not add `firestore.indexes.json`

## Security note

Frontend route hiding is not authorization. The portal checks access in the interface for usability, but Firestore Security Rules must remain the real security boundary.
