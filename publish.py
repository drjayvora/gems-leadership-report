"""Encrypt build/data.json into docs/ (the GitHub Pages site) and copy the app shell from web/.

The key is PBKDF2-SHA256(password, salt in docs/key.json, 600k iterations) used as an AES-256-GCM key.
The salt stays the same between publishes, so the encrypted call recordings in docs/rec/ keep working.
Password: env LEADERSHIP_PASSWORD, or the file ~/.gems_leadership_password. Never commit it.
  publish.py              re-encrypt the latest data
  publish.py --new-salt   new salt (old links and remembered devices stop working; recordings must be re-encrypted)
"""
import base64, csv, datetime, glob, gzip, io, json, os, secrets, shutil, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS, ITER = os.path.join(HERE, "docs"), 600_000
pf = os.path.expanduser("~/.gems_leadership_password")
password = os.environ.get("LEADERSHIP_PASSWORD") or (open(pf).read().strip() if os.path.exists(pf) else None)
if not password:
    sys.exit("Set LEADERSHIP_PASSWORD or create ~/.gems_leadership_password")

kp = os.path.join(DOCS, "key.json")
k = json.load(open(kp)) if os.path.exists(kp) and "--new-salt" not in sys.argv else {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER,
                                                                                   "salt": base64.b64encode(secrets.token_bytes(16)).decode()}
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(k["salt"]), iterations=k["iter"]).derive(password.encode())
enc = lambda b: (lambda iv: iv + AESGCM(key).encrypt(iv, b, None))(secrets.token_bytes(12))

os.makedirs(os.path.join(DOCS, "rec"), exist_ok=True)
data = json.load(open(os.path.join(HERE, "build", "data.json")))
# Sample calls (showcase.json) and the AI feedback on junk/lost leads (feedback.json) are written locally (git-ignored)
# and stored encrypted in docs/rec/, so scheduled builds keep them.
for name in ("showcase", "feedback"):
    sp, se = os.path.join(HERE, name + ".json"), os.path.join(DOCS, "rec", name + ".enc")
    if os.path.exists(sp):
        open(se, "wb").write(enc(open(sp, "rb").read()))
    if os.path.exists(se):
        b = open(se, "rb").read()
        data[name] = json.loads(AESGCM(key).decrypt(b[:12], b[12:], None))
# Agency spend is commercial data, so the CSVs stay out of git: each spend/<agency>.csv is stored encrypted as
# docs/spend/<agency>.enc, and a build without the CSV (e.g. the scheduled refresh) falls back to that copy.
# A row with date_to covers a whole period; it is spread evenly over its days.
os.makedirs(os.path.join(DOCS, "spend"), exist_ok=True)
texts = {}
for f in sorted(glob.glob(os.path.join(DOCS, "spend", "*.enc"))):
    b = open(f, "rb").read(); texts[os.path.basename(f)[:-4]] = AESGCM(key).decrypt(b[:12], b[12:], None).decode()
for f in sorted(glob.glob(os.path.join(HERE, "spend", "*.csv"))):
    name = os.path.basename(f)[:-4]
    if name == "TEMPLATE":
        continue
    texts[name] = open(f).read()
    open(os.path.join(DOCS, "spend", name + ".enc"), "wb").write(enc(texts[name].encode()))
spend = []
for name, text in texts.items():
    for r in csv.DictReader(io.StringIO(text)):
        d0 = datetime.date.fromisoformat(r["date"]); d1 = datetime.date.fromisoformat(r.get("date_to") or r["date"])
        n = (d1 - d0).days + 1
        for i in range(n):
            spend.append(dict(date=(d0 + datetime.timedelta(days=i)).isoformat(), agency=r["agency"], school=r["school"], channel=r["channel"],
                              objective=r["objective"], spread=n > 1, **{k: float(r.get(k) or 0) / n for k in ("spend", "impressions", "reach", "agency_leads")}))
data["spend"] = spend
# The season view starts at the earlier of the first lead and the first spend, so all spend counts.
if spend:
    data["meta"]["start"] = min(data["meta"]["start"], min(x["date"] for x in spend))
names = {s["name"] for s in data["schools"]}
for sch in sorted({x["school"] for x in spend} - names):
    data["schools"].append(dict(name=sch, short=sch))
raw = json.dumps(data, separators=(",", ":")).encode()
open(os.path.join(DOCS, "data.enc"), "wb").write(enc(gzip.compress(raw, mtime=0)))
json.dump(k, open(kp, "w"))
for f in os.listdir(os.path.join(HERE, "web")):
    shutil.copy(os.path.join(HERE, "web", f), os.path.join(DOCS, f))
open(os.path.join(DOCS, ".nojekyll"), "w").write("")
open(os.path.join(DOCS, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
print("docs/ updated:", round(os.path.getsize(os.path.join(DOCS, "data.enc")) / 1e3), "KB encrypted data")
