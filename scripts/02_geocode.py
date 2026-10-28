# -*- coding: utf-8 -*-
"""v2: 申报地区解析（含全局回退、历史地名映射、机构识别）+ 项目序号行政区划码交叉校验。
输出 data/geo/places2.json 与 data/geo/review.csv（待人工复核清单）
"""
import json, os, re, csv, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO = os.path.join(ROOT, "data", "geo")
units = json.load(open(os.path.join(GEO, "admin_units.json"), encoding="utf-8"))
BY_CODE = {u["adcode"]: u for u in units}

PROV_ALIAS = {}
for u in units:
    if u["level"] != "province":
        continue
    n = u["name"]
    PROV_ALIAS[n] = u
    short = n
    for suf in ["维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市"]:
        if n.endswith(suf):
            short = n[: -len(suf)]
            break
    PROV_ALIAS.setdefault(short, u)
for alias, target in [("内蒙", "内蒙古"), ("广西壮族", "广西"), ("宁夏回族", "宁夏"),
                      ("新疆维吾尔", "新疆")]:
    if target in PROV_ALIAS:
        PROV_ALIAS.setdefault(alias, PROV_ALIAS[target])

BY_PROV = collections.defaultdict(list)
for u in units:
    if u["level"] != "province":
        BY_PROV[u["adcode"] // 10000 * 10000].append(u)

# 历史地名 / 简称 / 常见笔误 -> 现行 adcode
LEGACY = {
    "崇文区": 110101, "宣武区": 110102, "南汇区": 310115, "卢湾区": 310101,
    "万盛区": 500110, "汉沽区": 120116, "星子县": 360427, "潞西市": 533103,
    "盘县": 520281, "郫县": 510124, "陕县": 411203, "户县": 610118,
    "任县": 130505, "长岛县": 370614, "胶南市": 370211, "横县": 450181,
    "和布克塞尔蒙古自治县": 654226, "积石山县": 622927, "日喀则地区": 540200,
    "林芝地区": 540400, "山南地区": 540500, "昌都地区": 540300,
}
LEGACY_ALIAS = {
    "和布克赛尔蒙古自治县": 654226,
    "积石山保安族东乡族撒拉族自治县": 622927,
}

NAME_INDEX = collections.defaultdict(list)
for u in units:
    if u["level"] == "province":
        continue
    NAME_INDEX[u["name"]].append(u)

CITY_SUFFIX = ["自治州", "地区", "市", "盟", "林区"]
COUNTY_SUFFIX = ["自治县", "自治旗", "族自治县", "县", "市", "区", "旗", "新区", "林区"]
INST_RE = re.compile(r"(公司|集团|剧团|剧院|院团|书院|画院|大学|学院|学校|研究所|研究院|医院|"
                     r"协会|学会|中心|出版社|博物馆|纪念馆|局$|厅$|部$|厂$|社$|会馆|公司|"
                     r"工作室|传习所|基地|集团|有限|控股|药业|药厂|药店|饭店|餐厅|酒楼|"
                     r"艺术馆|文化馆|非遗|保护中心|联合会|研究会|促进会|传播中心|艺术团|"
                     r"歌舞团|杂技团|曲艺团|剧院|乐团|书画院|印社|斋|堂$)")

# 中央/全国性机构：按实际办公地落到区（人工校对，2024 年驻地）
INSTITUTIONS = {
    "中国中医科学院": 110101, "文化部": 110101, "故宫博物院": 110101,
    "中国艺术研究院": 110105, "中国社会科学院《格萨（斯）尔》办公室": 110101,
    "中国棋院": 110101, "中国文学艺术界联合会书法家协会": 110105,
    "中国艺术研究院中国书法院": 110105, "国家图书馆": 110108,
    "中国中药协会": 110102, "中华妈祖文化交流协会": 350302,
    "黄河水利委员会河南黄河河务局": 410105, "中国国家京剧院": 110102,
    "中国广播艺术团": 110102, "中国紫檀博物馆": 110105,
    "中国观赏石协会": 110102, "中国书店": 110102, "中国烹饪协会": 110102,
    "中国民族医药学会": 110101, "中国针灸学会": 110101,
    "中国北京同仁堂（集团）有限责任公司": 110101, "中国楹联学会": 110102,
    "中国农业博物馆": 110105, "中国珠算心算协会": 110102,
    "中国北京同仁堂有限责任公司": 110101,
}


def strip_suffix(name, sufs):
    for s in sufs:
        if name.endswith(s) and len(name) > len(s):
            return name[: -len(s)]
    return name


def match_province(seg):
    best = None
    for a in PROV_ALIAS:
        if a and seg.startswith(a) and (best is None or len(a) > len(best[0])):
            best = (a, PROV_ALIAS[a])
    return best


def match_child(seg, prov_code, level=None, parent=None):
    cands = [u for u in BY_PROV[prov_code] if level is None or u["level"] == level]
    if parent is not None:
        cands = [u for u in cands if u["parent"] == parent] or cands
    best = None
    for u in cands:
        n = u["name"]
        hit = None
        if seg.startswith(n):
            hit = n
        else:
            s = strip_suffix(n, CITY_SUFFIX + COUNTY_SUFFIX)
            if len(s) >= 2 and seg.startswith(s):
                hit = s
        if hit and (best is None or len(hit) > len(best[0])):
            best = (hit, u)
    return best


def global_match(seg):
    """无省前缀时，按县/市名全局匹配；唯一即用。"""
    for name, code in LEGACY.items():
        if seg == name or seg.startswith(name):
            return BY_CODE.get(code), name
    if seg in LEGACY_ALIAS:
        return BY_CODE.get(LEGACY_ALIAS[seg]), seg
    # 精确名
    for table in (NAME_INDEX,):
        if seg in table and len(table[seg]) >= 1:
            cands = sorted(table[seg], key=lambda u: (u["level"] != "district", u["adcode"]))
            return cands[0], seg
    # 前缀名（如「日喀则地区」->「日喀则市」）
    best = None
    for u in units:
        if u["level"] == "province":
            continue
        n = u["name"]
        if seg.startswith(n) or (len(strip_suffix(n, CITY_SUFFIX + COUNTY_SUFFIX)) >= 2
                                and seg.startswith(strip_suffix(n, CITY_SUFFIX + COUNTY_SUFFIX))):
            if best is None or len(n) > len(best[1]):
                best = (u, n)
    if best and len(best[1]) >= 2:
        return best[0], best[1]
    return None, None


def parse_segment(seg):
    original = seg
    seg = seg.strip().strip("　 ")
    seg = re.sub(r"[（(].*?[)）]", "", seg).strip()
    if not seg:
        return None, "empty"
    inst_code = None
    for k, v in INSTITUTIONS.items():
        if seg == k or seg.startswith(k) or k.startswith(seg) or (len(k) >= 8 and seg.startswith(k[:8])):
            inst_code = v
            break
    if inst_code:
        u = BY_CODE[inst_code]
        prov = BY_CODE.get(u["adcode"] // 10000 * 10000)
        return {"prov": prov, "city": None, "county": u, "precision": 3,
                "kind": "中央/全国性机构", "note": "机构驻地人工标注"}, "ok"
    pm = match_province(seg)
    if not pm:
        u, hit = global_match(seg)
        if u is None:
            return None, "unmatched"
        prov = BY_CODE.get(u["adcode"] // 10000 * 10000)
        return {"prov": prov, "city": u if u["level"] == "city" else None,
                "county": u if u["level"] == "district" else None,
                "precision": 3 if u["level"] == "district" else 2,
                "note": "全局匹配"}, "ok"
    palias, pu = pm
    rest = seg[len(palias):]
    prov_code = pu["adcode"]
    if not rest:
        kind = "省域" if original.strip() == pu["name"] else "机构/省域"
        return {"prov": pu, "city": None, "county": None, "precision": 1, "kind": kind}, "ok"
    cm = match_child(rest, prov_code, "city")
    if cm:
        city = cm[1]
        rest2 = rest[len(cm[0]):]
        if rest2:
            xm = match_child(rest2, prov_code, "district", parent=city["adcode"])
            if xm:
                return {"prov": pu, "city": city, "county": xm[1], "precision": 3}, "ok"
            # 历史区县
            for name, code in LEGACY.items():
                if rest2.startswith(name):
                    x = BY_CODE.get(code)
                    if x:
                        return {"prov": pu, "city": city, "county": x, "precision": 3,
                                "note": f"历史地名 {name}"}, "ok"
        return {"prov": pu, "city": city, "county": None,
                "precision": 2, "kind": "市域" if rest2 == "" else "机构/市域"}, "ok"
    xm = match_child(rest, prov_code, "district")
    if xm:
        return {"prov": pu, "city": None, "county": xm[1], "precision": 3}, "ok"
    for name, code in LEGACY.items():
        if rest.startswith(name):
            x = BY_CODE.get(code)
            if x:
                return {"prov": pu, "city": None, "county": x, "precision": 3,
                        "note": f"历史地名 {name}"}, "ok"
    return {"prov": pu, "city": None, "county": None,
            "precision": 1, "kind": "机构/省域" if INST_RE.search(rest) else "省域(未细化)"}, "ok"


def split_places(s):
    s = str(s).replace("；", "，").replace(";", "，").replace("、", "，").replace(" ", "")
    return [x for x in re.split(r"[，,]", s) if x.strip()]


def main():
    import openpyxl
    src = r"C:\Users\11487\Desktop\数字人文\空间人文\国家级非物质文化遗产代表性项目名录_全量4234条.xlsx"
    ws = openpyxl.load_workbook(src, read_only=True).worksheets[0]
    rows = [r for r in ws.iter_rows(min_row=3, values_only=True) if r[0] is not None]

    out, review = [], []
    for r in rows:
        serial = str(r[2] or "")
        m = re.search(r"_(\d{6})$", serial)
        serial_code = int(m.group(1)) if m else None
        for seg in split_places(r[8]):
            p, status = parse_segment(seg)
            if p is None:
                out.append({"seq": r[0], "raw": seg, "ok": False, "reason": status})
                review.append([r[0], r[3], r[8], seg, "未匹配", "", ""])
                continue
            u = p["county"] or p["city"] or p["prov"]
            if p["county"] and not p["city"]:
                par = BY_CODE.get(p["county"]["parent"])
                if par and par["level"] == "city":
                    p["city"] = par
            row = {
                "seq": r[0], "raw": seg, "ok": True,
                "prov": p["prov"]["name"], "prov_code": p["prov"]["adcode"],
                "city": (p["city"] or {}).get("name"),
                "city_code": (p["city"] or {}).get("adcode"),
                "county": (p["county"] or {}).get("name"),
                "county_code": (p["county"] or {}).get("adcode"),
                "lng": u["center"][0] if u.get("center") else None,
                "lat": u["center"][1] if u.get("center") else None,
                "precision": p["precision"],
                "kind": p.get("kind", "行政区"),
                "note": p.get("note", ""),
                "serial_code": serial_code,
            }
            # 交叉校验：项目序号中的县级码
            if serial_code and p["precision"] == 3 and p["county"]:
                if serial_code != p["county"]["adcode"]:
                    row["conflict"] = True
                    old = BY_CODE.get(serial_code)
                    row["serial_name"] = old["name"] if old else "（撤并旧码）"
                    if old and old["name"] != p["county"]["name"]:
                        row["conflict_type"] = ("上级码" if old["level"] != "district"
                                                else "异县（多为扩展项目主项目地）")
                        review.append([r[0], r[3], r[8], seg,
                                       "序号码为" + row["conflict_type"],
                                       f"{p['county']['adcode']}{p['county']['name']}",
                                       f"{serial_code}{old['name']}"])
                    else:
                        row["conflict_type"] = "旧码（区划调整）"
            out.append(row)

    json.dump(out, open(os.path.join(GEO, "places2.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)
    with open(os.path.join(GEO, "review.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f); w.writerow(["序号", "项目名称", "申报地区", "片段", "问题", "解析码", "序号码"])
        w.writerows(review)

    ok = [x for x in out if x["ok"]]
    print(f"segments={len(out)} ok={len(ok)} ({len(ok)/len(out):.1%})")
    print("precision:", collections.Counter(x["precision"] for x in ok))
    print("kind:", collections.Counter(x.get("kind") for x in ok))
    print("conflicts:", sum(1 for x in ok if x.get("conflict")))
    print("unmatched:", sum(1 for x in out if not x["ok"]))
    for x in [x for x in out if not x["ok"]][:30]:
        print("  ", x["raw"])


if __name__ == "__main__":
    main()
