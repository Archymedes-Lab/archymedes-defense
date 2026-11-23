import json,sys
from pathlib import Path
sys.path.insert(0,'/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev
state={'scope':'Two offline metadata-only research prototypes selected by user: evaluation evidence comparison and dataset provenance record checking',
'alternatives':{'offline':'deterministic bounded local JSON CLIs','hosted':'hosted model execution/database before workflow validation'},
'invariants':['no network or actions','no private prompts, responses or documents','exact suite and version binding','missing/error/stale results cannot be a clean comparison','transitive lineage/purpose/digest checks','declared permission matching is not legal clearance','hash consistency is not authenticity'],
'planned_validation':['real CLI success/refusal','schema and byte limits','receipt replay and version mismatch','critical regressions and incomplete cases','lineage cycles, missing parents, expiry, denial and review status','safe errors and interrupted snapshots']}
questions={'design':{'type':'choice','instructions':'Which alternative best meets the explicit bounded prototype scope and invariants?','criteria':{'offline':'Offline deterministic metadata contracts','hosted':'Hosted execution first','unknown':'Insufficient information'}},'claims':{'type':'noul','instructions':'Do matching hashes and caller-declared permission records alone establish correct model behavior or legal rights to real datasets?','criteria':{'true':'They establish those claims','false':'They establish only consistency of declared metadata'}}}
try:
 r=jev._call(state,questions,timeout=20);result={'model':r.get('model'),'answers':r['answers']}
except jev.JevError:result={'unavailable':True,'fallback':'bounded deterministic offline checking'}
Path(__file__).with_name('selected-design-review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
