/* 国家级非遗空间图谱 — 前端逻辑 */
(function () {
  "use strict";

  const F = { SEQ: 0, NAME: 1, CAT: 2, BATCH: 3, SET: 4, PROV: 5, CITY: 6, COUNTY: 7, LNG: 8, LAT: 9, PREC: 10, LINK: 11, KIND: 12, RAW: 13 };

  const C = {
    ink: "#1c232a", ink2: "#465059", ink3: "#7b848c", line: "#d9cfbd",
    cinnabar: "#a63a2f", gold: "#b98a3c", teal: "#245b63", paper: "#f7f2e8"
  };

  const CAT_COLORS = {
    "民间文学": "#8c5a3c", "传统音乐": "#2f6f6b", "传统舞蹈": "#3f7d9c",
    "传统戏剧": "#a63a2f", "曲艺": "#b98a3c", "传统体育、游艺与杂技": "#6b7f3a",
    "传统美术": "#8a4f7d", "传统技艺": "#c26a3a", "传统医药": "#4c6b52",
    "民俗": "#7a6a55"
  };
  const CAT_COLOR_DEFAULT = "#98a0a6";

  const STATE = {
    data: null, points: [], geo: null,
    dataset: "all", cat: "all", batch: "all", prec: "all",
    layer: "choropleth", hu: true,
    page: 1, pageSize: 40, q: "", tblProv: "all", tblCat: "all"
  };

  const charts = {};
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const fmt = n => (n == null ? "-" : Number(n).toLocaleString("zh-CN"));

  function catColor(c) { return CAT_COLORS[c] || CAT_COLOR_DEFAULT; }

  function axisStyle(extra) {
    return Object.assign({
      axisLine: { lineStyle: { color: C.line } },
      axisTick: { show: false },
      axisLabel: { color: C.ink3, fontSize: 11 },
      splitLine: { lineStyle: { color: "rgba(217,207,189,.55)" } }
    }, extra || {});
  }

  /* ================= 数据加载 ================= */
  async function boot() {
    const [app, points, geo] = await Promise.all([
      fetch("data/app_data.json").then(r => r.json()),
      fetch("data/map_points.json").then(r => r.json()),
      fetch("data/geo/china_provinces.json").then(r => r.json())
    ]);
    STATE.data = app; STATE.points = points; STATE.geo = geo;
    echarts.registerMap("cnmap", geo);

    renderKPIs();
    initMap();
    initProvBar();
    initCategory();
    initLQ();
    initBatch();
    initEast();
    initCentroid();
    initMoran();
    initLisa();
    initTheil();
    initZipf();
    initLorenz();
    initNNI();
    initCA();
    initTable();
    initCounters();
    window.addEventListener("resize", () => Object.values(charts).forEach(c => c && c.resize()));
  }

  /* ================= KPI ================= */
  function renderKPIs() {
    const s = STATE.data.summary;
    const items = [
      [fmt(s.records), "申报记录（条）"],
      [fmt(s.points), "地理点位（个）"],
      [fmt(s.sites), "不重复县级驻地"],
      [fmt(s.provinces), "省级单元"],
      [fmt(s.cities), "市域单元"],
      [(s.east_share * 100).toFixed(1) + "%", "胡焕庸线以东"]
    ];
    $("#kpis").innerHTML = items.map(([v, l]) =>
      `<div class="kpi"><div class="num" data-count="${v}">${v}</div><div class="lab">${l}</div></div>`).join("");
  }

  function initCounters() {
    $$("#kpis .num").forEach(el => {
      const raw = el.dataset.count;
      const m = raw.replace(/,/g, "").match(/^([\d.]+)(.*)$/);
      if (!m) return;
      const target = parseFloat(m[1]), suffix = m[2] || "";
      const dec = (m[1].split(".")[1] || "").length;
      let t0 = null;
      const dur = 1100;
      const timer = setInterval(function () {
        if (t0 === null) t0 = Date.now();
        const k = Math.min(1, (Date.now() - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        const v = target * e;
        el.textContent = (dec ? v.toFixed(dec) : Math.round(v).toLocaleString("zh-CN")) + suffix;
        if (k >= 1) clearInterval(timer);
      }, 16);
    });
  }

  /* ================= 地图 ================= */
  function filtered() {
    return STATE.points.filter(p =>
      (STATE.dataset === "all" || p[F.SET] === STATE.dataset) &&
      (STATE.cat === "all" || p[F.CAT] === STATE.cat) &&
      (STATE.batch === "all" || p[F.BATCH] === STATE.batch) &&
      (STATE.prec === "all" || p[F.PREC] === STATE.prec));
  }

  function provCounts(rows) {
    const m = {};
    rows.forEach(p => { m[p[F.PROV]] = (m[p[F.PROV]] || 0) + 1; });
    return m;
  }
  function cityCounts(rows) {
    const m = {};
    rows.forEach(p => {
      const k = p[F.CITY] || p[F.PROV];
      if (!m[k]) m[k] = { n: 0, lng: 0, lat: 0, prov: p[F.PROV] };
      const o = m[k]; o.n++; o.lng += p[F.LNG]; o.lat += p[F.LAT];
    });
    Object.values(m).forEach(o => { o.lng /= o.n; o.lat /= o.n; });
    return m;
  }

  function kde(rows, step, bw) {
    const n = rows.length;
    if (!n) return [];
    const lng = new Float32Array(n), lat = new Float32Array(n);
    for (let i = 0; i < n; i++) { lng[i] = rows[i][F.LNG]; lat[i] = rows[i][F.LAT]; }
    const out = [];
    let max = 0;
    const inv = 1 / (2 * bw * bw);
    for (let la = 17; la <= 54; la += step) {
      const k = Math.cos(la * Math.PI / 180);
      for (let lo = 72; lo <= 136; lo += step) {
        let v = 0;
        for (let i = 0; i < n; i++) {
          const dx = (lng[i] - lo) * k, dy = lat[i] - la;
          v += Math.exp(-(dx * dx + dy * dy) * inv);
        }
        if (v > max) max = v;
        out.push([+lo.toFixed(2), +la.toFixed(2), v]);
      }
    }
    const thr = Math.max(0.35, max * 0.012);
    return out.filter(d => d[2] >= thr).map(d => [d[0], d[1], +d[2].toFixed(2)]);
  }

  function huLineSeries() {
    return [
      {
        type: "lines", coordinateSystem: "geo", geoIndex: 0, zlevel: 9, silent: true,
        data: [{ coords: STATE.data.hu_line }],
        lineStyle: { color: C.cinnabar, width: 1.2, type: "dashed", opacity: .8 }
      },
      {
        type: "scatter", coordinateSystem: "geo", geoIndex: 0, zlevel: 9, silent: true,
        data: [
          { name: "黑河", value: [127.5, 50.25, 0] },
          { name: "腾冲", value: [98.5, 25.0, 0] }
        ],
        symbolSize: 5, itemStyle: { color: C.cinnabar },
        label: { show: true, formatter: p => p.name, position: "right", color: C.cinnabar, fontSize: 10 }
      }
    ];
  }

  function buildMapOption() {
    const rows = filtered();
    const layer = STATE.layer;
    const series = [];
    const vms = [];
    const pcounts = provCounts(rows);
    const maxP = Math.max(1, ...Object.values(pcounts));

    series.push({
      name: "省域点位数", type: "map", geoIndex: 0, zlevel: 2,
      data: STATE.data.provinces.map(p => ({ name: p.name, value: pcounts[p.name] || 0 })),
      label: { show: false },
      emphasis: { label: { show: true, color: "#fff", fontSize: 11 }, itemStyle: { areaColor: C.gold } },
      itemStyle: { areaColor: "transparent", borderColor: "transparent" }
    });
    vms.push({
      type: "continuous", seriesIndex: 0, min: 0, max: maxP, show: layer === "choropleth",
      left: 16, bottom: 22, itemWidth: 10, itemHeight: 110, calculable: false,
      text: ["高", "低"], textStyle: { color: C.ink3, fontSize: 10 },
      inRange: { color: ["#f1e8d8", "#dcc4a4", "#c39468", "#9c5c3f", "#6b2f26"] }
    });

    if (layer === "heat") {
      const hd = kde(rows, 0.55, 1.4);
      series.push({
        name: "核密度", type: "heatmap", coordinateSystem: "geo", geoIndex: 0, zlevel: 3,
        data: hd, pointSize: 13, blurSize: 18, minOpacity: 0.15, maxOpacity: 0.9
      });
      vms.push({
        type: "continuous", seriesIndex: 1, show: true, min: 0,
        max: Math.max(1, ...hd.map(d => d[2])),
        left: 16, bottom: 22, itemWidth: 10, itemHeight: 110,
        text: ["密", "疏"], textStyle: { color: C.ink3, fontSize: 10 },
        inRange: { color: ["rgba(36,91,99,.15)", "#3d8388", "#b98a3c", "#c25a45", "#8c2f24"] }
      });
    }

    if (layer === "points") {
      series.push({
        name: "点位", type: "scatter", coordinateSystem: "geo", geoIndex: 0, zlevel: 4,
        symbolSize: 4.2, data: rows.map(p => ({
          name: p[F.NAME], value: [p[F.LNG], p[F.LAT], p[F.SEQ]],
          itemStyle: { color: catColor(p[F.CAT]), opacity: .78 }
        })),
        emphasis: { scale: 2.4, itemStyle: { opacity: 1, borderColor: "#fff", borderWidth: 1 } }
      });
    }

    if (layer === "bubble") {
      const cc = cityCounts(rows);
      const arr = Object.entries(cc).sort((a, b) => b[1].n - a[1].n);
      const mx = arr.length ? arr[0][1].n : 1;
      series.push({
        name: "市域点位数", type: "scatter", coordinateSystem: "geo", geoIndex: 0, zlevel: 4,
        data: arr.map(([k, o]) => ({
          name: k, value: [o.lng, o.lat, o.n],
          symbolSize: 4 + 26 * Math.sqrt(o.n / mx),
          itemStyle: { color: C.teal, opacity: .62, borderColor: "#fff", borderWidth: .6 }
        })),
        label: {
          show: true, formatter: p => (p.value[2] >= mx * 0.32 ? p.name : ""),
          position: "right", color: C.ink2, fontSize: 10
        },
        emphasis: { itemStyle: { color: C.cinnabar, opacity: .9 }, label: { show: true } }
      });
    }

    if (STATE.hu) series.push(...huLineSeries());

    return {
      backgroundColor: "transparent",
      animationDuration: 500,
      tooltip: {
        trigger: "item", confine: true, backgroundColor: "rgba(28,35,42,.94)",
        borderWidth: 0, padding: [9, 12], textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: function (p) {
          if (p.seriesType === "map") {
            const d = STATE.data.provinces.find(x => x.name === p.name);
            if (!d) return p.name;
            return `<b>${p.name}</b><br/>点位 ${fmt(p.value || 0)} · 占全国 ${(100 * (p.value || 0) / Math.max(1, rows.length)).toFixed(1)}%<br/>
              密度 ${d.density.toFixed(1)} 个/万km² · 首位类别 ${d.top_cat}`;
          }
          if (p.seriesType === "heatmap") return `核密度 ${p.value[2].toFixed(1)}`;
          if (p.seriesName === "市域点位数") return `<b>${p.name}</b><br/>点位 ${p.value[2]}`;
          if (p.seriesType === "scatter" && p.seriesName === "点位" && p.data && p.data.value.length > 2) {
            const row = STATE.points.find(x => x[F.SEQ] === p.data.value[2] &&
              Math.abs(x[F.LNG] - p.data.value[0]) < 1e-6 && Math.abs(x[F.LAT] - p.data.value[1]) < 1e-6);
            if (row) {
              return `<b>${row[F.NAME]}</b><br/>${row[F.CAT]} · ${row[F.BATCH]}<br/>
                ${row[F.PROV]} ${row[F.CITY] || ""} ${row[F.COUNTY] || ""}<br/>
                <span style="color:#bbb">定位精度：${row[F.PREC]}</span>`;
            }
          }
          return p.name;
        }
      },
      visualMap: vms,
      geo: {
        map: "cnmap", roam: true, zoom: 1.02,
        scaleLimit: { min: 1, max: 12 },
        itemStyle: {
          areaColor: "#f3ecdf", borderColor: "#cdbfa8", borderWidth: .8,
          shadowColor: "rgba(90,70,50,.10)", shadowBlur: 6
        },
        emphasis: { itemStyle: { areaColor: "#e6d4b8" }, label: { show: false } },
        select: { disabled: true }
      },
      series: series
    };
  }

  function initMap() {
    charts.map = echarts.init($("#mapChart"));
    charts.map.setOption(buildMapOption());
    charts.map.on("click", function (p) {
      if (p.seriesType === "map") showProvince(p.name);
      else if (p.seriesType === "scatter" && p.seriesName === "点位" && p.data && p.data.value.length > 2) {
        const row = STATE.points.find(x => x[F.SEQ] === p.data.value[2] && Math.abs(x[F.LNG] - p.data.value[0]) < 1e-6);
        if (row) showPointDetail(row);
      }
    });
    bindMapControls();
    updateMapFooter();
  }

  function updateMapFooter() {
    const rows = filtered();
    $("#mapFoot").innerHTML = `
      <span>当前筛选 <b style="color:#1c232a">${fmt(rows.length)}</b> 个点位</span>
      <span><i class="dot" style="background:#6b2f26"></i>省域分级</span>
      <span><i class="dot" style="background:${C.teal}"></i>市域气泡</span>
      <span><i class="dot" style="background:${C.cinnabar}"></i>胡焕庸线</span>
      <span style="margin-left:auto">底座：DataV 省级行政区划 · 点位取县级驻地</span>`;
  }

  function bindMapControls() {
    $$("#layerSeg button").forEach(b => b.onclick = () => {
      $$("#layerSeg button").forEach(x => x.classList.remove("on"));
      b.classList.add("on");
      STATE.layer = b.dataset.v; redrawMap();
    });
    $("#dsSel").onchange = e => { STATE.dataset = e.target.value; redrawMap(); };
    $("#catSel").onchange = e => { STATE.cat = e.target.value; redrawMap(); };
    $("#batchSel").onchange = e => { STATE.batch = e.target.value; redrawMap(); };
    $("#precSel").onchange = e => { STATE.prec = e.target.value; redrawMap(); };
    $("#huToggle").onchange = e => { STATE.hu = e.target.checked; redrawMap(); };
    $("#resetBtn").onclick = () => {
      STATE.dataset = "all"; STATE.cat = "all"; STATE.batch = "all"; STATE.prec = "all";
      $("#dsSel").value = "all"; $("#catSel").value = "all";
      $("#batchSel").value = "all"; $("#precSel").value = "all";
      charts.map.setOption({ geo: { zoom: 1.02, center: [104.5, 36.0] } });
      redrawMap();
    };
  }

  function redrawMap() {
    charts.map.setOption(buildMapOption(), true);
    updateMapFooter();
  }

  function showProvince(name) {
    const rows = filtered().filter(p => p[F.PROV] === name);
    const all = STATE.data.provinces.find(p => p.name === name) || {};
    if (!rows.length) {
      $("#provDetail").innerHTML = `<b>${name}</b><br/><span class="note">当前筛选条件下没有点位。</span>`;
      return;
    }
    const cats = {}, cities = {};
    rows.forEach(p => {
      cats[p[F.CAT]] = (cats[p[F.CAT]] || 0) + 1;
      const c = p[F.CITY] || p[F.PROV];
      cities[c] = (cities[c] || 0) + 1;
    });
    const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const topCity = Object.entries(cities).sort((a, b) => b[1] - a[1])[0];
    const maxN = topCats[0][1];
    $("#provDetail").innerHTML = `
      <b>${name}</b>
      <span class="note" style="margin-left:8px">${fmt(rows.length)} 点位 · 密度 ${(all.density || 0).toFixed(1)} 个/万km² · 首位市域 ${topCity[0]}（${topCity[1]}）</span>
      <div style="margin-top:8px;display:flex;gap:18px;flex-wrap:wrap">
        ${topCats.map(([c, n]) => `<span style="font-size:12px;color:#465059">${c} ${n}
          <span class="bar-mini" style="width:${Math.round(70 * n / maxN)}px"></span></span>`).join("")}
      </div>`;
  }

  function showPointDetail(row) {
    $("#provDetail").innerHTML = `
      <b>${row[F.NAME]}</b>
      <span class="note" style="margin-left:8px">${row[F.CAT]} · ${row[F.BATCH]}</span>
      <div class="note" style="margin-top:6px">${row[F.RAW]}　|　定位：${row[F.PROV]} ${row[F.CITY] || ""} ${row[F.COUNTY] || ""}（${row[F.PREC]}）
      ${row[F.LINK] ? `　<a href="${row[F.LINK]}" target="_blank" rel="noopener">中国非遗网详情 ↗</a>` : ""}</div>`;
  }

  /* ================= 省域排行 ================= */
  function initProvBar() {
    charts.provBar = echarts.init($("#provBar"));
    const d = STATE.data.provinces.filter(p => p.count > 0).slice(0, 20).reverse();
    charts.provBar.setOption({
      grid: { left: 92, right: 60, top: 8, bottom: 26 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: ps => {
          const p = d[ps[0].dataIndex];
          return `<b>${p.name}</b><br/>点位 ${fmt(p.count)}（${(p.share * 100).toFixed(1)}%）<br/>
            密度 ${p.density.toFixed(1)} 个/万km²<br/>类别多样性 ${p.shannon.toFixed(2)}<br/>首位类别 ${p.top_cat}`;
        }
      },
      xAxis: axisStyle({ type: "value", splitLine: { show: false }, axisLabel: { show: false }, axisLine: { show: false } }),
      yAxis: axisStyle({ type: "category", data: d.map(p => p.name), axisLine: { show: false }, axisLabel: { color: C.ink2, fontSize: 11.5 } }),
      series: [{
        type: "bar", data: d.map(p => p.count), barWidth: "58%",
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: "#d9c3a3" }, { offset: 1, color: "#a63a2f" }])
        },
        label: { show: true, position: "right", color: C.ink2, fontSize: 11, formatter: p => fmt(p.value) }
      }]
    });
  }

  /* ================= 类别 ================= */
  function initCategory() {
    charts.catBar = echarts.init($("#catBar"));
    const d = STATE.data.categories.slice().reverse();
    charts.catBar.setOption({
      grid: { left: 128, right: 74, top: 8, bottom: 22 },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: ps => {
          const c = d[ps[0].dataIndex];
          return `<b>${c.name}</b><br/>点位 ${fmt(c.count)} · 覆盖 ${c.n_prov} 省<br/>
            首位省 ${c.top_prov}（${(c.top_share * 100).toFixed(1)}%）<br/>CR3 集中度 ${(STATE.data.cr3[c.name] * 100).toFixed(0)}%`;
        }
      },
      xAxis: axisStyle({ type: "value", axisLabel: { show: false }, axisLine: { show: false }, splitLine: { show: false } }),
      yAxis: axisStyle({ type: "category", data: d.map(c => c.name), axisLine: { show: false }, axisLabel: { fontSize: 11, color: C.ink2 } }),
      series: [{
        type: "bar", data: d.map(c => ({ value: c.count, itemStyle: { color: catColor(c.name) } })),
        barWidth: "62%",
        label: { show: true, position: "right", fontSize: 10.5, color: C.ink3, formatter: p => fmt(p.value) }
      }]
    });
  }

  function shortProv(n) {
    return n.replace("维吾尔自治区", "").replace("壮族自治区", "").replace("回族自治区", "")
      .replace("自治区", "").replace("特别行政区", "").replace("省", "").replace("市", "");
  }

  function initLQ() {
    charts.lq = echarts.init($("#lqHeat"));
    const raw = STATE.data.lq;
    const provs = STATE.data.matrix.provinces.slice().reverse();
    const provLabels = provs.map(shortProv);
    const cats = STATE.data.matrix.cats;
    const data = [];
    let max = 0;
    provs.forEach((p, i) => cats.forEach((c, j) => {
      const v = raw[p][c];
      if (v > max) max = v;
      data.push([j, i, +v.toFixed(2)]);
    }));
    charts.lq.setOption({
      grid: { left: 92, right: 16, top: 44, bottom: 76 },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => `<b>${provs[p.value[1]]}</b> · ${cats[p.value[0]]}<br/>区位商 LQ = ${p.value[2]}` +
          `<br/><span style="color:#bbb">LQ>1 表示该省在此类别上相对全国更集中</span>`
      },
      xAxis: {
        type: "category", data: cats, splitArea: { show: true },
        axisLabel: { rotate: 38, fontSize: 10, color: C.ink3, interval: 0 },
        axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }
      },
      yAxis: {
        type: "category", data: provLabels, axisLabel: { fontSize: 10.5, color: C.ink2, interval: 0 },
        axisLine: { lineStyle: { color: C.line } }, axisTick: { show: false }, splitArea: { show: true }
      },
      visualMap: {
        min: 0, max: Math.min(3.2, max), calculable: false, orient: "horizontal",
        left: "center", bottom: 4, itemWidth: 12, itemHeight: 110,
        text: ["LQ 高", "低"], textStyle: { color: C.ink3, fontSize: 10 },
        inRange: { color: ["#f5eee1", "#e3cba6", "#c79157", "#9a5236", "#5d2620"] }
      },
      series: [{
        type: "heatmap", data,
        label: { show: true, fontSize: 9, color: "#3a3a3a", formatter: p => p.value[2] >= 1.5 ? p.value[2].toFixed(1) : "" },
        itemStyle: { borderWidth: 1, borderColor: "rgba(247,242,232,.8)" },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,.3)" } }
      }]
    });
  }

  /* ================= 时间 ================= */
  function initBatch() {
    charts.batch = echarts.init($("#batchBar"));
    const order = STATE.data.batch_order;
    const mainCats = STATE.data.matrix.cats;
    const data = {};
    STATE.points.forEach(p => {
      let c = p[F.CAT];
      if (mainCats.indexOf(c) < 0) c = "传统工艺（14 类）";
      if (!data[c]) data[c] = {};
      data[c][p[F.BATCH]] = (data[c][p[F.BATCH]] || 0) + 1;
    });
    const keys = Object.keys(data);
    const colors = Object.assign({ "传统工艺（14 类）": "#a9a08f" },
      Object.fromEntries(mainCats.map(c => [c, catColor(c)])));
    charts.batch.setOption({
      grid: { left: 52, right: 18, top: 64, bottom: 42 },
      legend: { top: 0, left: 0, itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 10.5, color: C.ink3 }, data: keys },
      tooltip: {
        trigger: "axis", axisPointer: { type: "shadow" },
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 }
      },
      xAxis: axisStyle({ type: "category", data: order, axisLabel: { fontSize: 10, color: C.ink3, interval: 0, rotate: 18 } }),
      yAxis: axisStyle({ type: "value", name: "点位", nameTextStyle: { color: C.ink3, fontSize: 10 } }),
      series: keys.map(k => ({
        name: k, type: "bar", stack: "t", barWidth: "52%",
        itemStyle: { color: colors[k] },
        data: order.map(b => (data[k] && data[k][b]) || 0)
      }))
    });
  }

  function initEast() {
    charts.east = echarts.init($("#eastLine"));
    const order = STATE.data.batch_order.filter(b => STATE.data.batch_stats[b]);
    const bs = STATE.data.batch_stats;
    charts.east.setOption({
      grid: { left: 46, right: 46, top: 30, bottom: 36 },
      tooltip: {
        trigger: "axis", backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0,
        textStyle: { color: "#f7f2e8", fontSize: 12 }
      },
      xAxis: axisStyle({ type: "category", data: order, axisLabel: { fontSize: 10, interval: 0, rotate: 18 } }),
      yAxis: [
        axisStyle({ type: "value", name: "点位", nameTextStyle: { color: C.ink3, fontSize: 10 } }),
        axisStyle({
          type: "value", name: "线东占比", min: 0.6, max: 0.85, nameTextStyle: { color: C.ink3, fontSize: 10 },
          axisLabel: { color: C.ink3, fontSize: 10, formatter: v => (v * 100).toFixed(0) + "%" },
          splitLine: { show: false }
        })
      ],
      series: [
        {
          name: "点位数", type: "bar", barWidth: "40%",
          itemStyle: { color: "#dcc4a4" }, data: order.map(b => bs[b].count)
        },
        {
          name: "胡焕庸线以东占比", type: "line", yAxisIndex: 1, smooth: true,
          symbol: "circle", symbolSize: 6, itemStyle: { color: C.cinnabar },
          lineStyle: { width: 2 }, data: order.map(b => +bs[b].east_share.toFixed(4)),
          label: { show: true, fontSize: 10, color: C.cinnabar, formatter: p => (p.value * 100).toFixed(1) + "%" }
        }
      ]
    });
  }

  function ellipseCoords(lng, lat, major, minor, angleDeg, n) {
    const pts = [];
    const k = Math.cos(lat * Math.PI / 180);
    const a = angleDeg * Math.PI / 180;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * Math.PI * 2;
      const x = (major / 2) * Math.cos(t), y = (minor / 2) * Math.sin(t);
      const xr = x * Math.cos(a) - y * Math.sin(a);
      const yr = x * Math.sin(a) + y * Math.cos(a);
      pts.push([lng + xr / (111.32 * k), lat + yr / 110.57]);
    }
    return pts;
  }

  function initCentroid() {
    charts.centroid = echarts.init($("#centroidMap"));
    const bs = STATE.data.batch_stats;
    const order = STATE.data.batch_order.filter(b => bs[b]);
    const colors = ["#a63a2f", "#b98a3c", "#245b63", "#3d8388", "#8a4f7d", "#6b7f3a"];
    const series = [];
    order.forEach((b, i) => {
      const s = bs[b];
      series.push({
        name: b, type: "lines", coordinateSystem: "geo", geoIndex: 0, zlevel: 4,
        polyline: true,
        data: [{ coords: ellipseCoords(s.lng, s.lat, s.major, s.minor, s.angle, 96) }],
        lineStyle: { color: colors[i % colors.length], width: 1.1, type: "dashed", opacity: .8 },
        silent: true
      });
      series.push({
        name: b, type: "scatter", coordinateSystem: "geo", geoIndex: 0, zlevel: 5,
        symbolSize: 8, data: [{ name: b, value: [s.lng, s.lat, s.count] }],
        itemStyle: { color: colors[i % colors.length], borderColor: "#fff", borderWidth: 1 },
        label: {
          show: b.indexOf("第一批") === 0 || b.indexOf("第五批") === 0,
          position: b.indexOf("第一批") === 0 ? "left" : "right", fontSize: 10,
          color: colors[i % colors.length], formatter: b.replace(" 20", " \u00b7 20")
        }
      });
    });
    series.push({
      name: "重心轨迹", type: "lines", coordinateSystem: "geo", geoIndex: 0, zlevel: 6,
      data: order.slice(1).map((b, i) => ({ coords: [[bs[order[i]].lng, bs[order[i]].lat], [bs[b].lng, bs[b].lat]] })),
      lineStyle: { color: C.ink, width: 1.4, opacity: .55, curveness: 0 },
      effect: { show: true, period: 4, trailLength: 0, symbol: "arrow", symbolSize: 5, color: C.ink },
      silent: true
    });
    charts.centroid.setOption({
      legend: {
        bottom: 4, left: "center", itemWidth: 10, itemHeight: 2, itemGap: 14,
        backgroundColor: "rgba(247,242,232,.9)", padding: [4, 8],
        textStyle: { fontSize: 10, color: C.ink3 }, data: order,
        formatter: name => name.indexOf("2018") === 0 ? "振兴" : name.slice(0, 3).replace("第", "")
      },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => {
          if (p.seriesType !== "scatter") return "";
          const s = bs[p.name];
          return `<b>${p.name}</b><br/>点位 ${fmt(s.count)}<br/>重心 ${s.lng.toFixed(2)}°E, ${s.lat.toFixed(2)}°N<br/>
            椭圆 ${s.major.toFixed(0)}×${s.minor.toFixed(0)} km<br/>线东占比 ${(s.east_share * 100).toFixed(1)}%`;
        }
      },
      geo: {
        map: "cnmap", roam: true, zoom: 2.5, center: [111.8, 32.4],
        scaleLimit: { min: 1, max: 10 },
        label: { show: true, color: "#9a8f7e", fontSize: 10 },
        itemStyle: { areaColor: "#f3ecdf", borderColor: "#cdbfa8", borderWidth: .7 },
        emphasis: { itemStyle: { areaColor: "#e6d4b8" }, label: { show: true, color: C.ink } }
      },
      series
    });
  }

  /* ================= 空间自相关 ================= */
  function initMoran() {
    charts.moran = echarts.init($("#moranScatter"));
    const L = STATE.data.lisa;
    const xs = L.map(d => d.z), ys = L.map(d => d.lag);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    const k = num / den, b = my - k * mx;
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    charts.moran.setOption({
      grid: { left: 52, right: 22, top: 22, bottom: 48 },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => {
          if (p.seriesName === "拟合" || p.seriesName.indexOf("象限") === 0) return "";
          const d = p.data.d;
          return `<b>${d.name}</b><br/>z = ${d.z.toFixed(2)}，空间滞后 = ${d.lag.toFixed(2)}<br/>
            局部 I = ${d.I.toFixed(3)}，p = ${d.p.toFixed(3)}<br/>类型 ${d.type} · 密度 ${d.density.toFixed(1)}`;
        }
      },
      xAxis: axisStyle({ type: "value", name: "标准化密度 z", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      yAxis: axisStyle({ type: "value", name: "空间滞后 Wz", nameLocation: "middle", nameGap: 40, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      series: [
        {
          name: "省级单元", type: "scatter",
          data: L.map(d => ({
            value: [d.z, d.lag], d,
            itemStyle: {
              color: d.p < 0.05 ? (d.type === "HH" ? C.cinnabar : d.type === "LL" ? C.teal : C.gold) : "#b9b2a6",
              borderColor: "#fff", borderWidth: .6
            },
            symbolSize: 4 + 12 * Math.min(1, d.density / 120)
          })),
          emphasis: { label: { show: true, formatter: p => p.data.d.name, fontSize: 10, color: C.ink } }
        },
        {
          name: "拟合", type: "line", symbol: "none", silent: true,
          data: [[xmin, k * xmin + b], [xmax, k * xmax + b]],
          lineStyle: { color: C.cinnabar, width: 1.4, type: "dashed" }
        },
        {
          name: "象限", type: "line", symbol: "none", silent: true,
          data: [[0, Math.min(...ys)], [0, Math.max(...ys)]], lineStyle: { color: C.line, width: 1 }
        },
        {
          name: "象限2", type: "line", symbol: "none", silent: true,
          data: [[Math.min(...xs), 0], [Math.max(...xs), 0]], lineStyle: { color: C.line, width: 1 }
        }
      ]
    });
  }

  function initLisa() {
    charts.lisa = echarts.init($("#lisaMap"));
    const L = STATE.data.lisa;
    const colors = { HH: "#a63a2f", LL: "#245b63", HL: "#b98a3c", LH: "#7fa6b8" };
    const data = L.map(d => ({
      name: d.name,
      value: d.p < 0.05 ? 1 : 0,
      itemStyle: { areaColor: d.p < 0.05 ? colors[d.type] : "#e8e0d2", opacity: 1 }
    }));
    charts.lisa.setOption({
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => {
          const d = L.find(x => x.name === p.name);
          if (!d) return p.name;
          const nm = { HH: "高—高集聚", LL: "低—低集聚", HL: "高—低离群", LH: "低—高离群" };
          return `<b>${d.name}</b><br/>类型 ${nm[d.type]}${d.p < 0.05 ? "（显著）" : "（不显著）"}<br/>局部 I = ${d.I.toFixed(3)}<br/>p = ${d.p.toFixed(3)}<br/>密度 ${d.density.toFixed(1)} 个/万km²`;
        }
      },
      series: [{
        type: "map", map: "cnmap", roam: true, zoom: 1.02,
        data: data,
        label: { show: false },
        itemStyle: { areaColor: "#e8e0d2", borderColor: "#f7f2e8", borderWidth: 0.7 },
        emphasis: {
          label: { show: true, fontSize: 10, color: "#fff" },
          itemStyle: { areaColor: "#1c232a" }
        }
      }]
    });
  }

  /* ================= 统计模型 ================= */
  function initTheil() {
    charts.theil = echarts.init($("#theilChart"));
    const t = STATE.data.summary.theil;
    const vals = [t.between, t.within];
    charts.theil.setOption({
      grid: { left: 42, right: 16, top: 28, bottom: 26 },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => `${p.name}<br/>T = ${p.value.toFixed(4)}（${(p.value / t.total * 100).toFixed(1)}%）`
      },
      xAxis: axisStyle({
        type: "category", data: ["组间差异", "组内差异"],
        axisLabel: { color: C.ink2, fontSize: 11, interval: 0 }, axisLine: { lineStyle: { color: C.line } }
      }),
      yAxis: axisStyle({
        type: "value", max: Math.max(0.02, t.within * 1.35),
        axisLabel: { formatter: v => v.toFixed(3), fontSize: 9 }, splitLine: { show: false }
      }),
      series: [{
        type: "bar", barWidth: "42%",
        data: [
          { value: t.between, itemStyle: { color: C.cinnabar } },
          { value: t.within, itemStyle: { color: "#cbb89b" } }
        ],
        label: {
          show: true, position: "top", fontSize: 10, color: C.ink2,
          formatter: p => (p.value / t.total * 100).toFixed(1) + "%"
        }
      }]
    });
  }

  function initZipf() {
    charts.zipf = echarts.init($("#zipfChart"));
    const d = STATE.data.cities.filter(c => c.count > 0);
    const pts = d.map((c, i) => [Math.log10(i + 1), Math.log10(c.count), c]);
    const n = pts.length;
    const sx = pts.reduce((a, p) => a + p[0], 0) / n, sy = pts.reduce((a, p) => a + p[1], 0) / n;
    let num = 0, den = 0;
    pts.forEach(p => { num += (p[0] - sx) * (p[1] - sy); den += (p[0] - sx) ** 2; });
    const k = num / den, b = sy - k * sx;
    charts.zipf.setOption({
      grid: { left: 52, right: 22, top: 22, bottom: 48 },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => p.seriesName === "拟合" ? `斜率 ${k.toFixed(2)}` :
          `<b>${p.data[2].name}</b><br/>位序 ${Math.round(Math.pow(10, p.value[0]))} · 点位 ${p.data[2].count}`
      },
      xAxis: axisStyle({ type: "value", name: "log₁₀ 位序", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      yAxis: axisStyle({ type: "value", name: "log₁₀ 点位数", nameLocation: "middle", nameGap: 40, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      series: [
        {
          name: "市域", type: "scatter", data: pts,
          symbolSize: 5, itemStyle: { color: C.teal, opacity: .75 }
        },
        {
          name: "拟合", type: "line", symbol: "none", data: [[0, b], [Math.log10(n), k * Math.log10(n) + b]],
          lineStyle: { color: C.cinnabar, width: 1.4, type: "dashed" }
        }
      ]
    });
  }

  function initLorenz() {
    charts.lorenz = echarts.init($("#lorenzChart"));
    const lc = STATE.data.lorenz_city, lp = STATE.data.lorenz_prov;
    charts.lorenz.setOption({
      grid: { left: 52, right: 26, top: 30, bottom: 48 },
      legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 10.5, color: C.ink3 } },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => `${p.seriesName}<br/>累积单元 ${(p.value[0] * 100).toFixed(0)}%<br/>累积点位 ${(p.value[1] * 100).toFixed(0)}%`
      },
      xAxis: axisStyle({
        type: "value", min: 0, max: 1, name: "累积单元占比", nameLocation: "middle", nameGap: 28,
        nameTextStyle: { color: C.ink3, fontSize: 11 }, axisLabel: { color: C.ink3, fontSize: 10, formatter: v => (v * 100) + "%" }
      }),
      yAxis: axisStyle({
        type: "value", min: 0, max: 1, name: "累积点位占比", nameLocation: "middle", nameGap: 40,
        nameTextStyle: { color: C.ink3, fontSize: 11 }, axisLabel: { color: C.ink3, fontSize: 10, formatter: v => (v * 100) + "%" }
      }),
      series: [
        {
          name: "绝对平均线", type: "line", symbol: "none", silent: true,
          data: [[0, 0], [1, 1]], lineStyle: { color: "#b9b2a6", width: 1, type: "dashed" }
        },
        {
          name: "市域（Gini " + STATE.data.summary.city_gini.toFixed(3) + "）",
          type: "line", symbol: "none", smooth: true,
          data: lc[0].map((x, i) => [x, lc[1][i]]),
          lineStyle: { color: C.cinnabar, width: 2 }, areaStyle: { color: "rgba(166,58,47,.08)" }
        },
        {
          name: "省级（Gini " + STATE.data.summary.prov_gini.toFixed(3) + "）",
          type: "line", symbol: "none", smooth: true,
          data: lp[0].map((x, i) => [x, lp[1][i]]),
          lineStyle: { color: C.teal, width: 2 }
        }
      ]
    });
  }

  function initNNI() {
    charts.nni = echarts.init($("#nniChart"));
    const d = Object.entries(STATE.data.nni_by_cat).filter(([k, v]) => v && v.n >= 5)
      .sort((a, b) => b[1].R - a[1].R);
    charts.nni.setOption({
      grid: { left: 132, right: 54, top: 16, bottom: 34 },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => {
          const v = d[p.dataIndex][1];
          return `<b>${d[p.dataIndex][0]}</b><br/>R = ${v.R.toFixed(2)}（n=${v.n}）<br/>
            平均最近邻 ${v.mean_d.toFixed(1)} km，期望 ${v.expected.toFixed(1)} km`;
        }
      },
      xAxis: axisStyle({ type: "value", name: "R = 观测/期望", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.ink3, fontSize: 11 }, max: 1.2 }),
      yAxis: axisStyle({ type: "category", data: d.map(x => x[0]), axisLine: { show: false }, axisLabel: { fontSize: 10, color: C.ink2 } }),
      series: [{
        type: "bar", barWidth: "56%",
        data: d.map(([k, v]) => ({
          value: +v.R.toFixed(3),
          itemStyle: { color: v.R < 0.8 ? C.cinnabar : v.R < 1 ? "#c98a5a" : C.teal }
        })),
        markLine: {
          symbol: "none", silent: true,
          data: [{ xAxis: 1, lineStyle: { color: C.ink3, type: "dashed" }, label: { formatter: "随机分布 R=1", fontSize: 9, color: C.ink3 } }]
        }
      }]
    });
  }

  function shortCat(n) {
    return n.replace("传统体育、游艺与杂技", "体育游艺").replace("传统", "")
      .replace("民间文学", "文学");
  }

  function initCA() {
    charts.ca = echarts.init($("#caChart"));
    const ca = STATE.data.ca;
    charts.ca.setOption({
      grid: { left: 52, right: 28, top: 34, bottom: 50 },
      legend: { top: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { fontSize: 10.5, color: C.ink3 } },
      tooltip: {
        backgroundColor: "rgba(28,35,42,.94)", borderWidth: 0, textStyle: { color: "#f7f2e8", fontSize: 12 },
        formatter: p => `<b>${p.name}</b><br/>点位 ${p.data.n}`
      },
      xAxis: axisStyle({ type: "value", name: `维度 1（${(ca.explained[0] * 100).toFixed(1)}%）`, nameLocation: "middle", nameGap: 30, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      yAxis: axisStyle({ type: "value", name: `维度 2（${(ca.explained[1] * 100).toFixed(1)}%）`, nameLocation: "middle", nameGap: 42, nameTextStyle: { color: C.ink3, fontSize: 11 } }),
      series: [
        {
          name: "省级单元", type: "scatter",
          data: ca.provinces.map(p => ({
            name: p.name, value: [p.x, p.y], n: p.count,
            symbolSize: 5 + 12 * Math.sqrt(p.count / 305),
            itemStyle: { color: C.teal, opacity: .78 }
          })),
          label: {
            show: true, formatter: p => p.data.n > 200 ? p.name : "", position: "right",
            fontSize: 9.5, color: C.ink2
          },
          labelLayout: { hideOverlap: true },
          emphasis: { label: { show: true } }
        },
        {
          name: "类别", type: "scatter",
          data: ca.categories.map(c => ({
            name: c.name, value: [c.x, c.y], n: c.count,
            symbolSize: 8 + 10 * Math.sqrt(c.count / 718),
            itemStyle: { color: catColor(c.name) }
          })),
          label: { show: true, formatter: p => shortCat(p.name), position: "right", fontSize: 9.5, color: C.ink2 },
          labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
          emphasis: { label: { show: true } }
        }
      ]
    });
  }

  /* ================= 表格 ================= */
  function initTable() {
    const provSel = $("#tblProv"), catSel = $("#tblCat");
    const provs = Array.from(new Set(STATE.points.map(p => p[F.PROV]))).sort();
    const cats = STATE.data.categories.map(c => c.name);
    provSel.innerHTML = `<option value="all">全部省级</option>` + provs.map(p => `<option>${p}</option>`).join("");
    catSel.innerHTML = `<option value="all">全部类别</option>` + cats.map(c => `<option>${c}</option>`).join("");
    provSel.onchange = () => { STATE.tblProv = provSel.value; STATE.page = 1; renderTable(); };
    catSel.onchange = () => { STATE.tblCat = catSel.value; STATE.page = 1; renderTable(); };
    let timer = null;
    $("#tblSearch").oninput = e => {
      clearTimeout(timer);
      timer = setTimeout(() => { STATE.q = e.target.value.trim(); STATE.page = 1; renderTable(); }, 200);
    };
    $("#tblPrev").onclick = () => { if (STATE.page > 1) { STATE.page--; renderTable(); } };
    $("#tblNext").onclick = () => { STATE.page++; renderTable(); };
    renderTable();
  }

  function tableRows() {
    const q = STATE.q;
    return STATE.points.filter(p =>
      (STATE.tblProv === "all" || p[F.PROV] === STATE.tblProv) &&
      (STATE.tblCat === "all" || p[F.CAT] === STATE.tblCat) &&
      (!q || p[F.NAME].indexOf(q) >= 0 || (p[F.RAW] || "").indexOf(q) >= 0 || (p[F.COUNTY] || "").indexOf(q) >= 0)
    );
  }

  function renderTable() {
    const rows = tableRows();
    const ps = STATE.pageSize;
    const pages = Math.max(1, Math.ceil(rows.length / ps));
    if (STATE.page > pages) STATE.page = pages;
    const start = (STATE.page - 1) * ps;
    const slice = rows.slice(start, start + ps);
    $("#tblBody").innerHTML = slice.map(p => `
      <tr>
        <td class="num">${p[F.SEQ]}</td>
        <td><a href="${p[F.LINK]}" target="_blank" rel="noopener">${p[F.NAME]}</a></td>
        <td>${p[F.CAT]}</td>
        <td>${p[F.BATCH]}</td>
        <td>${p[F.PROV]} ${p[F.CITY] || ""} ${p[F.COUNTY] || ""}</td>
        <td class="num">${p[F.PREC]}</td>
        <td class="num">${p[F.LNG].toFixed(3)}, ${p[F.LAT].toFixed(3)}</td>
      </tr>`).join("");
    $("#tblCount").textContent = `${fmt(rows.length)} 条`;
    $("#tblPage").textContent = `${STATE.page} / ${pages}`;
    $("#tblPrev").disabled = STATE.page <= 1;
    $("#tblNext").disabled = STATE.page >= pages;
  }

  /* ================= 结论文字 ================= */
  function insightText() {
    const s = STATE.data.summary;
    const top = STATE.data.provinces[0];
    const c = STATE.data.categories[0];
    const a = $("#insightA");
    if (a) a.innerHTML = `
      <b>${top.name}</b>以 ${fmt(top.count)} 个点位居首，其后为
      ${STATE.data.provinces.slice(1, 4).map(p => p.name).join("、")}；
      省域 Gini 仅 ${s.prov_gini.toFixed(2)}，而市域 Gini 达 ${s.city_gini.toFixed(2)} ——
      不平等主要发生在<strong>省内</strong>，而非省际。`;
    const b = $("#insightB");
    if (b) b.innerHTML = `
      <b>${c.name}</b>是体量最大的类别（${fmt(c.count)} 个点位，覆盖 ${c.n_prov} 个省级单元）。
      各类别 CR3 平均为 ${(s.cr3_mean * 100).toFixed(0)}%，说明多数类别已形成跨省分布，
      但仍有 ${STATE.data.categories.filter(x => STATE.data.cr3[x.name] > 0.3).length} 个类别高度依赖少数省份。`;

    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("statGini", s.city_gini.toFixed(2));
    set("statTheil", s.theil.total.toFixed(3));
    set("statCR3", (s.cr3_mean * 100).toFixed(0) + "%");
    set("nniR", s.nni_all.R.toFixed(2));
    set("nniZ", s.nni_all.z.toFixed(1));
    set("moranI", s.moran_density.toFixed(3));
    set("moranP", s.moran_p.toFixed(3));
  }

  window.addEventListener("DOMContentLoaded", () => {
    boot().then(() => {
      insightText();
      $("#dataNote").textContent = `当前 ${fmt(STATE.points.length)} 个点位、${fmt(STATE.data.summary.records)} 条申报记录；可按省级、类别与关键词筛选，完整数据见页脚下载。`;
    }).catch(err => {
      console.error(err);
      const box = document.getElementById("loadError");
      box.style.display = "block";
      const pre = document.createElement("pre");
      pre.style.cssText = "text-align:left;max-width:900px;margin:20px auto;font-size:12px;color:#a63a2f;white-space:pre-wrap";
      pre.textContent = String(err && (err.stack || err.message) || err);
      box.appendChild(pre);
    });
  });
})();
