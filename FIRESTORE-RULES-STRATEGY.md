# Cognitus Staff / Command — Firestore Rules Strategy

This portal should become easier to use without turning Firestore rules into a second application.

## Core rule

**New interface views do not get new Firestore collections just because they are new views.**

Home, Work Center, Resources, Leadership Hub, Department Command, and the mobile experience are presentation layers over the collections Cognitus already uses. A UI redesign should normally require **zero** Firestore rule changes.

## Stable security domains

Keep Staff / Command data inside the existing domains:

1. **Staff identity and access**
   - `staffAccess`
   - `staffDirectory`
   - `staffEmployment`
   - `staffInbox`

2. **Everyday staff work**
   - `commandTasks`
   - `commandRequests`
   - `commandProjects`
   - `commandMeetings`
   - `commandAnnouncements`
   - `commandDocuments`
   - `commandTickets`
   - `commandLeave`

3. **HR / finance**
   - existing `commandLifecycle`, finance, and payroll collections

4. **Command operations**
   - existing report, claim, appeal, organization, case, evidence, accreditation, escalation, and incident collections

5. **Department specialty systems**
   - existing QA, PR, and Customer Service collections

6. **Executive governance**
   - existing executive approvals, account registry access, and audit collections

## When a rules change is justified

A new rule or collection should only be added when the underlying **security boundary or business record is genuinely new**. A new page, dashboard, tab, filter, card, or combined queue is not a sufficient reason.

Before adding a collection, ask:

- Can this be represented by an existing record type?
- Is the required access already covered by an existing permission?
- Can the view combine existing collections client-side instead?
- Can a single-field query plus client-side sorting solve it without a composite index?

If the answer to any of those is yes, prefer the existing model.

## Query policy

Staff / Command intentionally avoids composite indexes for the V4 shell.

- Use one equality filter per Firestore query where practical.
- Merge duplicate results client-side.
- Sort and rank results client-side.
- Do not add `orderBy()` to `src/command-v4.js`.
- Do not add `firestore.indexes.json` for the staff portal.

The repository validation workflow enforces the no-composite-index policy.

## Permission policy

Do not create a permission for every screen. Permissions represent authority, not navigation.

For example, `hr.records.manage` should authorize HR management whether the user reaches it from Leadership Hub, Department Command, or a deep link. The UI may hide irrelevant systems, but Firestore remains the final authority.

## Navigation policy

The permanent staff navigation should stay small:

- Home
- Work Center
- My Department
- People
- Resources
- Inbox
- Leadership Hub, only when the account has management or Command authority

Specialized pages remain available as deep workspaces, but they do not all need permanent sidebar entries.

## Result

This keeps the portal easier for employees while keeping Firestore rules stable. Most future Staff / Command improvements should be UI composition work, not security-model expansion.
