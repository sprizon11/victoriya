"""
Check that a MongoDB connection string actually works, before wasting a
Render build on it.

Prompts for the string rather than taking it as an argument, so the password
never lands in your shell history.

    backend\\.venv\\Scripts\\python.exe backend\\test_connection.py
"""

import sys
import re
from getpass import getpass

try:
    from pymongo import MongoClient
    from pymongo.errors import ServerSelectionTimeoutError, OperationFailure, ConfigurationError
except ImportError:
    print("pymongo is not installed in this interpreter.")
    print("Run:  backend\\.venv\\Scripts\\python.exe -m pip install pymongo")
    sys.exit(1)


def mask(url: str) -> str:
    """Hide the password so it is safe to copy this output into a chat."""
    return re.sub(r"://([^:]+):([^@]+)@", r"://\1:*****@", url)


print()
print("Paste your MongoDB connection string and press Enter.")
print("Nothing will appear as you paste - the string contains your password,")
print("so it is read without echoing to the screen.")
print()
# getpass, not input(): input() echoes the pasted text, which puts the
# password into the terminal scrollback for anyone looking over your shoulder
# or taking a screenshot.
url = getpass("> ").strip().strip('"').strip("'")

if not url:
    print("\nNothing entered.")
    sys.exit(1)

# --- catch the usual mistakes before even dialling out -------------------

if "<db_password>" in url or "<password>" in url:
    print("\nFAILED: the placeholder is still in the string.")
    print("Replace <db_password> - including the angle brackets - with the real")
    print("password for your database user.")
    sys.exit(1)

if not url.startswith(("mongodb://", "mongodb+srv://")):
    print("\nFAILED: that does not look like a connection string.")
    print("It should begin with mongodb+srv://")
    sys.exit(1)

if "@" not in url:
    print("\nFAILED: no username/password found in the string.")
    print("Expected: mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/...")
    sys.exit(1)

# A password containing @ : / ? # breaks the URL unless percent-encoded.
creds = url.split("://", 1)[1].split("@")[0]
if creds.count(":") > 1:
    print("\nWARNING: your password may contain a ':' character.")
    print("Special characters must be percent-encoded:")
    print("   @ -> %40    : -> %3A    / -> %2F    ? -> %3F    # -> %23")
    print("Continuing anyway...\n")

host = url.split("@", 1)[1].split("/")[0]
print(f"\nConnecting to {host} ...")

# --- the actual attempt --------------------------------------------------

try:
    client = MongoClient(url, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")

    print("\nSUCCESS - the connection string works.")

    try:
        info = client.server_info()
        print(f"  MongoDB version : {info.get('version', 'unknown')}")
    except OperationFailure:
        pass

    # A correctly scoped user (readWrite on one database) is NOT allowed to
    # list every database on the cluster. That refusal is a good sign, not a
    # failure, so it is reported as such.
    try:
        names = client.list_database_names()
        print(f"  Databases visible: {', '.join(names) if names else '(none yet)'}")
        scoped = False
    except OperationFailure:
        print("  Databases visible: (not permitted - user is scoped, which is correct)")
        names, scoped = [], True

    db = client["victoria_unit_flow"]
    try:
        collections = sorted(db.list_collection_names())
        if collections:
            print("\n  victoria_unit_flow already contains:")
            for c in collections:
                print(f"    {c:24s} {db[c].count_documents({}):6d} documents")
        else:
            print("\n  'victoria_unit_flow' is empty - expected before first boot.")
    except OperationFailure as e:
        print(f"\n  Could not read victoria_unit_flow: {e.details.get('errmsg', e) if e.details else e}")
        print("  If you just scoped the user, check the database name is exactly")
        print("  'victoria_unit_flow' in the privilege you granted.")
        sys.exit(1)

    print("\nPaste this same string into Render as MONGO_URL.")
    client.close()

except OperationFailure as e:
    print("\nFAILED: the server rejected your credentials.")
    print(f"  {e.details.get('errmsg', e) if e.details else e}")
    print("\nMost likely the password is wrong. Reset it in Atlas:")
    print("  Database Users -> EDIT -> Edit Password -> Autogenerate -> Update User")
    sys.exit(1)

except ServerSelectionTimeoutError:
    print("\nFAILED: could not reach the cluster (timed out).")
    print("\nUsually one of:")
    print("  1. Your IP is not allowed. In Atlas: Network Access -> IP Access List")
    print("     -> ADD IP ADDRESS -> ALLOW ACCESS FROM ANYWHERE (0.0.0.0/0)")
    print("  2. The cluster is still provisioning - wait a minute and retry.")
    print("  3. The hostname is mistyped.")
    sys.exit(1)

except ConfigurationError as e:
    print(f"\nFAILED: the string is malformed.\n  {e}")
    print(f"\nWhat was parsed: {mask(url)}")
    sys.exit(1)

except Exception as e:
    print(f"\nFAILED: {type(e).__name__}: {e}")
    print(f"\nWhat was parsed: {mask(url)}")
    sys.exit(1)
