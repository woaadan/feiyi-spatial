# -*- coding: utf-8 -*-
"""空间人文分析：集中度、区位商、重心迁移、标准差椭圆、Moran's I / LISA、
最近邻指数、核密度、Zipf、洛伦兹曲线等。输出 data/app_data.json 与分析表。
"""
import json, os, math, csv, collections, random
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
GEO = os.path.join(DATA, "geo")
random.seed(42); np.random.seed(42)

R = 6371.0
CHINA_AREA = 9_600_000.0

CATS = ["民间文学", "传统音乐", "传统舞蹈", "传统戏剧", "曲艺", "传统体育、游艺与杂技",
        "传统美术", "传统技艺", "传统医药", "民俗"]
CAT_ORDER = CATS + [f"传统工艺·{x}" for x in
                    ["纺染织绣", "服饰制作", "编织扎制", "雕刻塑造", "家具建筑", "金属加工",
                     "剪纸刻绘", "陶瓷烧造", "文房制作", "漆器髹饰", "印刷装裱", "食品制作",
                     "中药炮制", "器具制作"]]
BATCH_ORDER = ["第一批 2006", "第二批 2008", "第三批 2011", "第四批 2014", "第五批 2021",
               "2018振兴目录"]


def load_csv(p):
    with open(p, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def hdist(lng1, lat1, lng2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(a)))


def poly_area(rings):
    """球面多边形面积（km²）。rings: [ [ [lng,lat], ... ], ... ]"""
    total = 0.0
    for ring in rings:
        if len(ring) < 3:
            continue
        s = 0.0
        for i in range(len(ring) - 1):
            lng1, lat1 = ring[i]; lng2, lat2 = ring[i + 1]
            s += math.radians(lng2 - lng1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
        total += abs(s * R * R / 2.0)
    return total


def shannon(counts):
    tot = sum(counts)
    if tot <= 0:
        return 0.0
    ps = [c / tot for c in counts if c > 0]
    return -sum(p * math.log(p) for p in ps)


def gini(vals):
    v = np.sort(np.array(vals, dtype=float))
    n = len(v)
    if n == 0 or v.sum() == 0:
        return 0.0
    cum = np.cumsum(v)
    return float((n + 1 - 2 * (cum / cum[-1]).sum()) / n)


def lorenz(vals):
    v = np.sort(np.array(vals, dtype=float))
    x = np.linspace(0, 1, len(v) + 1)
    y = np.concatenate([[0], np.cumsum(v) / v.sum()])
    return x.tolist(), y.tolist()


def moran(values, W):
    n = len(values)
    z = np.array(values, float)
    z = (z - z.mean())
    S0 = W.sum()
    num = 0.0
    for i in range(n):
        for j in range(n):
            num += W[i, j] * z[i] * z[j]
    den = (z ** 2).sum()
    if den == 0 or S0 == 0:
        return 0.0
    return n / S0 * num / den


def local_moran(values, W, perms=499):
    n = len(values)
    z = np.array(values, float); zc = z - z.mean()
    m2 = (zc ** 2).mean()
    I = np.zeros(n)
    for i in range(n):
        I[i] = zc[i] / m2 * sum(W[i, j] * zc[j] for j in range(n))
    p = np.ones(n)
    rng = np.random.default_rng(7)
    for i in range(n):
        sims = np.empty(perms)
        for k in range(perms):
            idx = rng.permutation(n)
            sims[k] = zc[i] / m2 * sum(W[i, j] * zc[idx[j]] for j in range(n))
        p[i] = (np.sum(np.abs(sims) >= abs(I[i])) + 1) / (perms + 1)
    return I.tolist(), p.tolist()


def main():
    pts = load_csv(os.path.join(DATA, "points.csv"))
    for p in pts:
        p["经度"] = float(p["经度"]); p["纬度"] = float(p["纬度"])

    for p in pts:
        if not p["市"]:
            p["_city"] = p["省"]
            p["_citycode"] = p["省代码"]
        else:
            p["_city"] = p["市"]
            p["_citycode"] = p["市代码"] or p["省代码"]

    gj = json.load(open(os.path.join(GEO, "china_provinces.json"), encoding="utf-8"))

    # ---------- 省域 ----------
    prov_meta = {}
    for f in gj["features"]:
        pr = f["properties"]
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        rings = [poly[0] for poly in polys if poly]
        prov_meta[pr["name"]] = {
            "code": pr["adcode"], "center": pr.get("center") or pr.get("centroid"),
            "area": poly_area(rings), "rings": rings,
        }

    prov_counts = collections.Counter(p["省"] for p in pts)
    prov_cats = collections.defaultdict(collections.Counter)
    prov_batch = collections.defaultdict(collections.Counter)
    for p in pts:
        prov_cats[p["省"]][p["类别"]] += 1
        prov_batch[p["省"]][p["批次"]] += 1

    provinces = []
    total_pts = len(pts)
    for name, meta in prov_meta.items():
        n = prov_counts.get(name, 0)
        cats = prov_cats.get(name, {})
        top = max(cats.items(), key=lambda kv: kv[1]) if cats else ("", 0)
        provinces.append({
            "name": name, "code": meta["code"], "count": n,
            "share": n / total_pts, "area": meta["area"],
            "density": n / (meta["area"] / 10000) if meta["area"] else 0,
            "n_cat": len(cats), "shannon": shannon(list(cats.values())),
            "top_cat": top[0], "top_cat_n": top[1],
            "east_hu": sum(1 for p in pts if p["省"] == name and p["胡焕庸线以东"] == "是"),
            **{f"b_{b}": prov_batch[name].get(b, 0) for b in BATCH_ORDER},
        })
    provinces.sort(key=lambda x: -x["count"])

    # ---------- 市域 ----------
    city_meta = collections.defaultdict(lambda: {"n": 0, "lng": 0.0, "lat": 0.0, "cats": collections.Counter()})
    for p in pts:
        c = city_meta[p["_city"]]
        c["n"] += 1; c["lng"] += p["经度"]; c["lat"] += p["纬度"]; c["cats"][p["类别"]] += 1
    cities = []
    for name, c in city_meta.items():
        cities.append({"name": name, "prov": next((p["省"] for p in pts if p["_city"] == name), ""),
                       "count": c["n"], "lng": c["lng"] / c["n"], "lat": c["lat"] / c["n"],
                       "n_cat": len(c["cats"]),
                       "shannon": shannon(list(c["cats"].values())),
                       "top_cat": max(c["cats"].items(), key=lambda kv: kv[1])[0]})
    cities.sort(key=lambda x: -x["count"])
    city_gini = gini([c["count"] for c in cities])

    # ---------- 类别 ----------
    cat_counts = collections.Counter(p["类别"] for p in pts)
    cat_prov = collections.defaultdict(collections.Counter)
    for p in pts:
        cat_prov[p["类别"]][p["省"]] += 1
    categories = []
    for c, n in cat_counts.most_common():
        pc = cat_prov[c]
        top = pc.most_common(1)[0]
        categories.append({
            "name": c, "count": n, "n_prov": len(pc),
            "top_prov": top[0], "top_prov_n": top[1],
            "top_share": top[1] / n, "entropy": shannon(list(pc.values())),
            "batch": {b: sum(1 for p in pts if p["类别"] == c and p["批次"] == b) for b in BATCH_ORDER},
        })

    # 区位商 LQ
    lq = {}
    for name in [x["name"] for x in provinces[:31]]:
        lq[name] = {}
        for c in cat_counts:
            a = prov_cats[name].get(c, 0)
            b = prov_counts.get(name, 0)
            if b == 0:
                lq[name][c] = 0; continue
            lq[name][c] = (a / b) / (cat_counts[c] / total_pts)

    # ---------- 批次重心与标准差椭圆 ----------
    batch_stats = {}
    for b in BATCH_ORDER:
        sel = [p for p in pts if p["批次"] == b]
        if not sel:
            continue
        lngs = np.array([p["经度"] for p in sel]); lats = np.array([p["纬度"] for p in sel])
        mlng, mlat = lngs.mean(), lats.mean()
        k = math.cos(math.radians(mlat))
        X = (lngs - mlng) * k * 111.32
        Y = (lats - mlat) * 110.57
        cov = np.cov(np.vstack([X, Y]))
        evals, evecs = np.linalg.eigh(cov)
        order = np.argsort(evals)[::-1]
        evals = evals[order]; evecs = evecs[:, order]
        ang = math.degrees(math.atan2(evecs[1, 0], evecs[0, 0]))
        batch_stats[b] = {
            "count": len(sel), "lng": mlng, "lat": mlat, "angle": ang,
            "major": float(math.sqrt(evals[0]) * 2), "minor": float(math.sqrt(evals[1]) * 2),
            "east_share": sum(1 for p in sel if p["胡焕庸线以东"] == "是") / len(sel),
            "radius_km": float(np.mean([np.hypot(x, y) for x, y in zip(X, Y)])),
        }

    # ---------- 最近邻指数（去重后的县级点位，避免同址重复造成零距离） ----------
    def nni(sel):
        seen = {}
        for p in sel:
            seen[(round(p["经度"], 4), round(p["纬度"], 4))] = p
        sel = list(seen.values())
        n = len(sel)
        if n < 3:
            return None
        A = CHINA_AREA
        exp = 0.5 / math.sqrt(n / A)
        d = []
        for i in range(n):
            best = 1e18
            for j in range(n):
                if i == j:
                    continue
                dd = hdist(sel[i]["经度"], sel[i]["纬度"], sel[j]["经度"], sel[j]["纬度"])
                if dd < best:
                    best = dd
            d.append(best)
        md = float(np.mean(d))
        se = 0.26136 * math.sqrt(A / (n * n))
        z = (md - exp) / se
        from math import erf, sqrt
        pval = 1 - 0.5 * (1 + erf(abs(z) / sqrt(2)))
        return {"n": n, "mean_d": md, "expected": exp,
                "R": float(md / exp), "median_d": float(np.median(d)),
                "z": float(z), "p": float(pval)}

    nni_all = nni(pts)
    nni_by_cat = {c: nni([p for p in pts if p["类别"] == c]) for c in cat_counts}

    # ---------- Zipf / 位序规模 ----------
    sizes = np.array([c["count"] for c in cities], float)
    ranks = np.arange(1, len(sizes) + 1)
    ok = sizes > 0
    slope, intercept = np.polyfit(np.log(ranks[ok]), np.log(sizes[ok]), 1)

    # ---------- 省域 Moran's I / LISA ----------
    mainland = [p for p in provinces if p["name"] not in ("香港特别行政区", "澳门特别行政区", "台湾省")]
    n = len(mainland)
    vset = {}
    for p in mainland:
        s = set()
        for ring in prov_meta[p["name"]]["rings"]:
            for pt in ring:
                s.add((round(pt[0], 3), round(pt[1], 3)))
        vset[p["name"]] = s
    W = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            if len(vset[mainland[i]["name"]] & vset[mainland[j]["name"]]) >= 2:
                W[i, j] = W[j, i] = 1
    # 琼州海峡：海南与广东按邻接处理
    names_m = [p["name"] for p in mainland]
    if "海南省" in names_m and "广东省" in names_m:
        i, j = names_m.index("海南省"), names_m.index("广东省")
        W[i, j] = W[j, i] = 1
    deg = W.sum(1)
    # 孤岛用 4 近邻补边
    centers = np.array([prov_meta[p["name"]]["center"] for p in mainland])
    for i in range(n):
        if deg[i] == 0:
            d = [(hdist(centers[i][0], centers[i][1], centers[j][0], centers[j][1]), j) for j in range(n) if j != i]
            for _, j in sorted(d)[:4]:
                W[i, j] = W[j, i] = 1
    Wr = W / np.maximum(W.sum(1, keepdims=True), 1)
    vals = [mainland[i]["density"] for i in range(n)]
    I_density = moran(vals, Wr)
    vals_cnt = [mainland[i]["count"] for i in range(n)]
    I_count = moran(vals_cnt, Wr)
    I_local, p_local = local_moran(vals, Wr, perms=299)
    lisa = []
    for i, p in enumerate(mainland):
        z = (vals[i] - np.mean(vals)) / (np.std(vals) or 1)
        lag = sum(Wr[i, j] * (vals[j] - np.mean(vals)) for j in range(n)) / (np.std(vals) or 1)
        typ = ("HH" if z > 0 and lag > 0 else "LL" if z < 0 and lag < 0
               else "HL" if z > 0 else "LH")
        lisa.append({"name": p["name"], "I": I_local[i], "p": p_local[i], "type": typ,
                     "z": float(z), "lag": float(lag), "density": vals[i]})
    # 999 次置换的全局显著性
    perm = []
    for _ in range(199):
        v = list(vals); random.shuffle(v)
        perm.append(moran(v, Wr))
    p_global = (sum(1 for x in perm if abs(x) >= abs(I_density)) + 1) / (len(perm) + 1)

    # ---------- 区域划分 / Theil 分解 ----------
    REGION = {}
    for nme in ["北京市", "天津市", "河北省", "上海市", "江苏省", "浙江省", "福建省",
                "山东省", "广东省", "海南省"]:
        REGION[nme] = "东部"
    for nme in ["山西省", "安徽省", "江西省", "河南省", "湖北省", "湖南省"]:
        REGION[nme] = "中部"
    for nme in ["辽宁省", "吉林省", "黑龙江省"]:
        REGION[nme] = "东北"
    for nme in ["内蒙古自治区", "广西壮族自治区", "重庆市", "四川省", "贵州省", "云南省",
                "西藏自治区", "陕西省", "甘肃省", "青海省", "宁夏回族自治区", "新疆维吾尔自治区"]:
        REGION[nme] = "西部"

    reg_counts = collections.Counter()
    reg_prov = collections.defaultdict(list)
    for p in provinces:
        r = REGION.get(p["name"], "其他")
        reg_counts[r] += p["count"]
        reg_prov[r].append(p)

    def theil_t(vals, n_total=None):
        """Theil T 指数；n_total 为总体单位数（用于组间/组内分解的一致性）。"""
        v = np.array(vals, float)
        tot = v.sum()
        n = len(v) if n_total is None else n_total
        return float(np.sum(v / tot * np.log((v / tot) / (1.0 / n) + 1e-15)))

    prov_main = [p for p in provinces if p["name"] in REGION]
    T_total = theil_t([p["count"] for p in prov_main])
    N = len(prov_main)
    gm = total_pts / N
    T_between = sum((reg_counts[r] / total_pts) * math.log((reg_counts[r] / len(reg_prov[r])) / gm + 1e-15)
                    for r in reg_counts if r != "其他")
    T_within = sum((reg_counts[r] / total_pts) * theil_t([p["count"] for p in reg_prov[r]])
                   for r in reg_counts if r != "其他")
    T_total = T_between + T_within
    regions = [{"name": r, "count": reg_counts[r], "share": reg_counts[r] / total_pts,
                "provinces": len(reg_prov[r]),
                "theil": theil_t([p["count"] for p in reg_prov[r]]) if r != "其他" else 0}
               for r in ["东部", "中部", "西部", "东北"] if reg_counts.get(r)]

    # ---------- 对应分析 CA ----------
    pnames = [p["name"] for p in provinces if p["count"] > 0]
    M = np.array([[prov_cats[p].get(c, 0) for c in CATS] for p in pnames], float)
    P = M / M.sum()
    r = P.sum(1); c_ = P.sum(0)
    Dr = np.diag(1 / np.sqrt(np.maximum(r, 1e-12)))
    Dc = np.diag(1 / np.sqrt(np.maximum(c_, 1e-12)))
    S = Dr @ (P - np.outer(r, c_)) @ Dc
    U, sv, Vt = np.linalg.svd(S, full_matrices=False)
    row_c = Dr @ U[:, :2] * sv[:2]
    col_c = Dc @ Vt[:2].T * sv[:2]
    inertia = float((sv ** 2).sum())
    ca = {
        "provinces": [{"name": nme, "x": float(row_c[i, 0]), "y": float(row_c[i, 1]),
                       "count": prov_counts.get(nme, 0)} for i, nme in enumerate(pnames)],
        "categories": [{"name": CATS[j], "x": float(col_c[j, 0]), "y": float(col_c[j, 1]),
                        "count": cat_counts.get(CATS[j], 0)} for j in range(len(CATS))],
        "explained": [float(sv[0] ** 2 / inertia), float(sv[1] ** 2 / inertia)],
    }

    # ---------- 集中度 CR3 / 类型 ----------
    cr3 = {}
    for c, pc in cat_prov.items():
        tot = sum(pc.values())
        cr3[c] = sum(v for _, v in pc.most_common(3)) / tot
    type_batch = collections.Counter((p["批次"], p["类型"]) for p in pts)
    ethnic = sum(1 for p in pts if ("自治州" in p["_city"] or "自治县" in p["县区"] or "自治旗" in p["县区"]))


    # ---------- 核密度 ----------
    lngs = np.array([p["经度"] for p in pts]); lats = np.array([p["纬度"] for p in pts])
    step = 0.5
    gl = np.arange(72, 136 + step, step)
    ga = np.arange(17, 54 + step, step)
    bw = 1.5
    heat = []
    for la in ga:
        for lo in gl:
            d2 = ((lngs - lo) * math.cos(math.radians(la))) ** 2 + (lats - la) ** 2
            v = float(np.exp(-d2 / (2 * bw * bw)).sum())
            if v > 0.4:
                heat.append([round(float(lo), 2), round(float(la), 2), round(v, 3)])

    # ---------- 胡焕庸线 ----------
    east = sum(1 for p in pts if p["胡焕庸线以东"] == "是")

    # ---------- 多省共享项目 ----------
    name_prov = collections.defaultdict(set)
    for p in pts:
        name_prov[p["名称"]].add(p["省"])
    shared = sorted(((len(v), k) for k, v in name_prov.items() if len(v) > 1), reverse=True)[:15]

    # ---------- 省级类别矩阵 ----------
    top_provs = [x["name"] for x in provinces[:16]]
    matrix = [[prov_cats[p].get(c, 0) for c in CATS] for p in top_provs]

    # ---------- 汇总 ----------
    summary = {
        "records": len({p["seq"] for p in pts}),
        "points": total_pts,
        "sites": len({(round(p["经度"], 4), round(p["纬度"], 4)) for p in pts}),
        "provinces": len([p for p in provinces if p["count"] > 0]),
        "cities": len(cities),
        "categories": len(cat_counts),
        "batches": len([b for b in BATCH_ORDER if batch_stats.get(b)]),
        "east_share": east / total_pts,
        "west_share": 1 - east / total_pts,
        "city_gini": city_gini,
        "prov_gini": gini([p["count"] for p in provinces]),
        "nni_all": nni_all, "zipf_slope": float(slope), "zipf_r2": float(
            1 - ((np.log(sizes[ok]) - (slope * np.log(ranks[ok]) + intercept)) ** 2).sum() /
            ((np.log(sizes[ok]) - np.log(sizes[ok]).mean()) ** 2).sum()),
        "moran_density": I_density, "moran_count": I_count, "moran_p": p_global,
        "mean_nn_km": nni_all["mean_d"], "median_nn_km": nni_all["median_d"],
        "top_city": cities[0]["name"], "top_city_n": cities[0]["count"],
        "top_prov": provinces[0]["name"], "top_prov_n": provinces[0]["count"],
        "年份_批次": {b: batch_stats[b]["count"] for b in batch_stats},
        "theil": {"total": T_total, "between": float(T_between), "within": float(T_within)},
        "ethnic_share": ethnic / total_pts,
        "cr3_mean": float(np.mean(list(cr3.values()))),
    }

    out = {
        "summary": summary, "provinces": provinces, "cities": cities[:120],
        "categories": categories, "batch_stats": batch_stats, "nni_by_cat": nni_by_cat,
        "matrix": {"provinces": top_provs, "cats": CATS, "values": matrix},
        "lq": lq, "lisa": lisa, "heat": heat,
        "lorenz_city": lorenz([c["count"] for c in cities]),
        "lorenz_prov": lorenz([p["count"] for p in provinces]),
        "shared": shared, "batch_order": BATCH_ORDER, "cat_order": CAT_ORDER,
        "hu_line": [[127.5, 50.25], [98.5, 25.0]],
        "weights_degree": {mainland[i]["name"]: int(W.sum(1)[i]) for i in range(n)},
        "regions": regions, "region_of": REGION, "ca": ca, "cr3": cr3,
        "type_batch": {f"{k[0]}|{k[1]}": v for k, v in type_batch.items()},
    }
    json.dump(out, open(os.path.join(DATA, "app_data.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    json.dump(out, open(os.path.join(DATA, "analysis_full.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    print(json.dumps(summary, ensure_ascii=False, indent=1))
    print("top cities:", [(c["name"], c["count"]) for c in cities[:10]])
    print("lisa sig:", [(l["name"], l["type"], round(l["p"], 3)) for l in lisa if l["p"] < 0.05][:15])
    print("heat cells", len(heat))
    print("zero-degree provinces:", [mainland[i]["name"] for i in range(n) if deg[i] == 0])


if __name__ == "__main__":
    main()
