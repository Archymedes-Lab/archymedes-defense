import json,sys
from pathlib import Path
sys.path.insert(0,'/home/chris/jarvis/.archymedes/worktrees/open-source-20261117')
from jarvis.response import jev
state={'scope':'Four separate local defensive research experiments; no operational deployment',
'alternatives':{'offline':'stdlib offline CLIs on bounded synthetic inputs','hosted':'hosted database/dashboard before buyer/data access','live':'real sensors and internet scanners before authorized partners'},
'invariants':['no network or actions','strict bounded metadata schemas and safe errors','unknown data does not imply safety','source observations are not authentication or attribution','synthetic-only validation explicitly labeled'],
'planned_cases':['missing and stale heartbeat','licensed source unavailable and domain out of scope','cloud/no-data abstention and grid mismatch','position/time reference missing or inconsistent','bounded malformed input and real CLI exit codes'],
'product_data':'No real customer, facility, camera, credential, imagery or receiver data supplied'}
questions={'design':{'type':'choice','instructions':'Which alternative best meets the bounded research scope and stated invariants?','criteria':{'offline':'Local bounded synthetic offline experiments','hosted':'Hosted platform first','live':'Live data collection first','unknown':'Insufficient information'}},
'claim':{'type':'noul','instructions':'Do successful synthetic replay tests alone establish real-world sensor reliability, breach detection, damage detection or navigation safety?','criteria':{'true':'They establish those operational claims','false':'They establish only the scoped replay behavior'}}}
try:
 r=jev._call(state,questions,timeout=20);result={'model':r.get('model'),'answers':r['answers']}
except jev.JevError:result={'unavailable':True,'fallback':'bounded deterministic offline design'}
Path(__file__).with_name('design-review.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
