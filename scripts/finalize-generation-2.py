from pathlib import Path

APP = Path("src/generation2.js")
RULES = Path("firestore.command.g2.rules.fragment")

app = APP.read_text(encoding="utf-8")
app = app.replace(
    'return Boolean(g2.authUser && g2.userRecord?.status === "active" && (owner() || isActiveStaff(g2.staffAccess)));',
    'return Boolean(g2.authUser && g2.userRecord?.status === "active" && isActiveStaff(g2.staffAccess));'
)
app = app.replace(
    'return owner() || can(PERMISSIONS.TICKETS_ALL_READ) || (can(PERMISSIONS.TICKETS_MANAGE) && id === departmentId());',
    'return owner() || (can(PERMISSIONS.TICKETS_MANAGE) && id === departmentId());'
)
app = app.replace('<option value="leadership">Department leadership</option>', '')
APP.write_text(app, encoding="utf-8")

rules = RULES.read_text(encoding="utf-8")
rules = rules.replace(
    "  return isOwner()\n    || staffPermission('tickets.all.read')\n    || (staffPermission('tickets.manage') && currentStaff().departmentId == departmentId);",
    "  return isOwner()\n    || (staffPermission('tickets.manage') && currentStaff().departmentId == departmentId);"
)
RULES.write_text(rules, encoding="utf-8")

checks = {
    "Generation 2 requires initialized staff access": '(owner() || isActiveStaff(g2.staffAccess))' not in app,
    "read-all ticket permission cannot modify tickets": 'owner() || can(PERMISSIONS.TICKETS_ALL_READ)' not in app,
    "leadership visibility is not presented without a dedicated query key": 'value="leadership"' not in app,
    "rule read-all ticket permission cannot modify tickets": "commandG2CanManageTicket(departmentId) {\n  return isOwner()\n    || staffPermission('tickets.all.read')" not in rules,
}

failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise RuntimeError("Generation 2 finalization failed: " + "; ".join(failed))

print("Finalized Cognitus Command Generation 2 security and visibility behavior.")
