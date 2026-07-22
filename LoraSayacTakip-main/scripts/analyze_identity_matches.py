"""Analyze Excel-to-real-building matches through subscriber/meter identities."""
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

db = sqlite3.connect(Path(__file__).resolve().parents[1] / "data" / "binalar.db")
db.row_factory = sqlite3.Row

excel = db.execute("SELECT kayit_id,ada,blok,abone_no,sayac_no,bina_id FROM excel_abonelikler").fetchall()

by_meter = defaultdict(set)
by_subscriber = defaultdict(set)
for row in db.execute("""
    SELECT s.bina_id,TRIM(s.sayac_id) sayac_id,TRIM(s.abone_no) abone_no
    FROM sayac s JOIN binalar b ON b.id=s.bina_id
    WHERE COALESCE(b.layer,'') != 'MASKI_EXCEL_ABONELIK_YAKLASIK'
"""):
    if row["sayac_id"]:
        by_meter[row["sayac_id"]].add(row["bina_id"])
    if row["abone_no"]:
        by_subscriber[row["abone_no"]].add(row["bina_id"])

status = Counter()
group_votes = defaultdict(Counter)
resolved = {}
conflicts = []
for row in excel:
    meter_ids = by_meter.get(row["sayac_no"].strip(), set()) if row["sayac_no"].strip() else set()
    subscriber_ids = by_subscriber.get(row["abone_no"].strip(), set()) if row["abone_no"].strip() else set()
    intersection = meter_ids & subscriber_ids
    if len(intersection) == 1:
        building = next(iter(intersection)); method = "meter_and_subscriber"
    elif len(meter_ids) == 1 and not subscriber_ids:
        building = next(iter(meter_ids)); method = "unique_meter"
    elif len(subscriber_ids) == 1 and not meter_ids:
        building = next(iter(subscriber_ids)); method = "unique_subscriber"
    elif len(meter_ids) == 1 and len(subscriber_ids) == 1 and meter_ids == subscriber_ids:
        building = next(iter(meter_ids)); method = "meter_and_subscriber"
    else:
        candidates = meter_ids | subscriber_ids
        building = None
        method = "conflict" if candidates else "unmatched"
        if candidates:
            details = db.execute(
                f"SELECT id,COALESCE(value,'') value,COALESCE(oda_id,0) oda_id FROM binalar WHERE id IN ({','.join('?' for _ in candidates)})",
                tuple(candidates),
            ).fetchall()
            values = {d["value"].strip().upper() for d in details}
            if len(values) == 1:
                building = max(details, key=lambda d: (d["oda_id"], -d["id"]))["id"]
                method = "duplicate_geometry_identity"
    status[method] += 1
    if building is not None:
        resolved[row["kayit_id"]] = (building, method)
        group_votes[(row["ada"], row["blok"])][building] += 1
    elif method == "conflict":
        conflicts.append((row["kayit_id"], sorted(meter_ids), sorted(subscriber_ids)))

print("EXCEL_ROWS", len(excel))
print("IDENTITY_STATUS", dict(status))
print("IDENTITY_RESOLVED", len(resolved), "BUILDINGS", len({x[0] for x in resolved.values()}))
print("CONFLICT_SAMPLE", conflicts[:10])
print("\nGROUP VOTES (top candidate / total identity votes):")
unambiguous_groups = 0
covered_rows = 0
for group, votes in sorted(group_votes.items()):
    total = sum(votes.values())
    top_id, top_count = votes.most_common(1)[0]
    confidence = top_count / total
    if confidence == 1 and total >= 1:
        unambiguous_groups += 1
        covered_rows += db.execute("SELECT COUNT(*) FROM excel_abonelikler WHERE ada=? AND blok=?", group).fetchone()[0]
    print(group, "=>", top_id, f"{top_count}/{total}", f"confidence={confidence:.3f}", "candidates", dict(votes))
print("UNAMBIGUOUS_GROUPS", unambiguous_groups, "POTENTIAL_ROWS", covered_rows)
