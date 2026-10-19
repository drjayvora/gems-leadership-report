# GEMS admissions leadership report

One password-protected page for leadership. The School view picks one campus and shows spend, leads, CPL, lead quality, the funnel, weekly trend and counsellors for it. The other views, all filterable by dates, school and lead source:

- **Funnel**: leads, visits scheduled, walk-ins (visits done), applications (application fee paid) and admissions (admission fee paid), by school and by lead source.
- **Productivity**: pre-sales (central admissions desk) and school counsellors: leads assigned, untouched leads, dials, connects, talk time, visits, applications, admissions, time to first call.
- **Spend & ROI by school**: spend (all agencies) against CRM leads, CPL, lead quality (reached, untouched, hot/warm, junk, lost) and the funnel, with cost per walk-in, application and admission. Spend comes from the agencies; every count after that comes from the CRM.
- **Calls**: a few recorded calls to listen to.

Definitions live in `config.json` and are shown on the site's Definitions page.

## How it runs

```
agencies/*.py  ->  spend/<agency>.csv  ┐
GEMS CRM (REST API)  ──────────────────┴─>  build.py  ->  build/data.json  ->  publish.py  ->  docs/ (encrypted, GitHub Pages)
```

- `build.py` pulls leads, deals, visits and call logs and reduces them to dates, school, source, stage and counsellor. No parent names or contact details leave the CRM.
- `publish.py` encrypts the data with AES-256-GCM under a key derived from the password (PBKDF2-SHA256, 600k iterations; salt in `docs/key.json`). The browser derives the same key, so the repo and site can be public while the content is not.
- `.github/workflows/refresh.yml` rebuilds hourly once the secrets `FRAPPE_TOKEN`, `CENTRAL_REPS`, `LEADERSHIP_PASSWORD`, `ECHOVME_SHEET` and `EDELYTICS_SHEET` are set.

Run locally: `FRAPPE_TOKEN=... CENTRAL_REPS='{"email":"Name"}' python3 build.py && LEADERSHIP_PASSWORD=... python3 publish.py`, then `python3 -m http.server --directory docs`.

## Adding an agency

Each agency's spend becomes rows in the standard format (`spend/TEMPLATE.csv`):
`date, date_to, agency, school, channel, objective, spend, impressions, reach, agency_leads`

- `school` is the exact CRM territory, `channel` is `Meta` or `Google` (mapped to CRM lead sources in `config.json`), `objective` is `Branding` or `Lead gen`.
- Spend CSVs are git-ignored (commercial data). `publish.py` stores each one encrypted in `docs/spend/`, so scheduled builds keep using them. Sheet IDs live in repository secrets, never in the repo.
- If the agency sends a CSV in that format, drop it in `spend/<agency>.csv` and publish from a machine that has it, or add an adapter that downloads it. If it sends its own sheet layout, add an adapter like `agencies/echovme.py` that converts it.
- A row may cover a whole period: fill `date_to` and the total is spread evenly over those days.
- `agency_leads` is kept for reference only. The report always counts leads from the CRM.
- When two agencies pay for the same school and channel on the same days, CRM results are split by share of spend. If an agency tags its leads with a UTM source, list it under `utm_sources` in `config.json` and its leads are matched exactly instead.

## Sample call recordings

`docs/rec/*.enc` are recordings from the call audit, encrypted with the same key. `docs/rec/showcase.enc` holds their descriptions. To change them, write `showcase.json` (git-ignored) and run `publish.py`.
