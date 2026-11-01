# RoutePilot 0.2.24-4（测试版）

面向 ARM64 OpenWrt 24.10 的路由器分流插件；现场验证机 GL.iNet GL-MT6000。包含官方 WARP 主线路管理、账户虚拟网络目录、设备 / LAN 分流、IPv6 选择、DNS / 联网检测、流量观测及手动启用的 Workers 备用。不是固件，也不是 Cloudflare 官方产品。

本版补齐 Workers 每一步的等待 / 进度 / 成功 / 失败反馈，顶部显示最近操作结果和实际保存的节点 / 本机云端创建记录；不会因展示结果而自动启用备用。

## 源码构建

`python3 packages/luci-app-routepilot/tools/asset_versions.py --check`

`python3 packages/luci-app-routepilot/tools/build.py`

构建输出在该包的 `dist`。完整首次安装还需要单独准备未注册的 ARM64 运行环境，以及目标固件自己的匹配依赖；此公开源码包不分发 Cloudflare 客户端 / Debian 运行环境，也不包含私人设置或注册身份。

## 安装与使用

参见 [安装说明](packages/luci-app-routepilot/INSTALL.zh-CN.md) 和 [Workers 设置](docs/WORKERS_SETUP.md)。首次安装默认关闭；自己的账户必须重新授权。已有设备更新保留注册和设置，但普通 opkg 升级可能短暂重连。Workers 必须明确保存、独立检测和手动启用，仅支持 IPv4 TCP。

## 验证范围

本版本地 202 项 Python 回归、6 套 JavaScript 及目标 LuCI 契约检查；现有目标机核对 36 项程序文件。本次 Workers 功能现场检查仅核对部署记录 / HTTPS，没有重复创建云端资源、应用新候选或启用备用。其他机型、完整全新设备安装、长期性能、独立 WireGuard 真机验收不在本次通过范围。

## 许可与公开发布

RoutePilot 自有代码遵循 MIT；`root/usr/share/routepilot/workers/` 内上游衍生代码遵循 GPL-2.0，保留完整来源、许可证和相应源码。参见 [第三方说明](THIRD_PARTY_NOTICES.txt)。第三方客户端和服务按各自条款授权，不因本项目 MIT 许可而获得其再分发许可。

此版本按 GitHub 预发布版提供。公开仓库和发布附件仅包含脱敏源码、插件 IPK 与校验值；不提供 Cloudflare 客户端或完整运行环境，不包含任何私人备份、令牌、注册身份或设备配置。

## 本地回归

在仓库根目录执行：

```sh
python3 -m unittest discover -s packages/luci-app-routepilot/tests -p 'test_*.py'
for suite in packages/luci-app-routepilot/tests/test_*.cjs; do node "$suite" || exit 1; done
```

Python 与 Node.js 使用标准库即可。`check_luci_module_contract.cjs` 另需提供目标设备的 LuCI 核心文件，不能用本地桩代替真机 ABI 验收。
