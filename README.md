# 纳斯达克 QDII 基金看板

用于查看纳斯达克 QDII 基金溢价率、场外基金申购状态、美国科技股收益，以及纳斯达克指数回撤后的历史收益。

线上地址：<https://nasdaq-qdii-dashboard.sea4home.chatgpt.site/>

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
