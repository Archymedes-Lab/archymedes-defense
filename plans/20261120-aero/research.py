"""Paper search without OpenAlex (rate-limited 2026-11-20): Crossref for journal papers, NASA NTRS for public reports and data."""
import json, urllib.request, urllib.parse, time
UA = {"User-Agent": "research-client/1.0"}
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40))
CR = {
 "vlm": "vortex lattice method validation", "polhamus": "leading edge suction analogy vortex lift",
 "vfe2": "second international vortex flow experiment VFE-2 delta wing", "breakdown": "vortex breakdown delta wing",
 "highaoa": "high angle of attack aerodynamics fighter", "nvlm": "nonlinear vortex lattice method high angle of attack",
 "lowfi": "low fidelity aerodynamic prediction conceptual design comparison", "uav": "UAV aerodynamics vortex lattice wind tunnel",
 "saccon": "SACCON UCAV aerodynamics", "surrogate": "multi-fidelity aerodynamic surrogate model",
}
NT = {
 "polhamus": "leading-edge-suction analogy vortex lift", "highaoa": "high angle of attack technology program aerodynamics",
 "f16": "F-16 wind tunnel aerodynamic data high angle of attack", "delta": "delta wing low speed wind tunnel force data",
 "vlm": "vortex lattice method", "datcom": "USAF stability and control DATCOM", "hart": "HARV F/A-18 high alpha research vehicle aerodynamics",
 "lex": "leading-edge extension vortex", "vfe2": "vortex flow experiment 65 degree delta wing", "crm": "common research model wind tunnel",
}
out = {"crossref": {}, "ntrs": {}}
for k, q in CR.items():
    d = get("https://api.crossref.org/works?" + urllib.parse.urlencode({"query.bibliographic": q, "rows": 8, "sort": "is-referenced-by-count", "order": "desc", "select": "DOI,title,issued,is-referenced-by-count,container-title"}))
    rows = [{"title": (w.get("title") or [""])[0], "year": (w.get("issued", {}).get("date-parts") or [[None]])[0][0], "cites": w.get("is-referenced-by-count"), "doi": w["DOI"], "venue": (w.get("container-title") or [""])[0]} for w in d["message"]["items"]]
    out["crossref"][k] = rows; print(f"\n## CR {k}")
    for r in rows: print(f"  {r['year']} {r['cites']:>5}  {r['title'][:90]} | {r['venue'][:40]} | {r['doi']}")
    time.sleep(1)
for k, q in NT.items():
    d = get("https://ntrs.nasa.gov/api/citations/search?" + urllib.parse.urlencode({"q": q, "page.size": 8}))
    rows = []
    for r in d["results"]:
        dl = (r.get("downloads") or [{}])[0].get("links", {})
        rows.append({"id": r["id"], "title": r["title"], "year": ((r.get("publications") or [{}])[0].get("publicationDate") or "")[:4], "dist": r.get("distribution"), "pdf": dl.get("pdf"), "txt": dl.get("fulltext"), "nums": r.get("otherReportNumbers")})
    out["ntrs"][k] = rows; print(f"\n## NTRS {k}")
    for r in rows: print(f"  {r['year']} {r['id']} {r['title'][:95]} | {r['dist']} | {'txt' if r['txt'] else '-'} {r['nums'] or ''}")
json.dump(out, open("papers.json", "w"), indent=1)
