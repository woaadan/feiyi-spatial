# -*- coding: utf-8 -*-
"""生成 favicon.png 与 file:// 可用的数据 JS。"""
import io, json, os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"C:\Users\11487\Downloads\数字人文\feiyi-spatial"

# ---- favicon ----
S = 128
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([4, 4, S - 4, S - 4], radius=22, fill=(166, 58, 47, 255))
try:
    f = ImageFont.truetype(r"C:\Windows\Fonts\simsun.ttc", 78)
except Exception:
    f = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 78)
box = d.textbbox((0, 0), "非", font=f)
w, h = box[2] - box[0], box[3] - box[1]
d.text(((S - w) / 2 - box[0], (S - h) / 2 - box[1] - 4), "非", font=f, fill=(247, 242, 232, 255))
im.save(os.path.join(ROOT, "favicon.png"))
print("favicon", os.path.getsize(os.path.join(ROOT, "favicon.png")))

# ---- data js ----
pairs = [
    ("data/app_data.json", "data/app_data.js", "APP_DATA"),
    ("data/map_points.json", "data/map_points.js", "MAP_POINTS"),
    ("data/geo/china_provinces.json", "data/geo/china_provinces.js", "CHINA_GEO"),
]
for src, dst, var in pairs:
    with io.open(os.path.join(ROOT, src), encoding="utf-8") as f:
        obj = json.load(f)
    with io.open(os.path.join(ROOT, dst), "w", encoding="utf-8") as f:
        f.write("window.%s=" % var)
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(dst, round(os.path.getsize(os.path.join(ROOT, dst)) / 1024), "KB")
