# 山河入谱 · 国家级非物质文化遗产的空间图谱

把一份**没有坐标**的名录（4234 条国家级非遗代表性项目）还原成可交互的地图：
逐条解析「申报地区或单位」→ 挂接行政区划驻地坐标 → 几何校验 → 空间统计建模 → 网页可视化。

> 纯静态站点，无需后端、无需构建，可直接部署到 GitHub Pages。

---

## 1. 本地预览

```bash
# 在项目根目录
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

Windows 下也可直接双击 `start.bat`。

> 不能直接双击 `index.html`：浏览器会以 `file://` 协议拦截 `fetch()` 读取 JSON。

## 2. 页面结构

| 板块 | 内容 |
|---|---|
| 01 地图 | 省域分级 / 核密度 / 点位 / 城市气泡 四种图层，可按数据集、类别、批次、定位精度筛选，点击省份联动详情 |
| 02 省域 | 省级排行、密度、类别多样性、Gini |
| 03 类别 | 24 个类别规模、区位商 LQ 热力图、CR3 集中度 |
| 04 时间 | 批次×类别堆叠、胡焕庸线以东占比、重心迁移与 2σ 标准差椭圆 |
| 05 建模 | 最近邻指数 NNI、Moran's I 与 LISA、Theil 分解、Zipf 位序规模、洛伦兹曲线 |
| 06 对应 | 省份×类别的对应分析（CA）二维投影 |
| 07 数据 | 可检索数据表 + CSV / Excel 下载 |
| 08 方法 | 四步地理编码流程、质量校验、已知局限 |

## 3. 数据与质量

| 指标 | 数值 |
|---|---|
| 申报记录 | 4234 条（五批国家级名录 3851 + 2018 传统工艺振兴目录 383） |
| 地理点位 | 4341 个（一条记录可对应多个申报地区） |
| 不重复驻地 | 1538 个 |
| 定位精度 | 县级 2687 / 市级 1264 / 省级 390 |
| 省界几何校验 | 4341 个点位，**0 个越界** |
| 行政区划码交叉校验 | 221 条不一致，其中 200 条为区划调整旧码、12 条为扩展项目主项目地、8 条为上级码 |

**方法要点**

1. 以「，、；」切分申报地区，最长前缀匹配省—市—县；1909 种写法建立别名表。
2. 历史地名映射（崇文区→东城区、潞西市→芒市、盘县→盘州市等），中央机构按实际驻地人工标注。
3. 坐标来源：阿里云 DataV 行政区划（省/市/县 `center`），共 3237 个单元。
4. 校验：项目序号末 6 位行政区划码独立比对 + 点位是否落在所属省多边形内。

**已知局限**（页面「08 方法」有完整说明）

- 点位是行政区划驻地，不等于遗产实际所在村落；
- 跨省共享项目（如格萨（斯）尔 8 省区）在点位口径下重复计数；
- 省级精度点位向省会聚集，可能轻微抬高省会首位度；
- 383 条振兴目录项目的类别按 14 类工艺编码回填，与非遗十大门类不属同一体系。

## 4. 目录

```
├── index.html                    单页站点
├── assets/
│   ├── style.css
│   ├── app.js                    ECharts 渲染与交互
│   └── echarts.min.js            Apache ECharts 5.5.1（本地化，离线可用）
├── data/
│   ├── app_data.json             汇总指标、省/市/类别统计、LISA、CA、KDE
│   ├── map_points.json           4341 个点位的紧凑数组
│   ├── points.csv                点位明细（UTF-8 BOM）
│   ├── projects.csv              项目主表
│   ├── qa_report.json            地理编码质量报告
│   └── geo/
│       ├── admin_units.json      3237 个省/市/县单元（含驻地坐标）
│       ├── china_provinces.json  省级边界 GeoJSON（0.001°）
│       ├── places2.json          逐片段解析结果
│       └── review.csv            221 条待复核记录
├── scripts/
│   ├── 01_crawl_admin.py         抓取行政区划
│   ├── 02_geocode.py             解析 + 挂接坐标
│   ├── 03_build.py               合并、几何校验、导出 CSV
│   ├── 04_analysis.py            空间统计与建模
│   └── 05_export.py              网页数据 + Excel 数据集
├── 国家级非遗空间数据集.xlsx       11 个工作表的完整数据
├── start.bat / start.sh          本地预览
└── .github/workflows/pages.yml   推送到 GitHub 后自动发布 Pages
```

## 5. 部署到 GitHub Pages

**方式 A：Actions 自动发布（推荐，仓库里已带工作流）**

```bash
git init
git add .
git commit -m "feat: 国家级非遗空间图谱"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

推完后进入仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

**方式 B：从分支直接发布**

Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`，保存即可。

> 仓库名建议用英文（如 `feiyi-spatial`），Pages 链接更干净。
> 若仓库名是中文，链接会被百分号编码，仍可访问。

## 6. 复现数据处理

```bash
pip install openpyxl numpy
python scripts/01_crawl_admin.py    # 需联网，约 380 次请求
python scripts/02_geocode.py
python scripts/03_build.py
python scripts/04_analysis.py
python scripts/05_export.py
```

原始表放在脚本顶部 `SRC` 变量指向的路径，按需修改。

## 7. 说明

- 原始名录版权归**中国非物质文化遗产网**（ihchina.cn）所有，本项目仅作研究与教学用途。
- 行政区划边界来自阿里云 DataV，仅供示意，不作为国界依据。
- 页面代码 MIT License；数据整理结果 CC BY-NC 4.0。
