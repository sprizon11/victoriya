"""Operator groups (teams / lines) and operation groups (Cutting, Stitching, ...).

Both are optional labels on a master record. Production entries copy the group
name at write time, like every other name on an entry, so renaming or deleting a
group later never rewrites what was recorded.
"""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc
from audit import note

router = APIRouter(prefix="/api")


class GroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    sort_order: int = 0
    supervisor_operator_id: Optional[str] = None       # operator groups only


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=300)
    sort_order: Optional[int] = None
    supervisor_operator_id: Optional[str] = None
    active: Optional[bool] = None


class Assign(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)
    group_id: Optional[str] = None                     # None / "" removes the group


async def group_name_for(collection, group_id):
    """Validate a group id and return (id, name); ("", "") means ungrouped."""
    if not group_id:
        return "", ""
    if not ObjectId.is_valid(group_id):
        raise HTTPException(400, "Group not found")
    g = await collection.find_one({"_id": ObjectId(group_id)})
    if not g:
        raise HTTPException(400, "Group not found")
    return group_id, g["name"]


def _make_routes(path: str, group_coll_name: str, member_coll_name: str, entity: str, member_label: str):
    groups = lambda: db[group_coll_name]
    members = lambda: db[member_coll_name]

    @router.get(f"/{path}", name=f"list_{entity}")
    async def list_groups(request: Request):
        await get_current_user(request)
        rows = await groups().find().sort([("sort_order", 1), ("name", 1)]).to_list(500)
        counts = {}
        async for row in members().aggregate([{"$match": {"group_id": {"$nin": ["", None]}}},
                                              {"$group": {"_id": "$group_id", "n": {"$sum": 1}}}]):
            counts[row["_id"]] = row["n"]
        out = []
        for r in rows:
            d = serialize_doc(r)
            d["member_count"] = counts.get(d["id"], 0)
            out.append(d)
        return out

    @router.post(f"/{path}", name=f"create_{entity}")
    async def create_group(data: GroupIn, request: Request):
        user = await get_current_user(request)
        check_role(user, ["admin"])
        name = data.name.strip()
        if await groups().find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
            raise HTTPException(400, f"A group called '{name}' already exists")
        doc = {"name": name, "description": data.description.strip(), "sort_order": data.sort_order,
               "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
        if entity == "operator_group":
            doc["supervisor_operator_id"] = data.supervisor_operator_id or ""
        res = await groups().insert_one(doc)
        note(request, entity_type=entity, entity_id=str(res.inserted_id), label=name, summary=f"Created {entity.replace('_', ' ')} {name}")
        return {"id": str(res.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}, "member_count": 0}

    @router.put(f"/{path}/{{group_id}}", name=f"update_{entity}")
    async def update_group(group_id: str, data: GroupUpdate, request: Request):
        user = await get_current_user(request)
        check_role(user, ["admin"])
        if not ObjectId.is_valid(group_id):
            raise HTTPException(404, "Group not found")
        prior = await groups().find_one({"_id": ObjectId(group_id)})
        if not prior:
            raise HTTPException(404, "Group not found")
        update = {k: v for k, v in data.model_dump().items() if v is not None}
        if "supervisor_operator_id" in update and entity != "operator_group":
            update.pop("supervisor_operator_id")
        if not update:
            raise HTTPException(400, "No fields to update")
        if "name" in update:
            update["name"] = update["name"].strip()
            clash = await groups().find_one({"name": {"$regex": f"^{re.escape(update['name'])}$", "$options": "i"},
                                             "_id": {"$ne": ObjectId(group_id)}})
            if clash:
                raise HTTPException(400, f"A group called '{update['name']}' already exists")
        await groups().update_one({"_id": ObjectId(group_id)}, {"$set": update})
        if "name" in update and update["name"] != prior["name"]:
            # the master records show the current name; production history keeps what it recorded
            await members().update_many({"group_id": group_id}, {"$set": {"group_name": update["name"]}})
        note(request, entity_type=entity, entity_id=group_id, label=update.get("name", prior["name"]),
             summary=f"Updated {entity.replace('_', ' ')} {prior['name']}",
             before={k: prior.get(k) for k in update}, after=update)
        return serialize_doc(await groups().find_one({"_id": ObjectId(group_id)}))

    @router.delete(f"/{path}/{{group_id}}", name=f"delete_{entity}")
    async def delete_group(group_id: str, request: Request):
        user = await get_current_user(request)
        check_role(user, ["admin"])
        if not ObjectId.is_valid(group_id):
            raise HTTPException(404, "Group not found")
        g = await groups().find_one({"_id": ObjectId(group_id)})
        if not g:
            raise HTTPException(404, "Group not found")
        n = await members().count_documents({"group_id": group_id})
        if n:
            raise HTTPException(400, f"{n} {member_label} still belong to '{g['name']}'. Move them first, or mark the group inactive.")
        note(request, entity_type=entity, entity_id=group_id, label=g["name"], summary=f"Deleted {entity.replace('_', ' ')} {g['name']}")
        await groups().delete_one({"_id": ObjectId(group_id)})
        return {"message": "Deleted"}

    @router.post(f"/{member_coll_name}/assign-group", name=f"assign_{entity}")
    async def assign_group(data: Assign, request: Request):
        user = await get_current_user(request)
        check_role(user, ["admin"])
        gid, gname = await group_name_for(groups(), data.group_id)
        oids = [ObjectId(i) for i in data.ids if ObjectId.is_valid(i)]
        res = await members().update_many({"_id": {"$in": oids}}, {"$set": {"group_id": gid, "group_name": gname}})
        note(request, entity_type=member_coll_name[:-1], summary=f"Moved {res.matched_count} {member_label} to "
             f"{gname or 'no group'}", after={"group": gname, "count": res.matched_count})
        return {"updated": res.matched_count, "group_id": gid, "group_name": gname}


_make_routes("operator-groups", "operator_groups", "operators", "operator_group", "operators")
_make_routes("operation-groups", "operation_groups", "operations", "operation_group", "operations")
