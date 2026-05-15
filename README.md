# Paper Tracker

一个可部署到 GitHub Pages 的静态论文日报站。GitHub Actions 每天按主题分类抓取近五年论文，只保留命中顶会/高质量期刊白名单的结果，生成静态 JSON 数据，页面公网可访问并支持站内搜索、筛选、排序和 GitHub 开源状态展示。

## 功能

- 静态公网访问：构建产物输出到 `out/`，可直接部署到 GitHub Pages。
- 每日自动更新：`.github/workflows/deploy-pages.yml` 每天运行，也支持手动触发。
- 多来源聚合：arXiv、OpenReview、Semantic Scholar、Papers with Code、DBLP、ACL Anthology、ACM Crossref 元数据入口。
- IEEE Xplore 支持：配置仓库 secret `IEEE_API_KEY` 后启用。
- 开源识别：优先 Papers with Code，再用 GitHub Search 做保守匹配。
- 页面筛选：搜索、来源、会议/期刊、主题、近五年时间窗口、开源状态、发布时间升降序。

## 环境

项目使用 Node.js `v22.22.3` 和 npm `10.x`：

```bash
nvm use
npm install
```

## 配置主题分类

编辑 `config/keywords.json`：

```json
{
  "topics": [
    {
      "name": "3D Vision",
      "description": "Point clouds, LiDAR, 3D perception, segmentation, detection, reconstruction.",
      "terms": ["point cloud", "LiDAR", "3D perception", "3D segmentation", "3D detection"],
      "excludeTerms": ["powerpoint", "power point"]
    }
  ]
}
```

每个主题可以配置多个 `terms` 来扩大召回，并用 `excludeTerms` 排除明显误匹配。GitHub Actions 每天按这些主题生成全站公共论文数据。

## 配置顶会/顶刊白名单

编辑 `config/venues.json`：

```json
{
  "topConferences": [
    { "name": "CVPR", "aliases": ["CVPR", "Computer Vision and Pattern Recognition"] }
  ],
  "topJournals": [
    { "name": "TPAMI", "aliases": ["TPAMI", "IEEE Trans. Pattern Anal. Mach. Intell."] }
  ]
}
```

生成脚本只保留 `venue` 命中这些别名的论文。第一版用手工白名单维护 SCI 1 区/顶刊；如果后续有 JCR 或中科院分区表，可以再换成文件驱动判断。

## 本地生成和预览

生成静态论文数据：

```bash
npm run generate:data
```

启动本地预览：

```bash
npm run dev
```

打开 `http://localhost:3000`。

构建 GitHub Pages 静态输出：

```bash
npm run build
```

生成结果在 `out/`。

## GitHub Pages 部署

1. 将项目推到 GitHub 仓库。
2. 在仓库 `Settings -> Pages` 中选择 `GitHub Actions` 作为部署来源。
3. 如果需要 IEEE 数据，在 `Settings -> Secrets and variables -> Actions` 中添加 `IEEE_API_KEY`。
4. 推送到 `main` 分支，或在 Actions 页面手动运行 `Deploy GitHub Pages`。

Workflow 会自动：

- 安装 Node 22 和依赖。
- 读取 `config/keywords.json` 中的主题分类。
- 读取 `config/venues.json` 中的顶会/顶刊白名单。
- 抓取近五年论文并写入 `public/data/papers.json`。
- 静态构建 Next.js。
- 部署 `out/` 到 GitHub Pages。

## 开源状态

- `confirmed`：Papers with Code 或 GitHub 结果高度匹配。
- `possible`：存在相关仓库线索，但匹配不够强。
- `none`：暂未发现开源实现。

## 限制

GitHub Pages 不能运行后端 API，也不能安全保存网页端全局配置。本项目的主题分类和高质量 venue 白名单需要通过 `config/keywords.json`、`config/venues.json` 修改并提交。如果以后需要“网页修改主题并同步到所有设备”，需要外接后端和数据库，或改用 Vercel/Railway/VPS 这类动态部署。