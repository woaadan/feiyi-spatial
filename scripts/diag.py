# -*- coding: utf-8 -*-
import json, re, collections, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = json.load(open(os.path.join(ROOT, "data", "geo", "places.json"), encoding="utf-8"))
print("== 按原始串统计 precision=1（省/直辖市整体）==")
c = collections.Counter(x["raw"] for x in p if x.get("precision") == 1)
print("distinct", len(c), "total", sum(c.values()))
for k, v in c.most_common(200):
    print(v, k)
