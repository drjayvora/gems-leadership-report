"""Pull the GEMS CRM and agency spend files, and write the leadership report data (build/data.json).

Env: FRAPPE_TOKEN ("token key:secret"), or FRAPPE_API_KEY + FRAPPE_API_SECRET.
     CENTRAL_REPS (JSON {"email": "Name"}): the pre-sales (central admissions desk) counsellors.
Everyone else who works leads in the CRM is treated as a school counsellor.
The output holds no parent names, phone numbers or emails: leads are reduced to dates, school, source and stage.
"""
import collections as C, datetime, json, os, statistics, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, "config.json")))
B = CFG["crm"]
T = (f"token {os.environ['FRAPPE_API_KEY']}:{os.environ['FRAPPE_API_SECRET']}" if os.environ.get("FRAPPE_API_KEY") else os.environ["FRAPPE_TOKEN"])
PRESALES = json.loads(os.environ["CENTRAL_REPS"])
NOW = datetime.datetime.now(datetime.UTC).replace(tzinfo=None) + datetime.timedelta(hours=5, minutes=30)   # CRM times are IST


def get(doctype, fields, filters=()):
    out, start = [], 0
    while True:
        q = urllib.parse.urlencode({"fields": json.dumps(fields), "filters": json.dumps(list(filters)),
                                    "limit_start": start, "limit_page_length": 500})
        for attempt in range(6):
            try:
                req = urllib.request.Request(f"{B}/api/resource/{urllib.parse.quote(doctype)}?{q}", headers={"Authorization": T})
                rows = json.load(urllib.request.urlopen(req, timeout=120))["data"]
                break
            except Exception as e:
                if attempt == 5:
                    raise
                print("retry", doctype, e, flush=True); time.sleep(5 * (attempt + 1))
        out += rows
        if len(rows) < 500:
            return out
        start += 500


leads = get("CRM Lead", ["name", "creation", "source", "territory", "status", "is_duplicate", "utm_source", "visit_state",
                         "visit_done_on", "_assign", "lead_owner", "attempt_count", "mobile_no", "phone", "intent"])
deals = get("CRM Deal", ["lead", "status", "deal_owner", "application_submitted_on", "application_fee_paid_on",
                         "blocking_fee_paid_on", "enrolled_on", "modified"])
visits = get("GEMS Visit", ["enquiry", "campus", "creation", "scheduled_on", "status", "attended_on", "conducted_by", "owner"])
calls = get("CRM Call Log", ["caller", "receiver", "status", "duration", "type", "reference_doctype", "reference_docname",
                             "start_time", "creation", "to", "from"])
users = {u["name"]: u["full_name"] for u in get("User", ["name", "full_name"], [["user_type", "=", "System User"]])}
print("leads", len(leads), "deals", len(deals), "visits", len(visits), "calls", len(calls))

START = CFG["season_start"]
leads = [l for l in leads if not l["is_duplicate"] and l["creation"][:10] >= START]
d10 = lambda p: (lambda s: s[-10:] if len(s) >= 10 else None)("".join(c for c in (p or "") if c.isdigit()))
ix = {l["name"]: i for i, l in enumerate(leads)}
by_phone = {}
for l in leads:
    for p in {d10(l["mobile_no"]), d10(l["phone"])} - {None}:
        by_phone.setdefault(p, ix[l["name"]])

day = lambda s: (s or "")[:10] or None
first = lambda *xs: min([x for x in xs if x] or [None]) if any(xs) else None

# People: index table; role and home school are inferred from current lead assignments.
ignore = set(CFG["ignore_users"])
people, pix = [], {}
def person(email):
    if not email or email in ignore:
        return -1
    if email not in pix:
        pix[email] = len(people)
        people.append(dict(name=PRESALES.get(email) or users.get(email) or email.split("@")[0],
                           role="Pre-sales" if email in PRESALES else "School", email=email))
    return pix[email]

schools = sorted({l["territory"] or "Unassigned" for l in leads})
six = {s: i for i, s in enumerate(schools)}
sources = sorted({l["source"] or "Not set" for l in leads})
srcix = {s: i for i, s in enumerate(sources)}

# Stage dates per lead
vsched, vdone = {}, {}
for v in visits:
    i = ix.get(v["enquiry"])
    if i is None:
        continue
    vsched[i] = first(vsched.get(i), day(v["creation"]))
    if v["status"] == "Done":
        vdone[i] = first(vdone.get(i), day(v["attended_on"] or v["scheduled_on"]))
app, adm = {}, {}
for d in deals:
    i = ix.get(d["lead"])
    if i is None:
        continue
    a = day(d["application_fee_paid_on"]) or (day(d["modified"]) if d["status"] in CFG["application_statuses"] else None)
    m = day(d["blocking_fee_paid_on"] or d["enrolled_on"]) or (day(d["modified"]) if d["status"] in CFG["admission_statuses"] else None)
    if a: app[i] = first(app.get(i), a)
    if m: adm[i] = first(adm.get(i), m)

L = []
for i, l in enumerate(leads):
    vs = vsched.get(i) or (day(l["creation"]) if l["visit_state"] in ("Booked", "Attended", "No show") else None)
    vd = vdone.get(i) or (day(l["visit_done_on"]) or day(l["creation"]) if l["visit_state"] == "Attended" else None)
    assignees = [person(e) for e in json.loads(l["_assign"] or "[]")]
    L.append([day(l["creation"]), six[l["territory"] or "Unassigned"], srcix[l["source"] or "Not set"], l["status"],
              vs, vd, app.get(i), adm.get(i), [p for p in assignees if p >= 0],
              1 if (l["status"] == "New" and not (l["attempt_count"] or 0)) else 0, (l["utm_source"] or "").lower(),
              l["creation"][:16], l["intent"] or ""])

# Calls: [date, person, "O"/"I", connected, seconds, lead index or -1, datetime]
K = []
for c in calls:
    who = c["caller"] if c["type"] == "Outgoing" else c["receiver"]
    p = person(who)
    if p < 0:
        continue
    li = ix.get(c["reference_docname"]) if c["reference_doctype"] == "CRM Lead" else None
    if li is None:
        li = by_phone.get(d10(c["to"] if c["type"] == "Outgoing" else c["from"]), -1)
    t = c["start_time"] or c["creation"]
    K.append([t[:10], p, c["type"][0], 1 if c["status"] == "Completed" and (c["duration"] or 0) > 0 else 0,
              int(c["duration"] or 0), li, t[:16]])

# Visits: [created, booked-by, conducted-by, status, done date, school]
V = []
for v in visits:
    if day(v["creation"]) < START:
        continue
    V.append([day(v["creation"]), person(v["owner"]), person(v["conducted_by"]), v["status"],
              day(v["attended_on"]) if v["status"] == "Done" else None, six.get(v["campus"], -1)])

data = dict(
    meta=dict(season=CFG["season"], start=min([l[0] for l in L] or [START]), end=NOW.strftime("%Y-%m-%d"), taken=NOW.strftime("%-d %b %Y, %-I:%M %p IST"),
              definitions=CFG["definitions"]),
    schools=[dict(name=s, short=CFG["school_short"].get(s, s)) for s in schools],
    sources=sources, channels=CFG["channels"],
    agencies={k: dict(utm_sources=v.get("utm_sources", [])) for k, v in CFG["agencies"].items()},
    people=[dict(name=p["name"], role=p["role"]) for p in people],
    leads=L, calls=K, visits=V)
os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
json.dump(data, open(os.path.join(HERE, "build", "data.json"), "w"), separators=(",", ":"))
print("written: leads", len(L), "calls", len(K), "visits", len(V), "people", len(people))
for name, f in [("visits scheduled", 4), ("visits done", 5), ("applications", 6), ("admissions", 7)]:
    print(name, sum(1 for x in L if x[f]))
