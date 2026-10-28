# 随记原生小程序工程

使用方式见 [仓库首页](../README.md)。原项目的个人体验版本为 1.0.4，未公开发布；这里提供泛化配置的源码。

`project.config.json`、`utils/release.js` 与服务端 AppID 为 `YOUR_WECHAT_APPID`；`utils/cloud-config.js` 保留 `YOUR_CLOUD_ENV_ID` 配置模板并将其解释为“未配置”。`project.config.example.json` 使用游客标识 `touristappid`，可用于本地页面预览。

示例账本由 `utils/ledger.js` 的 `seed(true)` 生成，带 `demo` 标志与 `demo-*` 编号。个人账本默认空白，演示账本不上传；示例金额不是任何人的实际账目。

从本目录执行：

```sh
node scripts/prepare-cloud.js --check
node --test tests/*.test.js
```

本机先保存、恢复点、云快照和版本冲突是不同机制。云端服务需部署到使用者自己的环境；本地测试通过不证明任何真实云环境、双设备或公开发布已经验收。
