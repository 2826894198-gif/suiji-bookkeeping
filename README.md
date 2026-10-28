# 随记 · 个人记账与预算管理

**一笔记账，联动预算、账户和消费趋势；账本有版本，误操作能恢复。**

原生微信小程序，包含收支、周期预算、父子账户、分类、统计与本机备份。云端采用可信微信身份、分片校验、版本化快照与冲突保留；更新前创建恢复点。

原项目 1.0.4 已供个人体验，尚未公开发布。本仓库是经过配置泛化的公开源码示例，不连接原用户的账本或云环境。

## 快速开始

需要 Node.js；原生预览需要微信开发者工具。以下命令从仓库根目录执行一次：

```sh
cd miniprogram-next
cp project.config.example.json project.config.json
node scripts/prepare-cloud.js --check
node --test tests/*.test.js
```

在微信开发者工具导入当前 `miniprogram-next/` 目录，使用原生小程序模式。示例配置使用 `touristappid`，供本地页面预览；云服务默认未配置。游客模式的平台限制不代表云端可用。

需要自己的云端时，先申请自己的 AppID/云环境，再在私人工作副本填写 `project.config.json`、`utils/release.js`、`utils/cloud-config.js` 与 `cloudfunctions/pearlLedgerSync/service.js` 中的占位值。服务端须继续核验可信 AppID/OPENID，数据库只允许管理端读写。不要提交私人配置或账本。

云函数依赖可单独准备，以下命令同样从仓库根执行：

```sh
npm --prefix miniprogram-next/cloudfunctions/pearlLedgerSync ci --ignore-scripts
```

## 演示数据与实现

全新安装建立空白个人账本。“设置”中的演示账本由 `utils/ledger.js` 的 `seed(true)` 在代码中构造，使用固定日期、`demo-*` 编号与通用账户，没有导入真实账目。演示账本不会上传云端。

- `miniprogram-next/pages/`：记账、预算、账户、分类与统计页面。
- `miniprogram-next/utils/ledger.js`：整数分金额、回款约束、持久化与恢复。
- `miniprogram-next/utils/cloud-sync.js`：版本同步和冲突处理。
- `miniprogram-next/cloudfunctions/pearlLedgerSync/`：身份与云端快照服务。
- `miniprogram-next/tests/`：离线业务与交互测试。

未接入语音、图片记账、银行流水或真实资金转移；复杂多设备与真机平台行为仍需另行验收。截图、二维码、原用户账本和实际云访问标识不随本仓库分发。

更多见 [仓库状态](docs/REPOSITORY_STATUS.md)、[安全说明](SECURITY.md) 与 [资源说明](RIGHTS.md)。
