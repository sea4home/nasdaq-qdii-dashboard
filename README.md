# 纳斯达克 QDII 基金看板

用于查看纳斯达克 QDII 基金溢价率、场外基金申购状态、美国科技股收益，以及纳斯达克指数回撤后的历史收益。

线上地址：<https://nasdaq-qdii-dashboard.sea4home.chatgpt.site/>

GitHub 仓库：<https://github.com/sea4home/nasdaq-qdii-dashboard>

## GitHub Actions 与 Pages

- GitHub Actions workflow：`Prewarm Sites data`，配置文件位于 `.github/workflows/prewarm.yml`。
- 当前状态：仍在工作。最近一次定时运行成功，run id 为 `35036917305`，运行时间为 2026-09-15 23:43:15 UTC。
- 作用范围：定时请求线上 Sites API，提前生成 dashboard 和 Nasdaq 回测缓存；它不是 GitHub Pages 部署 workflow。
- GitHub Pages：当前未启用。GitHub Pages API 返回 `404 Not Found`，`https://sea4home.github.io/nasdaq-qdii-dashboard/` 当前也返回 404。
- 当前可访问页面仍以 OpenAI Sites 为准：<https://nasdaq-qdii-dashboard.sea4home.chatgpt.site/>

## 数据更新

- 北京时间 05:50、11:50、17:50 由 GitHub Actions 提前生成下一时段缓存。
- 页面在 06:00、12:00、18:00 后直接读取对应缓存。
- Nasdaq 指数历史日线每天更新一次，并供不同回测参数重复使用。
- 定时更新失败时，线上站点继续使用上一次成功数据。
- 也可以在 Actions 页面手动运行 `Prewarm Sites data`。

## 本地开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run test:cache-slots
npm run test:backtest
npm run build
```
