from pathlib import Path

APP = Path("src/generation3.js")
RULES = Path("firestore.command.g3.rules.fragment")

app = APP.read_text(encoding="utf-8")
rules = RULES.read_text(encoding="utf-8")

old_employer = '''  root.querySelectorAll("[data-employer-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await updateRecord("employerStatusRequests", button.dataset.id, { status: button.dataset.employerAction, reviewedAt: g3.Fire.serverTimestamp(), reviewedByUid: g3.authUser.uid, reviewerNotes: `Decision completed in Cognitus Command: ${button.dataset.employerAction}.` }, "COMMAND_EMPLOYER_STATUS", `Employer status ${button.dataset.employerAction}.`);
      toast("Employer-status decision saved.");
      await organizationsPage();
    } catch (error) { alert(error?.message || "Employer request decision failed."); button.disabled = false; }
  }));'''

new_employer = '''  root.querySelectorAll("[data-employer-action]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const action = button.dataset.employerAction;
      const requestRecord = await readDoc("employerStatusRequests", button.dataset.id);
      if (!requestRecord) throw new Error("Employer-status request no longer exists.");
      const batch = g3.Fire.writeBatch(g3.db);
      const now = g3.Fire.serverTimestamp();
      batch.update(g3.Fire.doc(g3.db, "employerStatusRequests", button.dataset.id), {
        status: action,
        reviewedAt: now,
        reviewedByUid: g3.authUser.uid,
        reviewerNotes: `Decision completed in Cognitus Command: ${action}.`,
        updatedAt: now
      });
      if (action === "approved") {
        batch.update(g3.Fire.doc(g3.db, "users", requestRecord.applicantUid), {
          role: "verified_employer_member",
          organizationId: requestRecord.organizationId,
          updatedAt: now
        });
      }
      await batch.commit();
      await writeActivity("COMMAND_EMPLOYER_STATUS", "employerStatusRequests", button.dataset.id, `Employer status ${action}.`);
      toast("Employer-status decision saved.");
      await organizationsPage();
    } catch (error) { alert(error?.message || "Employer request decision failed."); button.disabled = false; }
  }));'''

if old_employer in app:
    app = app.replace(old_employer, new_employer, 1)
elif 'batch.update(g3.Fire.doc(g3.db, "users", requestRecord.applicantUid)' not in app:
    raise RuntimeError("Could not locate employer-status decision handler")

# A PR manager may draft/submit/publish work, but only pr.approve/Owner may
# create an approval decision. Prevent direct-client status escalation.
old_create_tail = '''    && request.resource.data.createdByUid == request.auth.uid
    && request.resource.data.approvedByUid == null
    && request.resource.data.approvedAt == null
    && request.resource.data.createdAt == request.time'''
new_create_tail = '''    && request.resource.data.createdByUid == request.auth.uid
    && request.resource.data.status in ['draft', 'pending_approval']
    && request.resource.data.approvedByUid == null
    && request.resource.data.approvedAt == null
    && request.resource.data.createdAt == request.time'''
if old_create_tail in rules:
    rules = rules.replace(old_create_tail, new_create_tail, 1)
elif "request.resource.data.status in ['draft', 'pending_approval']" not in rules:
    raise RuntimeError("Could not harden PR create status")

old_manage_update = '''    && request.resource.data.createdByUid == resource.data.createdByUid
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.updatedAt == request.time
    && request.resource.data.diff(resource.data).changedKeys().hasOnly([
      'type', 'title', 'status', 'body', 'url', 'ownerUid', 'updatedAt'
    ]);'''
new_manage_update = '''    && request.resource.data.createdByUid == resource.data.createdByUid
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.status in ['draft', 'pending_approval', 'published', 'closed']
    && request.resource.data.approvedByUid == resource.data.approvedByUid
    && request.resource.data.approvedAt == resource.data.approvedAt
    && request.resource.data.updatedAt == request.time
    && request.resource.data.diff(resource.data).changedKeys().hasOnly([
      'type', 'title', 'status', 'body', 'url', 'ownerUid', 'updatedAt'
    ]);'''
if old_manage_update in rules:
    rules = rules.replace(old_manage_update, new_manage_update, 1)
elif "request.resource.data.status in ['draft', 'pending_approval', 'published', 'closed']" not in rules:
    raise RuntimeError("Could not harden PR manager update status")

APP.write_text(app, encoding="utf-8")
RULES.write_text(rules, encoding="utf-8")

checks = {
    "employer approval updates product user in same batch": 'batch.update(g3.Fire.doc(g3.db, "users", requestRecord.applicantUid)' in app,
    "PR create cannot self-approve": "request.resource.data.status in ['draft', 'pending_approval']" in rules,
    "PR manager cannot write approval state": "request.resource.data.status in ['draft', 'pending_approval', 'published', 'closed']" in rules,
    "PR manager preserves approval identity": 'request.resource.data.approvedByUid == resource.data.approvedByUid' in rules,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise RuntimeError("Generation 3 finalization failed: " + "; ".join(failed))

print("Finalized Cognitus Command Generation 3 security and employer-status workflow.")
