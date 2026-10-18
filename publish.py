"""Encrypt build/data.json into docs/ (the GitHub Pages site) and copy the app shell from web/.

The key is PBKDF2-SHA256(password, salt in docs/key.json, 600k iterations) used as an AES-256-GCM key.
The salt stays the same between publishes, so the encrypted call recordings in docs/rec/ keep working.
Password: env LEADERSHIP_PASSWORD, or the file ~/.gems_leadership_password. Never commit it.
  publish.py              re-encrypt the latest data
  publish.py --new-salt   new salt (old links and remembered devices stop working; recordings must be re-encrypted)
"""
import base64, gzip, json, os, secrets, shutil, sys
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
# Sample calls: showcase.json (local, git-ignored) is stored encrypted as docs/rec/showcase.enc so scheduled builds keep it.
sp, se = os.path.join(HERE, "showcase.json"), os.path.join(DOCS, "rec", "showcase.enc")
if os.path.exists(sp):
    open(se, "wb").write(enc(open(sp, "rb").read()))
if os.path.exists(se):
    b = open(se, "rb").read()
    data["showcase"] = json.loads(AESGCM(key).decrypt(b[:12], b[12:], None))
raw = json.dumps(data, separators=(",", ":")).encode()
open(os.path.join(DOCS, "data.enc"), "wb").write(enc(gzip.compress(raw, mtime=0)))
json.dump(k, open(kp, "w"))
for f in os.listdir(os.path.join(HERE, "web")):
    shutil.copy(os.path.join(HERE, "web", f), os.path.join(DOCS, f))
open(os.path.join(DOCS, ".nojekyll"), "w").write("")
open(os.path.join(DOCS, "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
print("docs/ updated:", round(os.path.getsize(os.path.join(DOCS, "data.enc")) / 1e3), "KB encrypted data")
