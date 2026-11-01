# RoutePilot 0.2.32-2（测试版）

面向 ARM64 OpenWrt 24.10 的独立 WARP 主线路、设备 / LAN 分流及手动 Workers 备用插件。现场验证机为 GL.iNet GL-MT6000；不是固件，也不是 Cloudflare 官方产品。当前版本进入日常稳定性观察期，不将短期通过当作长期稳定保证。

## 本版变化

- Cloudflare 中心分为账户与协议、出口与分流、设备、DNS、Workers 五个独立页面，只读取本页数据；目录和协议异步加载。
- 删除按出口名称推测地区的筛选，保留直接选出口与实际出口地区检测。
- 主线路入口支持官方自动、固定候选、手写 IPv4；候选定期读取不自动换入口。应用时验证原链路，失败尝试恢复，无法确认则阻断并提供受控恢复。
- 修复并发敏感请求的领取隔离、同步间隔独立保存、离线请求等待基线、LuCI 徽章显示；清理废弃页面分支与资源。

## 构建与检查

```sh
python3 packages/luci-app-routepilot/tools/asset_versions.py --check
python3 packages/luci-app-routepilot/tools/build.py
python3 packages/luci-app-routepilot/tools/check_all.py --luci-core /path/to/target/luci.js --report .local/check-all/report.json
```

Makefile 为版本唯一来源。测试仅需 Python/Node 标准库；完整检查另需自行从目标设备取得 LuCI 核心文件，不分发设备文件，也不用替身冒充真实 ABI。

## 安装和使用

下载 Releases 中的 IPK、公开源码包及 SHA256SUMS。IPK 用于已有兼容运行环境的设备升级，**不是完整首次安装包**，不含 Cloudflare 客户端、Debian 运行环境、登录身份、API 令牌或私人配置。全新设备须另行合法准备未注册运行环境和固件匹配依赖。

已有设备先备份，在维护窗口通过 `opkg install ./luci-app-routepilot_0.2.32-2_all.ipk` 升级插件；保留运行环境与注册信息，升级会短暂重连。首次安装默认关闭，自己的账户需独立授权。参见[使用说明](packages/luci-app-routepilot/README.zh-CN.md)、[安装说明](packages/luci-app-routepilot/INSTALL.zh-CN.md)、[Workers 设置](docs/WORKERS_SETUP.md)。

## 已验证与边界

331 项 Python、7 组 JavaScript、目标 LuCI 契约、资源和权限校验及可重复构建通过；现有目标机程序文件一致、配置身份入口出口保持、连续运行状态及代理/直连 HTTPS 检查通过，Safari 已检查五页。Opus 提供静态独立审查，不代表它执行设备测试。

长期稳定性、手机速度、其他机型、全新设备安装、WireGuard 切换、多 LAN 真实设备及入口故障注入未在本轮验收。Workers 只支持 IPv4 TCP，需独立检测和手动启用，不自动切换主备用。链路故障撤回接管可能允许宽带直连；不能把配置未变当成运行态没有变化。

## 许可

RoutePilot 自有代码为 MIT，内置 cmliu/edgetunnel 衍生 Worker 为 GPL-2.0，保留对应源码、许可及来源。第三方客户端和服务按各自条款使用。参见[第三方说明](THIRD_PARTY_NOTICES.txt)。
