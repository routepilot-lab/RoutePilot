# 新服务器接入向导（预览版）

已有阿里云美国节点：**不用运行本向导，不用重装服务器**。在路由器 RoutePilot 网页粘贴原有 `vless://` 链接，保存连接，再给需要的设备选择它即可。导入本身不会切换设备出口。

本目录用于一台**新建的 Debian/Ubuntu Linux amd64 或 arm64 服务器**。向导创建独立 Xray WebSocket 后端及独立 Cloudflare Tunnel 连接器，不修改已有 Xray、cloudflared、系统默认路由或防火墙。它需要 Python 3、systemd 247 及以上，不能直接在 OpenWrt 路由器上运行。

这不是无人值守的全自动安装：Cloudflare 创建专用隧道、取得 token 和添加域名路由，需要在自己的 Cloudflare 网页完成。尚未进行真实新服务器的安装和公网连接验收；本目录已验证演练输出和保护逻辑。

## 第一步：准备域名与一条专用隧道

1. 登录自己的 Cloudflare 账户，确认自己的域名已托管。
2. 在 Tunnel 管理里**新建专用的 cloudflared 隧道**，例如 `routepilot-new-server`。不要复用正在承载旧节点的隧道。
3. 选择 Linux 连接器安装页，找到安装命令中的长 token。只复制 token，不执行安装页的命令。稍后向导会以隐藏输入方式询问它。
4. 准备一个未占用的子域名，例如 `node.example.com`。暂不创建指向服务器公网 IP 的 A 记录，也不要修改旧节点的域名。

## 第二步：准备官方程序文件

向导**不会下载或执行网络脚本**。先从以下官方发布页取得与新服务器架构对应的文件：

- [XTLS/Xray-core 官方发布](https://github.com/XTLS/Xray-core/releases)：固定版本 **v26.10.29**。amd64 选择 Linux 64 位包，arm64 选择 Linux ARM64 包；解压后取出 `xray`。
- [Cloudflare cloudflared 官方发布](https://github.com/cloudflare/cloudflared/releases)：固定版本 **2026.10.6**。选择 `cloudflared-linux-amd64` 或 `cloudflared-linux-arm64` 二进制文件。

先按官方发布页提供的校验值核验下载包或二进制。如果官方校验的是压缩包，先验证压缩包，验证成功后才解压；再计算解压后 `xray` 的 SHA-256，作为向导参数。不能把压缩包的 SHA-256 填成二进制的 SHA-256。没有可信校验值时先停下，不要跳过校验。

把本目录 `install.py`、`uninstall.py` 和两个程序文件传到新服务器，例如自己的工作目录。服务器上运行下面命令查看文件校验值：

```sh
sha256sum ./xray ./cloudflared
```

这条命令只证明文件内容的指纹；**自行计算的指纹不能代替与官方发布校验值的比对**。正式安装还会执行程序的版本查询并核对固定版本。

## 第三步：先演练，再安装

可以先生成演练文件，检查输出；演练不会执行两个程序，不会调用 systemctl，不会触碰旧服务或防火墙：

```sh
python3 install.py \
  --xray ./xray --xray-sha256 '填入已核验的解压后二进制SHA256' \
  --cloudflared ./cloudflared --cloudflared-sha256 '填入已核验的二进制SHA256' \
  --dry-run ./routepilot-preview
```

根据提示输入完整子域名和 Tunnel token。token 输入时不显示；不要把它写到命令行、聊天或公开截图。演练目录必须不存在，向导不会覆盖文件。演练目录里的 token 和节点链接都属于私人凭证，用完后自行删除。

正式安装同样运行，但去掉最后的 `--dry-run` 参数，并使用 root 权限：

```sh
sudo python3 install.py \
  --xray ./xray --xray-sha256 '填入已核验的解压后二进制SHA256' \
  --cloudflared ./cloudflared --cloudflared-sha256 '填入已核验的二进制SHA256'
```

向导先检查系统、校验值、版本及端口，展示安装摘要。只有输入 `INSTALL` 才会创建：

- `/opt/routepilot-server/`：独立程序、配置和凭证；凭证权限为 `0600`。
- `routepilot-server.service`：只监听 **127.0.0.1:18082** 的 VLESS WebSocket 后端。
- `routepilot-cloudflared.service`：专用隧道连接器。token 通过 systemd 凭证文件传递，不出现在启动命令参数中。

同名目录、同名服务或端口已占用时会停止，绝不覆盖旧安装。安装不开放任何入站端口，也不会关闭防火墙；服务器原有出站网络必须允许 Cloudflare Tunnel 连接。

## 第四步：在 Cloudflare 绑定这个节点

回到**刚新建的专用隧道**，确认连接器在线，然后添加 Published application route（公开应用路由）：

| 设置 | 填写 |
| --- | --- |
| Hostname | 向导输入的完整子域名，例如 `node.example.com` |
| Service 类型 | `HTTP` |
| Service 地址 | `127.0.0.1:18082` |
| 路径匹配条件 | 留空 |

外部 TLS 由 Cloudflare 提供，Xray 后端只在本机回环地址收流量，所以此处填写 **HTTP**。不要改成 HTTPS，不要加入 Cloudflare Access 登录验证，否则普通 VLESS 客户端无法通过网页登录。

向导随机生成的 WebSocket 路径已经写入 Xray 和节点链接，不需要在 Tunnel 的路径匹配栏再填一遍。这个子域名仅用于自己的代理节点，不要与已有网站路由共用。

## 第五步：加进路由器

1. 安装结束会显示一个 `vless://` 链接，也保存在服务器 `/opt/routepilot-server/client-link.txt`。该链接包含私人凭证，不要公开。
2. 在 RoutePilot 网页选择导入 VLESS 链接。导入后连接默认不启用，先检查地址、TLS 域名和 WebSocket 路径。
3. 启用这个连接，再添加一条**指定测试设备**的策略，选择连接及所需分流模式。
4. 保存并应用。未选中的设备、旧 SSR 节点和旧分流不应改变。如果插件提示与旧服务冲突，先停在提示处，不能直接关闭或重置整个旧配置。

服务显示 active 只说明进程启动，不等于公网节点已通过测试。Cloudflare 隧道在线、域名路由、节点凭证、路由器设备策略均需对应正确。

## 查看状态与卸载

只查看本向导的服务：

```sh
systemctl status routepilot-server.service routepilot-cloudflared.service
journalctl -u routepilot-server.service -u routepilot-cloudflared.service --since '10 minutes ago'
```

日志或截图仍可能含网络标识，分享前请检查。向导不打印 token，但节点链接会显示一次，以便导入。

卸载运行：

```sh
sudo python3 uninstall.py
```

确认输入 `REMOVE` 后，只停用这两个专用服务并移除已知文件。服务文件已被修改时拒绝自动卸载；目录里的未知文件和符号链接会保留。它不会删除 Cloudflare 网页里的隧道或域名路由，不再使用时请自己删除对应专用隧道及域名路由。
