#!/usr/bin/env python3
"""Bundle the site into a single self-contained install.html."""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'install.html')
SKIP_DIRS = {'.git'}
SKIP_FILES = {'config.enc', 'install.html'}

files = {}
for dp, dns, fns in os.walk(ROOT):
    dns[:] = [d for d in dns if d not in SKIP_DIRS]
    for fn in fns:
        if fn in SKIP_FILES:
            continue
        p = os.path.join(dp, fn)
        rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
        files[rel] = base64.b64encode(open(p, 'rb').read()).decode()

crypto = open(os.path.join(ROOT, 'js', 'crypto.js'), encoding='utf-8').read()
crypto = re.sub(r'^export\s+', '', crypto, flags=re.M)
tpl = open(os.path.join(ROOT, 'tools', 'installer-template.html'), encoding='utf-8').read()
html = tpl.replace('/*__CRYPTO__*/', crypto).replace('/*__FILES__*/', json.dumps(files))
open(OUT, 'w', encoding='utf-8').write(html)
print(OUT, len(files), 'files', round(len(html) / 1e6, 2), 'MB')
