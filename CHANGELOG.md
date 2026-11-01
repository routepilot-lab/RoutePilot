# RoutePilot v0.2.24-4（预发布 / 测试版）

本版为 ARM64 OpenWrt 24.10 路由器上的 RoutePilot 插件；现场验证机为 GL.iNet GL-MT6000。不是固件，也不是 Cloudflare 官方产品。

## 本版变化

- Workers 部署、域名绑定、PROXYIP、入口优选、独立检测分别显示等待、进度及成功 / 失败结果。
- 展示当前已保存的备用节点与本机云端部署记录，区分创建、保存及启用。
- 操作结果在自动展开下一步后仍保留；过期检测不会被当成当前可用证据。
- 保留 WARP 主线路、账户出口、设备 / LAN 分流、IPv6 选择、DNS 与流量观测。

## 附件与安装边界

- `luci-app-routepilot_0.2.24-4_all.ipk`：插件安装包，适用于已经具备兼容运行环境的设备更新。
- `routepilot-0.2.24-4-public-source.zip`：与公开仓库对应的脱敏源码，包括 Worker 相应源码及许可。
- `SHA256SUMS`：以上两个附件的 SHA-256 校验值。

公开版不含 Cloudflare 客户端 / Debian 运行环境、注册身份、API 令牌、私人节点或个人路由器配置。全新安装须另行合法准备运行环境及当前固件匹配的依赖，不能把此 IPK 当作完整固件或完整离线安装包。已有设备先备份，在维护窗口更新；普通 opkg 升级可能短暂重连。安装说明在源码包 `packages/luci-app-routepilot/INSTALL.zh-CN.md`。

## 验证与限制

版本实现已完成本地 202 项 Python 回归、6 套 JavaScript 和目标 LuCI 契约检查；既有目标机核对 36 项程序文件并进行正常联网核验。公开源码准备时另行执行本地回归与可重复构建检查，结果记录在 `docs/PUBLICATION_CHECKS.json`。

以上不是长期稳定性、所有路由器、新设备完整安装或 WireGuard 真机验收。Workers 备用只支持 IPv4 TCP，需要独立检测与手动启用，不自动接管主线路。优选 IP 的短测结果不代表全网最优或保证带宽，也不保证固定国家出口。

## 许可

RoutePilot 自有代码为 MIT；内置 cmliu/edgetunnel 衍生 Worker 为 GPL-2.0，完整来源、许可和相应源码一并保留。第三方 Cloudflare 服务及客户端按各自条款使用。
