"""Minimal stdlib .xlsx reader (shared strings + inline/numeric cells). Data only; no formulas or macros executed."""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def col_index(ref: str) -> int:
    letters = re.match(r'[A-Z]+', ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read(path: str, max_bytes: int = 50_000_000) -> dict[str, list[list]]:
    z = zipfile.ZipFile(path)
    if sum(i.file_size for i in z.infolist()) > max_bytes:
        raise ValueError('workbook too large')
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter(f"{{{NS['m']}}}t")))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels}
    out = {}
    for s in wb.find('m:sheets', NS):
        rid = s.get(f"{{{NS['r']}}}id")
        p = target[rid].lstrip('/')
        p = p if p.startswith('xl/') else 'xl/' + p
        rows = []
        for row in ET.fromstring(z.read(p)).iter(f"{{{NS['m']}}}row"):
            vals = {}
            for c in row.findall('m:c', NS):
                t, v = c.get('t'), c.find('m:v', NS)
                if t == 's' and v is not None:
                    val = shared[int(v.text)]
                elif t == 'inlineStr':
                    val = ''.join(x.text or '' for x in c.iter(f"{{{NS['m']}}}t"))
                elif v is not None:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                else:
                    val = None
                vals[col_index(c.get('r'))] = val
            if vals:
                rows.append([vals.get(i) for i in range(max(vals) + 1)])
        out[s.get('name')] = rows
    return out
