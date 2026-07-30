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

- 进入 GitHub -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Fine-grained tokens**。
- 点击 **Generate new token**。
- 选择Only select repositories，选择新建的仓库，
- 点击Add permissions, 添加Contents权限，然后将Contents设置为Read and write
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

项目源码托管在 GitHub（[zhangsanproject/tally-web](https://github.com/zhangsanproject/tally-web)）。Cloudflare 提供了**直接连接 GitHub 仓库**的部署方式，无需本地安装任何工具，源码更新后还会自动重新部署。

### 1. Fork 本项目到你的 GitHub

1. 打开 [zhangsanproject/tally-web](https://github.com/zhangsanproject/tally-web)。
2. 点击右上角 **Fork**，将仓库复制到你自己的 GitHub 账号下。

> 💡 Fork 后，你得到的是自己账号下的 `tally-web` 仓库（例如 `https://github.com/<你的用户名>/tally-web`）。这样既方便 Cloudflare 授权访问，也便于你保存自定义配置。

### 2. 在 Cloudflare 中连接 GitHub 仓库

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)。
2. 在左侧菜单栏选择 **Workers & Pages** -> **Create application**。
3. 选择 **Worker**，点击 **Next**。
4. 在代码来源步骤中，选择 **Connect to Git**。
5. 首次使用需要授权：点击 **Connect GitHub**，选择你的账号并授权 Cloudflare 访问你 Fork 的 `tally-web` 仓库。
6. 选择 Fork 后的 `tally-web` 仓库，分支选择 `main`。
7. Cloudflare 会自动识别仓库中的 `wrangler.toml`（项目名称、入口 `worker.js`、`compatibility_date` 等），无需额外修改。
8. 点击 **Deploy**，等待构建完成。

部署成功后，Cloudflare 会分配一个默认访问地址，例如：

```
https://tally-web.<你的子域>.workers.dev
```

### 3. 配置环境变量

部署完成后，回到 Cloudflare Dashboard，进入刚刚创建的 Worker -> **Settings** -> **Variables and Secrets** -> **Add variable**，依次添加以下 4 个环境变量：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `GITHUB_OWNER` | 文本 | 你的 **记账仓库** 所属的 GitHub 用户名或组织名（见第一节） |
| `GITHUB_REPO` | 文本 | 你的 **记账仓库** 名称（例如 `beancount-ledger`） |
| `GITHUB_TOKEN` | Secret | GitHub Personal Access Token（需具备仓库 Contents 读写权限） |
| `SECRET_TOKEN` | Secret | 自定义的网页访问密钥（用于解锁记账页面） |

> 💡 提示：`GITHUB_OWNER` / `GITHUB_REPO` 指向的是**你自己的记账数据仓库**（第一节创建的 `beancount-ledger`），而不是本项目的源码仓库。添加 `GITHUB_TOKEN` 和 `SECRET_TOKEN` 时，请将 Type 选择为 **Secret**，Cloudflare 会加密存储，不会明文展示。

配置完成后，点击 **Save and deploy** 使变量生效。

### 4. 开始使用

在浏览器中打开 Worker 的访问地址，输入你设置的 `SECRET_TOKEN` 解锁页面，即可开始记账。

如需绑定自定义域名，可在 Worker 的 **Settings** -> **Domains & Routes** 中添加 Custom Domain。

### 5. 后续自动部署

由于使用了 GitHub 集成，只要你对 Fork 后的仓库进行 `git push`（例如在 GitHub 网页上直接编辑文件、或合并 Pull Request），Cloudflare 都会**自动检测到代码变更并重新部署**，无需任何手动操作。

当本项目（`zhangsanproject/tally-web`）有官方更新时，只需在 GitHub 上同步一次上游（Sync fork），你的 Worker 就会自动更新到最新版本。

---

## 四、新手建账指南（第一次使用 Beancount 如何录入期初余额）

当你刚开始接触并使用 Beancount 记账时，面临的第一个问题就是："我手机里、银行卡里的存量资金，以及花呗、信用卡里欠的钱，到底该怎么录入系统？"这个过程在复式记账中叫做"建账"或"期初初始化"。以下是第一次使用时具体的记录步骤和方法：

### 1. 数清你的"家底"（盘点资产与负债）

在动手写代码前，先打开你的各大账户，统计出一个确切的时间点（例如 `2026-07-28`）你的实际财务状况：

- **资产类（正数）**：
  - 支付宝余额：例如 5,000.00 元
  - 微信零钱：例如 2,000.00 元
  - 银行卡存款：例如 10,000.00 元
- **负债类（未还清的账单）**：
  - 支付宝花呗：例如 1,000.00 元
  - 信用卡欠款：例如 2,000.00 元

### 2. 确保账户已经在 `accounts.bean` 中声明

在正式写期初交易之前，确保这些账户已经在你的账户定义文件（`accounts.bean`）里被 `open` 过。例如：

```bean
2026-07-28 open Assets:CN:Alipay
2026-07-28 open Assets:CN:WeChat
2026-07-28 open Assets:CN:Bank
2026-07-28 open Liabilities:CN:Huabei
2026-07-28 open Liabilities:CN:CreditCard
2026-07-28 open Equity:Opening-Balances
```

### 3. 编写第一笔期初交易（核心模板）

在你的第一个月度账本文件（例如 `2026-07.bean`）的最顶部，写下你的第一笔交易。你可以直接复制并修改以下模板：

```bean
2026-07-28 * "初始建账" "记录第一次使用时的期初资产与负债"
  Assets:CN:Alipay           5000.00 CNY
  Assets:CN:WeChat            2000.00 CNY
  Assets:CN:Bank             10000.00 CNY
  Liabilities:CN:Huabei      -1000.00 CNY
  Liabilities:CN:CreditCard  -2000.00 CNY
  Equity:Opening-Balances   -14000.00 CNY
```

### 4. 理解为什么要这样写（算账逻辑）

复式记账有一个铁律：一笔交易中，所有金额的加和必须等于 0（借贷平衡）。

- **资产（Assets）**：你拥有的钱，增加记为正数（如 `5000`）。
- **负债（Liabilities）**：你欠别人的钱，在 Beancount 中通常记为负数（如 `-1000`）。

**计算你的净资产**：

- 资产总额：$5000 + 2000 + 10000 = 17000$
- 负债总额：$(-1000) + (-2000) = -3000$
- 净资产（家底）：$17000 + (-3000) = 14000$

**用权益账户（Equity）平账**：为了让整笔交易凑够 0，`Equity:Opening-Balances` 必须填入与净资产绝对值相等但符号相反的数，即 `-14000.00 CNY`。

### 5. 保存并验证

将这段代码保存到你的月度账本中。运行 Beancount 的语法检查（或通过你搭建的网页端 / Fava 查看）。如果没有报错，并且在资产负债表（Balance Sheet）中能看到正确的存款和负债，说明你的第一次期初记录大功告成！

> ⚠️ **核心提醒**：这笔"初始建账"交易一生只需在第一次使用时写一次。在之后的日常买咖啡、发工资、网购中，绝对不要再把 `Equity:Opening-Balances` 写进去了。

---

## 五、进阶：配置 GitHub Actions 自动校验

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

## 六、使用 Fava 构建可视化网页

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

## 七、常见问题与注意事项 (FAQ)

### 1. 记账网页的分类标签和场景可以自定义吗？

可以。系统目前内置了部分常用场景分类（如餐饮、交通、购物等）。你可以随时在 Cloudflare Worker 的代码中，找到 `categories` 和 `descriptions` 这两个配置对象，根据你个人的记账习惯进行修改或增删。修改完毕后，点击右上角的 **Save and deploy** 即可立即生效。

### 2. 为什么我在 GitHub 仓库里添加了新账户，前端没有显示？

前端网页会在你验证密钥后自动读取 GitHub 根目录下 `accounts.bean` 里的账户定义。如果你中途在 GitHub 上修改了 `accounts.bean` 文件，只需刷新手机网页，或者在页面底部点击 **"🔄 刷新分析当前月份"** 按钮，系统就会重新拉取并更新最新的账户列表。

### 3. 记账出现错误可以撤销吗？

支持防手抖撤销。在提交一笔记账后，如果你发现填错了金额或选错了账户，可以在页面右上角点击 **"↩️ 撤销"** 按钮。系统会自动在当月流水文件中删除你刚刚提交的最后一笔记录。

### 4. 我的财务数据安全吗？

绝对安全。BeanFlux 的架构设计决定了你的数据主权：

- **数据只保存在你的 GitHub 私有仓库中**，完全掌握在你个人手中。
- **Cloudflare Worker 仅作为无状态的数据通道**提供运行环境，不持久化存储你的任何账本明细。
- **前端访问由你自己设定的 `SECRET_TOKEN` 进行拦截鉴权**，没有密钥任何人都无法解锁网页。

---

🎉 **现在，开启你极简、高效、掌控完全数据主权的复式记账之旅吧！**
