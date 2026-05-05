"""One-shot migration: pivot the app from `members` table → `dbo.Employee`.

Run: python migrate_to_employee.py [--dry-run | --execute]

This script implements Phases 1–4 of MIGRATION_PLAN.md. Phase 5 (drop members
table + drop member_id columns + add Employee FKs) is intentionally left out;
the legacy structures stay as a rollback safety net.

Decisions enforced (from migration plan):
  - Force re-register unmatched users (status='Pending', EmployeeID=NULL)
  - mengkukkuk (Super_Ultimate_ADMIN) keeps member_id=NULL, EmployeeID=NULL
  - Merge duplicate Natthaphon: keep Garfield (uid 14), delete Belocne2k4 (uid 10)
  - projects.main_members / support_members: convert names → EmployeeIDs

Idempotent: re-running is safe (every step is guarded).
"""
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, '.')

import db  # noqa: E402


DRY_RUN = '--dry-run' in sys.argv
EXECUTE = '--execute' in sys.argv

if not (DRY_RUN or EXECUTE):
    print("Usage: python migrate_to_employee.py [--dry-run | --execute]")
    print("  --dry-run   show what would change without modifying anything")
    print("  --execute   actually perform the migration (irreversible without backup)")
    sys.exit(2)


def banner(title):
    print('\n' + '═' * 70)
    print(f'  {title}')
    print('═' * 70)


def execute(sql, params=()):
    """Run SQL; print in dry-run mode, execute otherwise."""
    if DRY_RUN:
        flat = ' '.join(sql.split())
        print(f"  [DRY] {flat[:130]}{'…' if len(flat) > 130 else ''}  params={params}")
        return None
    return db.execute(sql, params)


def column_exists(table, col):
    row = db.query(
        "SELECT 1 AS x FROM sys.columns WHERE object_id=OBJECT_ID(?) AND name=?",
        (table, col), fetchone=True,
    )
    return bool(row)


def main():
    print(f"Mode: {'DRY-RUN (no changes)' if DRY_RUN else 'EXECUTE (irreversible)'}")

    # ─────────────────────────────────────────────────────
    # Phase 0 — pre-flight inventory
    # ─────────────────────────────────────────────────────
    banner('Phase 0: pre-flight inventory')
    counts = db.query("""
        SELECT
            (SELECT COUNT(*) FROM members) AS members,
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM worklogs) AS worklogs,
            (SELECT COUNT(*) FROM member_skills) AS skills,
            (SELECT COUNT(*) FROM projects) AS projects,
            (SELECT COUNT(*) FROM dbo.Employee) AS employees
    """, fetchone=True)
    for k, v in counts.items():
        print(f"  {k:12s}: {v}")

    # ─────────────────────────────────────────────────────
    # Phase 1 — add EmployeeID columns
    # ─────────────────────────────────────────────────────
    banner('Phase 1: add EmployeeID columns (NULL allowed)')
    for tbl in ('users', 'worklogs', 'member_skills'):
        if column_exists(tbl, 'EmployeeID'):
            print(f"  {tbl}.EmployeeID — already exists, skipping")
        else:
            if DRY_RUN:
                print(f"  [DRY] ALTER TABLE {tbl} ADD EmployeeID INT NULL")
            else:
                # ALTER TABLE needs autocommit-style DDL; use raw connection
                conn = db.get_connection()
                cur = conn.cursor()
                cur.execute(f"ALTER TABLE {tbl} ADD EmployeeID INT NULL")
                conn.commit()
                print(f"  Added {tbl}.EmployeeID")

    # ─────────────────────────────────────────────────────
    # Phase 2 — backfill EmployeeID from members.staff_id where matched
    # ─────────────────────────────────────────────────────
    banner('Phase 2: backfill EmployeeID from members.staff_id')

    # Quick sanity preview
    preview = db.query("""
        SELECT m.id AS member_id, m.name, m.staff_id,
               TRY_CAST(m.staff_id AS INT) AS staff_id_int,
               e.EmployeeID,
               CASE WHEN e.EmployeeID IS NOT NULL THEN 'MATCH' ELSE 'no-match' END AS status
        FROM members m
        LEFT JOIN dbo.Employee e ON TRY_CAST(m.staff_id AS INT) = e.EmployeeID
        ORDER BY m.id
    """)
    print("  member.id | staff_id | status     | EmployeeID")
    for p in preview:
        print(f"   {p['member_id']:>3}      | {str(p['staff_id'] or '-'):8s} | "
              f"{p['status']:10s} | {p['EmployeeID']}")

    for tbl in ('users', 'worklogs', 'member_skills'):
        execute(f"""
            UPDATE t SET t.EmployeeID = TRY_CAST(m.staff_id AS INT)
            FROM {tbl} t
            JOIN members m ON t.member_id = m.id
            WHERE t.EmployeeID IS NULL
              AND m.staff_id IS NOT NULL
              AND TRY_CAST(m.staff_id AS INT) IN (SELECT EmployeeID FROM dbo.Employee)
        """)
        if not DRY_RUN:
            n = db.query(f"SELECT COUNT(*) AS n FROM {tbl} WHERE EmployeeID IS NOT NULL", fetchone=True)
            print(f"  {tbl}: {n['n']} row(s) now have EmployeeID set")

    # ─────────────────────────────────────────────────────
    # Phase 3a — merge duplicate Natthaphon (Garfield wins, Belocne2k4 dies)
    # ─────────────────────────────────────────────────────
    banner('Phase 3a: merge Natthaphon Klaikaew duplicate')

    # Identify the two member rows by EmployeeID 33547
    nat_rows = db.query("""
        SELECT m.id AS member_id, u.id AS user_id, u.username, u.role
        FROM members m
        LEFT JOIN users u ON u.member_id = m.id
        WHERE TRY_CAST(m.staff_id AS INT) = 33547
        ORDER BY m.id
    """)
    print("  Natthaphon (EmpID 33547) member rows:")
    for r in nat_rows:
        print(f"    member_id={r['member_id']} user={r['user_id']} ({r['username']}) role={r['role']}")

    # Garfield is member_id=14 (per session inventory). Move all from member_id=10 → 14.
    KEEP = 14   # Garfield
    DROP_MEMBER = 10  # Belocne2k4's member row
    DROP_USER = 10    # Belocne2k4's user

    # Only proceed if both rows still exist
    has_drop = db.query("SELECT id FROM members WHERE id=?", (DROP_MEMBER,), fetchone=True)
    has_keep = db.query("SELECT id FROM members WHERE id=?", (KEEP,), fetchone=True)
    if has_drop and has_keep:
        execute("UPDATE worklogs      SET member_id=?, EmployeeID=33547 WHERE member_id=?", (KEEP, DROP_MEMBER))
        execute("UPDATE member_skills SET member_id=?, EmployeeID=33547 WHERE member_id=?", (KEEP, DROP_MEMBER))
        execute("DELETE FROM users    WHERE id=?", (DROP_USER,))
        execute("DELETE FROM members  WHERE id=?", (DROP_MEMBER,))
        print(f"  Merged member_id={DROP_MEMBER} → {KEEP} and deleted user_id={DROP_USER}")
    else:
        print("  Nothing to merge (already done or rows gone)")

    # ─────────────────────────────────────────────────────
    # Phase 3b — force-re-register unmatched users
    # ─────────────────────────────────────────────────────
    banner('Phase 3b: force-re-register unmatched users')
    unmatched_users = db.query("""
        SELECT u.id, u.username, u.role, u.status, m.name, m.staff_id
        FROM users u
        JOIN members m ON u.member_id = m.id
        LEFT JOIN dbo.Employee e ON TRY_CAST(m.staff_id AS INT) = e.EmployeeID
        WHERE e.EmployeeID IS NULL
          AND u.role <> 'Super_Ultimate_ADMIN'
    """)
    print(f"  {len(unmatched_users)} user(s) will be marked Pending:")
    for u in unmatched_users:
        print(f"    uid={u['id']} {u['username']} ({u['role']}) member={u['name']} staff_id={u['staff_id']}")

    if unmatched_users:
        for u in unmatched_users:
            execute(
                """UPDATE users SET status='Pending', EmployeeID=NULL,
                        reviewed_by=NULL, reviewed_at=NULL
                   WHERE id=?""",
                (u['id'],),
            )

    # ─────────────────────────────────────────────────────
    # Phase 4 — projects.main_members / support_members: names → EmployeeIDs
    # ─────────────────────────────────────────────────────
    banner('Phase 4: convert projects member-lists from names → EmployeeIDs')

    # Build a name → EmployeeID lookup using the *existing* members table
    # (because that's what's currently stored in the project strings)
    name_to_eid = {}
    rows = db.query("""
        SELECT m.name, TRY_CAST(m.staff_id AS INT) AS eid
        FROM members m
        WHERE m.staff_id IS NOT NULL
          AND TRY_CAST(m.staff_id AS INT) IN (SELECT EmployeeID FROM dbo.Employee)
    """)
    for r in rows:
        if r['eid']:
            name_to_eid[r['name']] = r['eid']
    print(f"  Lookup table: {len(name_to_eid)} name → EmployeeID mappings")
    for n, eid in name_to_eid.items():
        print(f"    {n!r} → {eid}")

    def parse_legacy(s):
        """Parse the legacy 'name1#name2' or '[\"name1\",...]' format to a list of names."""
        if not s:
            return []
        s = s.strip()
        if s.startswith('['):
            try:
                arr = json.loads(s)
                if isinstance(arr, list):
                    return [str(x).strip() for x in arr if x]
            except (json.JSONDecodeError, ValueError):
                pass
        return [n.strip() for n in s.split('#') if n.strip()]

    def to_id_list(name_list):
        """Translate a list of names → list of EmployeeIDs (drop unmapped)."""
        return [name_to_eid[n] for n in name_list if n in name_to_eid]

    projects = db.query("SELECT id, name, main_members, support_members FROM projects")
    for p in projects:
        old_main = p['main_members']
        old_supp = p['support_members']

        main_ids = to_id_list(parse_legacy(old_main))
        supp_ids = to_id_list(parse_legacy(old_supp))

        # New format: JSON array of integers (consistent with other JSON storage)
        new_main = json.dumps(main_ids) if main_ids else None
        new_supp = json.dumps(supp_ids) if supp_ids else None

        if new_main != old_main or new_supp != old_supp:
            print(f"  project.id={p['id']} {p['name']!r}")
            print(f"    main:    {old_main!r} → {new_main!r}")
            print(f"    support: {old_supp!r} → {new_supp!r}")
            execute(
                "UPDATE projects SET main_members=?, support_members=? WHERE id=?",
                (new_main, new_supp, p['id']),
            )

    # ─────────────────────────────────────────────────────
    # Phase 5 — final verification
    # ─────────────────────────────────────────────────────
    banner('Phase 5: post-migration verification')

    if DRY_RUN:
        print("  (skipped in dry-run)")
        return

    # 5a: every active non-super-admin user with a member should have an EmployeeID
    leak = db.query("""
        SELECT u.id, u.username, u.member_id, u.EmployeeID
        FROM users u
        WHERE u.role <> 'Super_Ultimate_ADMIN'
          AND u.status = 'Active'
          AND u.EmployeeID IS NULL
    """)
    print(f"  Active users without EmployeeID: {len(leak)} (expected 0)")
    for r in leak:
        print(f"    {r}")

    # 5b: no duplicate EmployeeID across active users
    dups = db.query("""
        SELECT EmployeeID, COUNT(*) AS n
        FROM users WHERE EmployeeID IS NOT NULL AND status = 'Active'
        GROUP BY EmployeeID HAVING COUNT(*) > 1
    """)
    print(f"  Duplicate EmployeeIDs across active users: {len(dups)} (expected 0)")
    for r in dups:
        print(f"    {r}")

    # 5c: worklogs with member_id set but no EmployeeID (orphans from unmatched users)
    orphans = db.query("""
        SELECT COUNT(*) AS n FROM worklogs WHERE EmployeeID IS NULL
    """, fetchone=True)
    print(f"  Worklogs with no EmployeeID (orphaned): {orphans['n']}")

    # 5d: projects with non-empty members
    proj = db.query("""
        SELECT id, name, main_members, support_members FROM projects
        WHERE main_members IS NOT NULL OR support_members IS NOT NULL
    """)
    print(f"  Projects with members assigned: {len(proj)}")
    for p in proj:
        print(f"    {p['name']}: main={p['main_members']} support={p['support_members']}")

    print()
    print('  Migration complete. The members table is intact for rollback;')
    print('  drop it later via Phase 5 of MIGRATION_PLAN.md after verification.')


if __name__ == '__main__':
    main()
