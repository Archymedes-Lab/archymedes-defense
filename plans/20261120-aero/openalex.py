import json, urllib.request, urllib.parse, sys
Q = {
 "vlm": "vortex lattice method validation wing aerodynamics",
 "polhamus": "leading edge suction analogy vortex lift delta wing",
 "vfe2": "international vortex flow experiment 65 degree delta wing",
 "breakdown": "vortex breakdown delta wing high angle of attack",
 "highaoa": "high angle of attack aerodynamics fighter aircraft wind tunnel",
 "lex": "leading edge extension vortex aerodynamics",
 "nvlm": "nonlinear vortex lattice method separated flow high angle of attack",
 "datcom": "Digital DATCOM validation aerodynamic prediction",
 "lowfi": "low fidelity aerodynamic tools conceptual design comparison CFD",
 "uav": "small UAV aerodynamics vortex lattice wind tunnel comparison",
 "surrogate": "aerodynamic coefficient surrogate model uncertainty conceptual design",
 "sacc": "SACCON UCAV wind tunnel CFD stability",
 "tailless": "tailless flying wing stability and control aerodynamics",
 "rans_delta": "RANS CFD delta wing vortex prediction assessment",
}
out = {}
for k, q in Q.items():
    u = "https://api.openalex.org/works?" + urllib.parse.urlencode({"search": q, "per-page": 8, "sort": "cited_by_count:desc",
        "select": "id,doi,title,publication_year,cited_by_count,open_access,primary_location"})
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "research-client/1.0"}), timeout=30))
    except Exception as e:
        print(k, "ERR", e); continue
    rows = []
    for w in d["results"]:
        src = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
        rows.append({"title": w["title"], "year": w["publication_year"], "cites": w["cited_by_count"], "doi": w["doi"], "oa": (w.get("open_access") or {}).get("oa_url"), "venue": src})
    out[k] = {"query": q, "results": rows}
    print(f"\n## {k}")
    for r in rows: print(f"  {r['year']} {r['cites']:>5}  {(r['title'] or '')[:95]} | {r['venue']} | {'OA' if r['oa'] else '-'}")
json.dump(out, open("papers.json", "w"), indent=1)
