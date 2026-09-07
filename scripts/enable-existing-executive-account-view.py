from pathlib import Path

path = Path('src/generation3.js')
text = path.read_text(encoding='utf-8')
old = '''function can(permission) {\n  return owner() || hasPermission(g3.staffAccess, permission);\n}\n'''
new = '''function can(permission) {\n  if (permission === PERMISSIONS.ACCOUNTS_READ_ALL\n      && g3.userRecord?.status === "active"\n      && isActiveStaff(g3.staffAccess)\n      && ["owner", "co-owner", "chief-officer"].includes(g3.staffAccess?.rank)) return true;\n  return owner() || hasPermission(g3.staffAccess, permission);\n}\n'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise RuntimeError('Generation 3 can() helper not found')

for needle in ['PERMISSIONS.ACCOUNTS_READ_ALL', '"chief-officer"', 'async function accountsPage()']:
    if needle not in text:
        raise RuntimeError(f'Missing expected executive account feature: {needle}')

path.write_text(text, encoding='utf-8')
print('Existing Owner, Co-Owner, and Chief Officer accounts can open All Accounts.')
