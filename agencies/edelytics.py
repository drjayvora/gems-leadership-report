"""Edelytics spend sheet -> spend/edelytics.csv (the standard spend format, see spend/TEMPLATE.csv).

One tab per campus (the tab name is matched to the CRM campus), each with daily blocks side by side:
Google Ads in columns A-F and Meta Ads in columns H-M (Day, Impr., Clicks, Cost, Conversions, Cost / conv.).
Conversions are the agency's own lead count, kept for reference only.
Usage: python3 agencies/edelytics.py [path-to-xlsx]   (default: download the sheet whose ID is in env EDELYTICS_SHEET)
"""
import csv, datetime, io, json, os, sys, urllib.request
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
CFG = json.load(open(os.path.join(ROOT, "config.json")))
CAMPUSES = list(CFG["school_short"])
BLOCKS = [("Google", 0), ("Meta", 7)]   # channel, column of "Day"; then Impr., Clicks, Cost, Conversions


def campus(tab):
    hits = [c for c in CAMPUSES if tab.strip().lower() in c.lower()]
    return hits[0] if len(hits) == 1 else None


def rows(xlsx):
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    for ws in wb:
        school = campus(ws.title)
        if not school:
            print("skipping tab", ws.title, "(no single matching CRM campus)"); continue
        for r in ws.iter_rows(values_only=True):
            for ch, c in BLOCKS:
                if len(r) <= c + 4 or not isinstance(r[c], datetime.datetime) or not isinstance(r[c + 3], (int, float)) or not r[c + 3]:
                    continue
                n = lambda v: v if isinstance(v, (int, float)) else 0
                yield dict(date=r[c].date().isoformat(), agency="Edelytics", school=school, channel=ch, objective="Lead gen",
                           spend=round(r[c + 3], 2), impressions=n(r[c + 1]), reach="", agency_leads=n(r[c + 4]))


if __name__ == "__main__":
    url = f"https://docs.google.com/spreadsheets/d/{os.environ.get('EDELYTICS_SHEET', '')}/export?format=xlsx"
    src = sys.argv[1] if len(sys.argv) > 1 else io.BytesIO(urllib.request.urlopen(url, timeout=60).read())
    out = list(rows(src))
    with open(os.path.join(ROOT, "spend", "edelytics.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "agency", "school", "channel", "objective", "spend", "impressions", "reach", "agency_leads"])
        w.writeheader(); w.writerows(sorted(out, key=lambda x: (x["date"], x["school"], x["channel"])))
    print(len(out), "rows, spend", round(sum(x["spend"] for x in out)))
