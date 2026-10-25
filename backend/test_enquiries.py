"""Phase 1 API regression checks; only own disposable fixtures are removed."""
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / '.env')
BASE = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:8000') + '/api'
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
tag = 'phase1-' + uuid.uuid4().hex
passed, failed = [], []
admin = requests.Session()
users = []
limit_key = 'enquiry:127.0.0.1'
previous_limit = db.rate_limits.find_one({'_id': limit_key})
notification_reads = [(n['_id'], n.get('read', False)) for n in db.notifications.find({}, {'read':1})]

def check(name, condition):
    (passed if condition else failed).append(name)
    print(('  PASS  ' if condition else '  FAIL  ') + name)

def submit(**changes):
    data = dict(name=tag, company='API test', email=tag+'@example.com', phone='', message='Test enquiry', website='')
    data.update(changes)
    return requests.post(BASE+'/public/enquiry', json=data, timeout=30)

try:
    check('admin login', admin.post(BASE+'/auth/login', json={'email': os.environ['ADMIN_EMAIL'], 'password': os.environ['ADMIN_PASSWORD']}).status_code == 200)
    db.rate_limits.delete_one({'_id': limit_key})
    check('anonymous inbox rejected', requests.get(BASE+'/enquiries').status_code == 401)
    check('anonymous status edit rejected', requests.put(BASE+'/enquiries/000000000000000000000000', json={'status':'handled'}).status_code == 401)
    check('honeypot returns fake success', submit(website='spam.example').status_code == 200)
    check('honeypot not stored', db.enquiries.count_documents({'name': tag}) == 0)
    check('honeypot does not consume quota', db.rate_limits.find_one({'_id':limit_key}) is None)
    for field, value in [('name','a'*101), ('company','a'*151), ('email','a'*255), ('phone','a'*41), ('message','a'*1501), ('website','a'*201)]:
        check(field+' length limit', submit(**{field:value}).status_code == 422)
    for field, value in [('name',' '), ('message',' '), ('email','not-an-email'), ('message','<script>alert(1)</script>')]:
        check(field+' rejects '+repr(value[:20]), submit(**{field:value}).status_code == 422)
    check('valid public submit', submit().status_code == 200)
    doc = db.enquiries.find_one({'name':tag})
    check('stored metadata and new status', doc and doc['status']=='new' and doc['ip']=='127.0.0.1' and 'created_at' in doc and 'user_agent' in doc and 'website' not in doc)
    eid = str(doc['_id'])
    inbox = admin.get(BASE+'/enquiries').json()
    check('admin sees enquiry without IP metadata', any(x['id']==eid and 'ip' not in x and 'user_agent' not in x for x in inbox['items']))
    check('pagination validates offset', admin.get(BASE+'/enquiries?skip=-1').status_code == 422)
    check('new enquiry notification', any(x.get('enquiry_id')==eid for x in admin.get(BASE+'/notifications').json()))
    check('status invalid rejected', admin.put(BASE+'/enquiries/'+eid,json={'status':'deleted'}).status_code == 422)
    check('malformed id returns 404', admin.put(BASE+'/enquiries/bad-id',json={'status':'handled'}).status_code == 404)
    check('unknown id returns 404', admin.put(BASE+'/enquiries/000000000000000000000000',json={'status':'handled'}).status_code == 404)
    check('mark handled', admin.put(BASE+'/enquiries/'+eid,json={'status':'handled'}).status_code == 200)
    check('handled persisted with actor', db.enquiries.find_one({'_id':doc['_id']})['status']=='handled' and db.enquiries.find_one({'_id':doc['_id']}).get('updated_by'))
    check('handled notification read', db.notifications.find_one({'enquiry_id':eid})['read'])
    check('mark new', admin.put(BASE+'/enquiries/'+eid,json={'status':'new'}).status_code == 200)
    check('new notification unread', not db.notifications.find_one({'enquiry_id':eid})['read'])
    for role in ['accounts','data_entry']:
        email=tag+'-'+role+'@example.com'
        created=admin.post(BASE+'/users',json={'email':email,'password':'test-only-password','name':tag,'role':role}).json()
        users.append(created['id'])
        session=requests.Session(); session.post(BASE+'/auth/login',json={'email':email,'password':'test-only-password'})
        check(role+' cannot read inbox',session.get(BASE+'/enquiries').status_code==403)
        check(role+' cannot change enquiry',session.put(BASE+'/enquiries/'+eid,json={'status':'handled'}).status_code==403)
        check(role+' cannot see enquiry notification',not any(x.get('enquiry_id')==eid for x in session.get(BASE+'/notifications').json()))
        nid=str(db.notifications.find_one({'enquiry_id':eid})['_id'])
        check(role+' cannot toggle admin notification',session.put(BASE+'/notifications/'+nid+'/toggle').status_code==404)
        session.put(BASE+'/notifications/read-all')
        check(role+' cannot mark admin notification read',not db.notifications.find_one({'enquiry_id':eid})['read'])
    for i in range(4): check('quota submission '+str(i+2),submit().status_code==200)
    check('sixth submission rejected',submit().status_code==429)
    check('untrusted real-IP header does not bypass quota',requests.post(BASE+'/public/enquiry',headers={'X-Real-IP':'203.0.113.99'},json={'name':tag,'email':tag+'@example.com','message':'test'}).status_code==429)
    db.rate_limits.update_one({'_id':limit_key},{'$set':{'expires_at':datetime.now(timezone.utc)-timedelta(seconds=1)}})
    check('expired quota resets before TTL cleanup',submit().status_code==200)
    db.rate_limits.delete_one({'_id':limit_key})
    with ThreadPoolExecutor(max_workers=10) as pool:
        codes=list(pool.map(lambda _:submit().status_code,range(10)))
    check('concurrent quota allows exactly five',codes.count(200)==5 and codes.count(429)==5)
    check('TTL index exists',any(x.get('expireAfterSeconds')==0 for x in db.rate_limits.list_indexes()))
finally:
    for nid, was_read in notification_reads:
        db.notifications.update_one({'_id':nid},{'$set':{'read':was_read}})
    ids=[str(x['_id']) for x in db.enquiries.find({'name':tag},{'_id':1})]
    db.notifications.delete_many({'enquiry_id':{'$in':ids}})
    db.enquiries.delete_many({'name':tag})
    for uid in users:
        from bson import ObjectId
        db.users.delete_one({'_id':ObjectId(uid),'name':tag})
    db.rate_limits.delete_one({'_id':'enquiry:203.0.113.99'})
    db.rate_limits.delete_one({'_id':limit_key})
    if previous_limit: db.rate_limits.insert_one(previous_limit)
print(f'\n{len(passed)} passed, {len(failed)} failed')
sys.exit(bool(failed))
