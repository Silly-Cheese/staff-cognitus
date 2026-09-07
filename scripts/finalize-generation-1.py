from pathlib import Path

path = Path("src/app.js")
text = path.read_text(encoding="utf-8")

replacements = {
'''function canManageStaff() {
  return isMainOwner() || canAny([PERMISSIONS.STAFF_PROVISION, PERMISSIONS.STAFF_MANAGE, PERMISSIONS.PERMISSIONS_MANAGE]);
}''': '''function canManageStaff() {
  // Generation 1's Staff Administration surface provisions accounts. Broader
  // HR employee-management controls arrive in Generation 2, so only explicit
  // provisioners (and the Cognitus Owner) should see this page today.
  return isMainOwner() || can(PERMISSIONS.STAFF_PROVISION);
}''',
'''  if (current === "/login") location.hash = "#/dashboard";''': '''  if (current === "/login") {
    location.hash = "#/dashboard";
    return;
  }'''
}

changed = False
for old, new in replacements.items():
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f"Expected Generation 1 target was not found: {old.splitlines()[0]}")
    text = text.replace(old, new, 1)
    changed = True

if changed:
    path.write_text(text, encoding="utf-8")
    print("Generation 1 finalization applied.")
else:
    print("Generation 1 finalization already applied.")
