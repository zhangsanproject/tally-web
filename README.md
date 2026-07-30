# BeanFlux 极速记账系统

BeanFlux 是一个基于 Cloudflare Worker + GitHub + Beancount 的轻量级、无服务器（Serverless）复式记账方案。它提供了一个精美的移动端 H5 界面，让你随时随地轻松记账，并将数据实时同步至你的 GitHub 私有仓库中。同时，完美兼容 Fava 网页端可视化看板。

---

## 一、新建记账仓库与目录结构

为了让 Cloudflare Worker 和 Fava 能够无缝协同工作，请在 GitHub 上建立一个专属的记账仓库。

### 1. 新建仓库

- 登录 GitHub 并创建一个新的仓库（建议命名为 `beancount-ledger`）。
- 设置为 **Private**（私有仓库），并勾选 **Add a README file**。

### 2. 仓库目录结构

在仓库根目录下，按如下结构规划你的文件：

```
beancount-ledger/
├── .github/
│   └── workflows/
│       └── bean-check.yml   # 自动校验工作流（可选）
├── main.bean                # Fava 总入口（支持通配符自动加载）
├── accounts.bean            # 账户体系与期初定义
└── 2026/                    # 按年份分类的文件夹
    ├── 2026-06.bean         # 历史月度账目
    └── 2026-07.bean         # 当前月度账目
```

### 3. 核心文件内容模板

**main.bean**（Fava 总入口，支持通配符，一劳永逸）：

```bean
; main.bean - Fava 总入口
option "title" "我的个人账本"
option "operating_currency" "CNY"

; 引入账户定义
include "accounts.bean"

; 自动匹配所有年份文件夹下的月度账目，后续无需手动修改此文件
include "20*/*.bean"
```

**accounts.bean**（账户体系定义示例）：

```bean
; 账户体系与期初定义
2024-01-01 open Assets:CN:WeChat CNY
2024-01-01 open Assets:CN:Alipay CNY
2024-01-01 open Liabilities:CreditCard CNY
2024-01-01 open Expenses:Food CNY
2024-01-01 open Expenses:Transport CNY
2024-01-01 open Income:Salary CNY
```

**2026/2026-07.bean**（月度流水账目示例）：

```bean
; 2026年7月日常收支流水

2026-07-01 * "餐饮" "午餐外卖"
  Expenses:Food                       25.00 CNY
  Assets:CN:WeChat                   -25.00 CNY
```

---

## 二、配置说明

在进行部署前，请准备好以下凭证和配置参数：

### 1. 获取 GitHub Personal Access Token (PAT)

- 进入 GitHub -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Tokens (classic)**。
- 点击 **Generate new token (classic)**。
- 勾选 `repo` 权限（授予对私有仓库的完整读写权限）。
- 生成并复制该 Token（妥善保存，离开页面后将不再显示）。

### 2. Cloudflare Worker 环境变量

在部署 Worker 时，需要在后台配置以下环境变量：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `GITHUB_OWNER` | 文本 | 你的 GitHub 用户名或组织名（例如：`your-username`） |
| `GITHUB_REPO` | 文本 | 你的记账仓库名称（例如：`beancount-ledger`） |
| `GITHUB_TOKEN` | 密文 (Secret) | 上一步生成的 GitHub Personal Access Token |
| `SECRET_TOKEN` | 密文 (Secret) | 自定义的网页访问密钥（用于登录解锁账本） |

---

## 三、部署指南（Cloudflare Worker）

本项目前后端已高度整合为一个完整的 Cloudflare Worker 脚本。

1. 登录 Cloudflare Dashboard。
2. 在左侧菜单栏选择 **Workers & Pages** -> **Create application** -> **Create Worker**。
3. 输入一个 Worker 名称（例如 `beanflux`），点击 **Deploy**。
4. 部署完成后，点击 **Edit code**，将合并后的项目 JavaScript 代码完整复制并覆盖 `worker.js`，点击右上角 **Save and deploy**。
5. 返回 Worker 主页，进入 **Settings** -> **Variables**。
6. 点击 **Add variable**，依次填入 `GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_TOKEN` 和 `SECRET_TOKEN`（建议将 Token 类变量设为 Encrypt 加密）。
7. 配置完成后，访问 Cloudflare 分配的默认域名（或绑定自定义域名），输入你在环境变量中设置的 `SECRET_TOKEN` 即可解锁并开始记账。

---

## 四、进阶：配置 GitHub Actions 自动校验

为了防止手机端提交不规范的账目导致语法崩溃，建议为仓库配置 GitHub Actions 自动化校验。

1. 在仓库中新建文件：`.github/workflows/bean-check.yml`
2. 写入以下内容：

```yaml
name: Beancount CI Check

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'

      - name: Install Beancount
        run: |
          python -m pip install --upgrade pip
          pip install beancount

      - name: Run bean-check
        run: |
          bean-check main.bean
```

保存后，每次推送或通过网页提交代码，GitHub 都会自动进行语法和合规性检查。

---

## 五、使用 Fava 构建可视化网页

Fava 是官方推荐的现代化复式记账 Web 可视化看板。得益于 `main.bean` 中配置了通配符，你只需安装并运行它即可，无需任何额外的配置维护。

### 1. 安装 Fava

确保本地或服务器已安装 Python 环境，在终端执行：

```bash
pip install fava
```

### 2. 克隆仓库与同步

将你的 GitHub 记账仓库克隆到本地：

```bash
git clone https://github.com/你的用户名/beancount-ledger.git
cd beancount-ledger
```

> 由于手机端会随时往该仓库提交记录，本地开发或查看时只需通过 `git pull` 同步最新账单。

### 3. 一键启动 Fava

在仓库根目录执行以下命令：

```bash
fava main.bean
```

终端将输出本地访问地址（通常为 http://localhost:5000）。在浏览器中打开该链接，即可享受强大的图表分析、资产负债表与收支穿透查询。

---

## 六、常见问题与注意事项 (FAQ)

### 1. 记账网页的分类标签和场景可以自定义吗？

可以。系统目前内置了部分常用场景分类（如餐饮、交通、购物等）。你可以随时在 Cloudflare Worker 的代码中，找到 `categories` 和 `descriptions` 这两个配置对象，根据你个人的记账习惯进行修改或增删。修改完毕后，点击右上角的 **Save and deploy** 即可立即生效。

### 2. 为什么我在 GitHub 仓库里添加了新账户，前端没有显示？

前端网页会在你验证密钥后自动读取 GitHub 根目录下 `accounts.bean` 里的账户定义。如果你中途在 GitHub 上修改了 `accounts.bean` 文件，只需刷新手机网页，或者在页面底部点击 **”🔄 刷新分析当前月份”** 按钮，系统就会重新拉取并更新最新的账户列表。

### 3. 记账出现错误可以撤销吗？

支持防手抖撤销。在提交一笔记账后，如果你发现填错了金额或选错了账户，可以在页面右上角点击 **”↩️ 撤销”** 按钮。系统会自动在当月流水文件中删除你刚刚提交的最后一笔记录。

### 4. 我的财务数据安全吗？

绝对安全。BeanFlux 的架构设计决定了你的数据主权：

- **数据只保存在你的 GitHub 私有仓库中**，完全掌握在你个人手中。
- **Cloudflare Worker 仅作为无状态的数据通道**提供运行环境，不持久化存储你的任何账本明细。
- **前端访问由你自己设定的 `SECRET_TOKEN` 进行拦截鉴权**，没有密钥任何人都无法解锁网页。

---

🎉 **现在，开启你极简、高效、掌控完全数据主权的复式记账之旅吧！**
