"""
Read-only look at what is inside a MongoDB cluster: databases, collections,
document counts and a sample document from each collection.

Useful for identifying an unfamiliar database before you decide whether it
holds real data worth keeping.

This script only reads. It never writes, drops or modifies anything.

    backend\\.venv\\Scripts\\python.exe backend\\inspect_db.py
"""

import sys
from getpass import getpass

try:
    from pymongo import MongoClient
except ImportError:
    print("pymongo is not installed in this interpreter.")
    sys.exit(1)

SKIP = {"admin", "local", "config"}   # server internals, not user data

print()
print("Paste your MongoDB connection string and press Enter.")
print("Nothing will appear as you paste (it contains your password).")
print()
url = getpass("> ").strip().strip('"').strip("'")

if not url.startswith(("mongodb://", "mongodb+srv://")):
    print("\nThat does not look like a connection string.")
    sys.exit(1)

client = MongoClient(url, serverSelectionTimeoutMS=10000)
client.admin.command("ping")

print(f"\nConnected to {url.split('@')[1].split('/')[0]}")
print("=" * 66)

for dbname in sorted(client.list_database_names()):
    marker = "   (server internal)" if dbname in SKIP else ""
    db = client[dbname]

    try:
        stats = db.command("dbstats")
        size_mb = stats.get("dataSize", 0) / (1024 * 1024)
    except Exception:
        size_mb = 0

    print(f"\nDATABASE: {dbname}   [{size_mb:.2f} MB]{marker}")

    if dbname in SKIP:
        continue

    try:
        collections = sorted(db.list_collection_names())
    except Exception as e:
        print(f"  could not list collections: {e}")
        continue

    if not collections:
        print("  (empty)")
        continue

    for c in collections:
        count = db[c].count_documents({})
        print(f"  {c:28s} {count:8d} documents")

        if count:
            doc = db[c].find_one()
            keys = [k for k in doc.keys() if k != "_id"][:8]
            print(f"     fields: {', '.join(keys)}")

print("\n" + "=" * 66)
print("Nothing was modified - this script only reads.")
client.close()
