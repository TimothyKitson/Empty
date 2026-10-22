import base64
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(HERE, "g16-7630.raw.glb")
GLB = os.path.join(HERE, "g16-7630.glb")
GLTFPACK = os.environ.get("GLTFPACK", "gltfpack")

if os.path.exists(RAW):
    subprocess.run([GLTFPACK, "-i", RAW, "-o", GLB, "-kn", "-km", "-ke", "-vp", "14", "-vn", "10", "-c"], check=True)

with open(os.path.join(HERE, "index.html"), encoding="utf-8") as f:
    page = f.read()
with open(GLB, "rb") as f:
    data = base64.b64encode(f.read()).decode("ascii")

marker = '<script type="importmap">'
standalone = page.replace(marker, '<script type="application/octet-stream" id="g16-glb">' + data + "</script>\n" + marker, 1)
with open(os.path.join(HERE, "g16-7630-standalone.html"), "w", encoding="utf-8") as f:
    f.write(standalone)

split = page.index("<canvas")
site = os.path.join(ROOT, "site")
os.makedirs(site, exist_ok=True)
with open(os.path.join(site, "index.html"), "w", encoding="utf-8") as f:
    f.write('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + page[:split] + "</head>\n<body>\n" + page[split:] + "</body>\n</html>\n")
shutil.copyfile(GLB, os.path.join(site, "g16-7630.glb"))
for name in ("index.html", "g16-7630.glb"):
    print(name, os.path.getsize(os.path.join(site, name)))
print("standalone", os.path.getsize(os.path.join(HERE, "g16-7630-standalone.html")))
