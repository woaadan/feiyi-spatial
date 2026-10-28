# -*- coding: utf-8 -*-
"""抓取阿里云 DataV 全国行政区划边界（省/市/县），提取 adcode、name、center、centroid。
输出: data/geo/admin_units.json  与  data/geo/china_provinces.json（简化后的省级 GeoJSON）
"""
import json, os, time, urllib.request, concurrent.futures as cf

BASE = "https://geo.datav.aliyun.com/areas_v3/bound/{}.json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "data", "geo")
os.makedirs(GEO, exist_ok=True)


def fetch(code, full=True):
    url = BASE.format(f"{code}_full" if full else str(code))
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def props(feat):
    p = feat.get("properties") or {}
    return p


def main():
    country = fetch(100000)
    provinces = [f for f in country["features"]
                 if str(props(f).get("adcode", "")).isdigit()]
    units = []
    prov_polys = []

    def add(code, name, center, centroid, level, parent, path):
        units.append({
            "adcode": int(code), "name": name, "center": center,
            "centroid": centroid, "level": level, "parent": parent, "path": path,
        })

    for pf in provinces:
        p = props(pf); pcode = int(p["adcode"]); pname = p["name"]
        add(pcode, pname, p.get("center"), p.get("centroid"), "province", 100000, [pname])
        prov_polys.append(pf)

    print("provinces", len(units))

    def do_province(pf):
        p = props(pf); pcode = int(p["adcode"]); pname = p["name"]
        out = []
        d = fetch(pcode)
        if not d:
            return out
        for cf in d.get("features", []):
            cp = props(cf)
            if cp.get("level") == "province":
                continue
            ccode = int(cp["adcode"]); cname = cp["name"]
            clevel = cp.get("level", "city")
            out.append({"adcode": ccode, "name": cname, "center": cp.get("center"),
                        "centroid": cp.get("centroid"), "level": clevel,
                        "parent": pcode, "path": [pname, cname]})
        return out

    cities = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(do_province, provinces):
            cities.extend(res)
    print("cities", len(cities))

    for c in cities:
        add(c["adcode"], c["name"], c["center"], c["centroid"], c["level"], c["parent"], c["path"])

    # 县级：只对 level == city 的节点继续下钻
    to_drill = [c for c in cities if c["level"] == "city"]

    def do_city(c):
        out = []
        d = fetch(c["adcode"])
        if not d:
            return out
        for xf in d.get("features", []):
            xp = props(xf)
            xcode = int(xp["adcode"]); xname = xp["name"]
            out.append({"adcode": xcode, "name": xname, "center": xp.get("center"),
                        "centroid": xp.get("centroid"), "level": xp.get("level", "district"),
                        "parent": c["adcode"], "path": c["path"] + [xname]})
        return out

    counties = []
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        for res in ex.map(do_city, to_drill):
            counties.extend(res)
    print("counties", len(counties))

    for c in counties:
        add(c["adcode"], c["name"], c["center"], c["centroid"], c["level"], c["parent"], c["path"])

    # 去重（同名 adcode 只留一次）
    seen = {}
    for u in units:
        seen[u["adcode"]] = u
    units = list(seen.values())

    with open(os.path.join(GEO, "admin_units.json"), "w", encoding="utf-8") as f:
        json.dump(units, f, ensure_ascii=False)

    # 省级边界：坐标精度降到 3 位小数，去掉冗余字段
    def round_coords(o):
        if isinstance(o, (int, float)):
            return round(o, 3)
        if isinstance(o, list):
            return [round_coords(x) for x in o]
        if isinstance(o, dict):
            return {k: round_coords(v) for k, v in o.items()}
        return o

    slim = {"type": "FeatureCollection", "features": []}
    for pf in prov_polys:
        p = pf["properties"]
        slim["features"].append({
            "type": "Feature",
            "properties": {"adcode": p["adcode"], "name": p["name"],
                           "center": p.get("center"), "centroid": p.get("centroid")},
            "geometry": round_coords(pf["geometry"]),
        })
    with open(os.path.join(GEO, "china_provinces.json"), "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, separators=(",", ":"))
    print("saved", len(units), "units")


if __name__ == "__main__":
    main()
