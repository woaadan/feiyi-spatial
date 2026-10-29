# -*- coding: utf-8 -*-
"""性能优化：简化省界；点位全字典编码 + 链接只存 id；剥离网页用不到的聚合字段。
运行前需存在 data/points.csv（由 03_build.py 生成）。"""
import csv, io, json, os, re, math

ROOT = r"C:\Users\11487\Downloads\数字人文\feiyi-spatial"
FIELDS = ["seq", "name", "cat", "batch", "dataset", "prov", "city", "county",
          "lng", "lat", "prec", "link", "kind", "raw"]


def load_points():
    with io.open(os.path.join(ROOT, "data", "points.csv"), encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def build_points():
    rows = load_points()
    src = {"name": "名称", "cat": "类别", "batch": "批次", "dataset": "数据集",
           "prov": "省", "city": "市", "county": "县区", "prec": "定位精度",
           "raw": "地点片段"}
    keys = list(src)
    dicts = {k: [] for k in keys}
    index = {k: {} for k in keys}
    out = []
    for r in rows:
        vals = []
        for k in keys:
            v = r[src[k]] or ""
            if v not in index[k]:
                index[k][v] = len(dicts[k])
                dicts[k].append(v)
            vals.append(index[k][v])
        pid = ""
        m = re.search(r"/(\d+)\.html", r["链接"] or "")
        if m:
            pid = int(m.group(1))
        out.append([int(r["seq"]), vals[0], vals[1], vals[2], vals[3], vals[4],
                    vals[5], vals[6], float(r["经度"]), float(r["纬度"]), vals[7],
                    pid, vals[8]])
    return {"dict": dicts, "rows": out}


def simplify_ring(ring, eps):
    if len(ring) < 5:
        return ring
    closed = ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring
    n = len(pts)
    if n < 4:
        return ring
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a][0], pts[a][1]
        bx, by = pts[b][0], pts[b][1]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        bi, bd = -1, eps
        for i in range(a + 1, b):
            px, py = pts[i][0], pts[i][1]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > bd:
                bd, bi = d, i
        if bi > 0:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    out = [p for p, k in zip(pts, keep) if k]
    if len(out) < 4:
        return ring
    if closed:
        out = out + [out[0]]
    return out


def build_geo():
    p = os.path.join(ROOT, "data", "geo", "china_provinces.json")
    with io.open(p, encoding="utf-8") as f:
        g = json.load(f)
    n0 = n1 = 0
    for feat in g["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            for i, ring in enumerate(poly):
                n0 += len(ring)
                nr = simplify_ring(ring, 0.01)
                n1 += len(nr)
                poly[i] = [[round(x, 3), round(y, 3)] for x, y in nr]
    return g, n0, n1


def main():
    # 省界
    g, n0, n1 = build_geo()
    gp = os.path.join(ROOT, "data", "geo", "china_provinces.json")
    with io.open(gp, "w", encoding="utf-8") as f:
        json.dump(g, f, ensure_ascii=False, separators=(",", ":"))
    with io.open(os.path.join(ROOT, "data", "geo", "china_provinces.js"), "w", encoding="utf-8") as f:
        f.write("window.CHINA_GEO=")
        json.dump(g, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    print(f"geo {n0}->{n1} vertices, {os.path.getsize(gp)/1024:.0f}KB")

    # 点位
    payload = build_points()
    pp = os.path.join(ROOT, "data", "map_points.json")
    with io.open(pp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    with io.open(os.path.join(ROOT, "data", "map_points.js"), "w", encoding="utf-8") as f:
        f.write("window.MAP_POINTS=")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    print(f"points {len(payload['rows'])} rows, {os.path.getsize(pp)/1024:.0f}KB")

    # app_data：去掉网页不用的字段
    ap = os.path.join(ROOT, "data", "app_data.json")
    with io.open(ap, encoding="utf-8") as f:
        app = json.load(f)
    for k in ["heat", "shared", "type_batch", "weights_degree", "region_of", "cat_order"]:
        app.pop(k, None)
    with io.open(ap, "w", encoding="utf-8") as f:
        json.dump(app, f, ensure_ascii=False, separators=(",", ":"))
    with io.open(os.path.join(ROOT, "data", "app_data.js"), "w", encoding="utf-8") as f:
        f.write("window.APP_DATA=")
        json.dump(app, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";")
    print(f"app_data {os.path.getsize(ap)/1024:.0f}KB")


if __name__ == "__main__":
    main()
