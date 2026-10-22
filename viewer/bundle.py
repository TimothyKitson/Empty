import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "g16-7630-standalone.html")

with open(os.path.join(HERE, "index.html"), encoding="utf-8") as f:
    page = f.read()
with open(os.path.join(HERE, "g16-7630.glb"), "rb") as f:
    data = base64.b64encode(f.read()).decode("ascii")

marker = '<script type="importmap">'
blob = '<script type="application/octet-stream" id="g16-glb">' + data + "</script>\n"
page = page.replace(marker, blob + marker, 1)

with open(out, "w", encoding="utf-8") as f:
    f.write(page)
print(out, os.path.getsize(out))
