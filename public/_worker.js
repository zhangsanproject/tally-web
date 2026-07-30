class UserBeancountParser {
    constructor(defaultAsset = 'Assets:CN:WeChat', currency = 'CNY', cloudAccounts = []) {
        this.defaultAsset = defaultAsset;
        this.currency = currency;
    }
}

async function getAccountsFromGitHub(env) {
    const owner = env.GITHUB_OWNER;     
    const repo = env.GITHUB_REPO;       
    const token = env.GITHUB_TOKEN;     
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/accounts.bean`;
    
    const getRes = await fetch(apiUrl, {
        headers: {
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Cloudflare-Worker-Beancount",
            "Accept": "application/vnd.github+json"
        }
    });

    if (!getRes.ok) return [];
    const fileData = await getRes.json();
    const content = decodeURIComponent(escape(atob(fileData.content)));
    
    const accounts = [];
    const regex = /^\s*([\d-]+)\s+open\s+([^\s]+)(?:\s+([^\s]+))?/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        accounts.push({
            date: match[1],
            account: match[2],
            currency: match[3] || 'CNY'
        });
    }
    return accounts;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method !== "POST") {
            if (url.pathname === '/api/accounts/sync') {
                const clientToken = request.headers.get("X-Secret-Token");
                const serverToken = env.SECRET_TOKEN;
                if (serverToken && clientToken !== serverToken) {
                    return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 401 });
                }
                try {
                    const accounts = await getAccountsFromGitHub(env);
                    return new Response(JSON.stringify({ success: true, accounts }), {
                        headers: { "Content-Type": "application/json;charset=UTF-8" }
                    });
                } catch (err) {
                    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
                }
            }
            return new Response(getHtmlPage(), {
                headers: { "Content-Type": "text/html;charset=UTF-8" }
            });
        }

        const clientToken = request.headers.get("X-Secret-Token");
        const serverToken = env.SECRET_TOKEN;
        if (serverToken && clientToken !== serverToken) {
            return new Response("Unauthorized: Invalid Secret Token", { status: 401 });
        }

        if (url.pathname === '/api/commit') {
            try {
                const data = await request.json();
                const { fileName, transaction, description, date } = data;
                const commitRes = await appendToMonthlyGitHub(env, transaction, description, fileName, date);
                if (commitRes.success) {
                    return new Response(`✅ 记账成功并已写入 [${fileName}]！\n\n${transaction}`);
                } else {
                    return new Response(`⚠️ 同步 GitHub 失败: ${commitRes.error}`, { status: 500 });
                }
            } catch (err) {
                return new Response(`❌ 提交请求解析失败: ${err.message}`, { status: 400 });
            }
        }

        if (url.pathname === '/api/undo') {
            try {
                const data = await request.json();
                const { fileName, transaction } = data;
                if (!fileName || !transaction) return new Response("❌ 没有可撤销的记录", { status: 400 });

                const undoRes = await removeMonthlyGitHub(env, fileName, transaction);
                if (undoRes.success) {
                    return new Response(`✅ 已成功撤销上一笔在 [${fileName}] 的记账！`);
                } else {
                    return new Response(`⚠️ 撤销失败: ${undoRes.error}`, { status: 500 });
                }
            } catch (err) {
                return new Response(`❌ 撤销请求解析失败: ${err.message}`, { status: 400 });
            }
        }

        if (url.pathname === '/api/account/commit') {
            try {
                const data = await request.json();
                const { account, currency, date } = data;
                if (!account) return new Response("❌ 账户名称不能为空", { status: 400 });
                
                const cur = currency || 'CNY';
                const openLine = `${date} open ${account} ${cur}`;
                const commitRes = await appendToRootGitHub(env, openLine, `open ${account}`, 'accounts.bean');
                
                if (commitRes.success) {
                    return new Response(`✅ 成功向 [accounts.bean] 添加账户定义！\n\n${openLine}`);
                } else {
                    return new Response(`⚠️ 同步 GitHub 失败: ${commitRes.error}`, { status: 500 });
                }
            } catch (err) {
                return new Response(`❌ 添加账户请求解析失败: ${err.message}`, { status: 400 });
            }
        }

        if (url.pathname === '/api/stats') {
            try {
                const data = await request.json();
                const { date } = data; 
                const [year, month] = date.split('-');
                const fileName = `${year}/${year}-${month}.bean`;
                
                const owner = env.GITHUB_OWNER;     
                const repo = env.GITHUB_REPO;       
                const token = env.GITHUB_TOKEN;     
                const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;
                
                const getRes = await fetch(apiUrl, { 
                    headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json" } 
                });
                
                if (!getRes.ok) {
                    return new Response(JSON.stringify({ success: true, income: 0, expense: 0, accounts: {}, details: [] }), { headers: { "Content-Type": "application/json" } });
                }
                
                const fileData = await getRes.json();
                const content = decodeURIComponent(escape(atob(fileData.content)));
                
                let income = 0;
                let expense = 0;
                const accounts = {};
                const details = [];
                
                const lines = content.split('\n');
                let i = 0;
                while (i < lines.length) {
                    let line = lines[i].trim();
                    let match = line.match(/^(\d{4}-\d{2}-\d{2})\s+[*!]\s+"([^"]*)"\s+"([^"]*)"/);
                    if (match) {
                        let txDate = match[1];
                        let tag = match[2];
                        let desc = match[3];
                        let postings = [];
                        i++;
                        while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t'))) {
                            postings.push(lines[i].trim());
                            i++;
                        }
                        let amount = 0;
                        let type = 'expense';
                        for (let p of postings) {
                            let pMatch = p.match(/^([A-Za-z0-9:]+)\s+(-?\d+(\.\d+)?)/);
                            if (pMatch) {
                                let acc = pMatch[1];
                                let amt = parseFloat(pMatch[2]);
                                
                                if (acc.startsWith('Assets:') || acc.startsWith('Liabilities:')) {
                                    accounts[acc] = (accounts[acc] || 0) + amt; 
                                }
                                
                                if (acc.startsWith('Expenses:')) {
                                    type = 'expense';
                                    amount = Math.abs(amt);
                                    expense += amount;
                                } else if (acc.startsWith('Income:')) {
                                    type = 'income';
                                    amount = Math.abs(amt);
                                    income += amount;
                                }
                            }
                        }
                        if (amount > 0) {
                            details.push({ date: txDate, tag, desc, amount, type });
                        }
                    } else {
                        i++;
                    }
                }
                
                return new Response(JSON.stringify({ success: true, income, expense, accounts, details }), {
                    headers: { "Content-Type": "application/json;charset=UTF-8" }
                });
            } catch (err) {
                return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
            }
        }

        return new Response("Not Found", { status: 404 });
    }
};

async function appendToMonthlyGitHub(env, newContent, description, fileName, date) {
    const owner = env.GITHUB_OWNER;     
    const repo = env.GITHUB_REPO;       
    const token = env.GITHUB_TOKEN;     
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;
    
    const getRes = await fetch(apiUrl, { headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json" } });
    let sha = null;
    let existingContent = "";

    if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        existingContent = decodeURIComponent(escape(atob(fileData.content))).trim();
    }

    let updatedContent = "";
    if (!existingContent) {
        const [year, month] = date.split('-');
        updatedContent = `; ${year}年${parseInt(month, 10)}月日常收支流水\n\n${newContent.trim()}`;
    } else {
        updatedContent = `${existingContent}\n\n${newContent.trim()}`;
    }

    const encodedContent = btoa(unescape(encodeURIComponent(updatedContent)));
    const putBody = { message: `Auto: 记账 [${fileName}] ${description}`, content: encodedContent };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify(putBody)
    });
    return putRes.ok ? { success: true } : { success: false, error: (await putRes.json()).message };
}

async function appendToRootGitHub(env, newContent, description, fileName) {
    const owner = env.GITHUB_OWNER;     
    const repo = env.GITHUB_REPO;       
    const token = env.GITHUB_TOKEN;     
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;
    
    const getRes = await fetch(apiUrl, { headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json" } });
    let sha = null;
    let existingContent = "";

    if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
        existingContent = decodeURIComponent(escape(atob(fileData.content))).trim();
    }

    const updatedContent = !existingContent ? `; 账户体系与期初定义\n\n${newContent.trim()}` : `${existingContent}\n${newContent.trim()}`;
    const encodedContent = btoa(unescape(encodeURIComponent(updatedContent)));
    const putBody = { message: `Auto: 添加账户 [${fileName}] ${description}`, content: encodedContent };
    if (sha) putBody.sha = sha;

    const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify(putBody)
    });
    return putRes.ok ? { success: true } : { success: false, error: (await putRes.json()).message };
}

async function removeMonthlyGitHub(env, fileName, targetTransaction) {
    const owner = env.GITHUB_OWNER;     
    const repo = env.GITHUB_REPO;       
    const token = env.GITHUB_TOKEN;     
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;
    
    const getRes = await fetch(apiUrl, { headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json" } });
    if (!getRes.ok) return { success: false, error: "目标文件不存在" };

    const fileData = await getRes.json();
    const sha = fileData.sha;
    let existingContent = decodeURIComponent(escape(atob(fileData.content))).trim();
    const target = targetTransaction.trim();

    if (existingContent.endsWith(target)) {
        existingContent = existingContent.slice(0, existingContent.length - target.length).trim();
    } else {
        return { success: false, error: "文件末尾与上一笔记录不匹配" };
    }

    const encodedContent = btoa(unescape(encodeURIComponent(existingContent)));
    const putBody = { message: `Auto: 撤销记账 [${fileName}]`, content: encodedContent, sha: sha };

    const putRes = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Authorization": `Bearer ${token}`, "User-Agent": "Worker", "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify(putBody)
    });
    return putRes.ok ? { success: true } : { success: false, error: (await putRes.json()).message };
}

function getHtmlPage() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0">
    <title>BeanFlux 极速记账</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        select { background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e"); background-position: right 0.5rem center; background-repeat: no-repeat; background-size: 1.5em 1.5em; padding-right: 2.5rem; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col p-3 sm:p-6">
    
    <!-- 🔑 鉴权锁屏遮罩层 (未验证密钥时展示) -->
    <div id="authOverlay" class="fixed inset-0 bg-slate-950 flex items-center justify-center p-4 z-50">
        <div class="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl text-center">
            <div class="space-y-1">
                <h1 class="text-xl font-bold tracking-tight text-indigo-400">BeanFlux</h1>
                <p class="text-xs text-slate-400">请输入 API 密钥以解锁账本</p>
            </div>
            <input type="password" id="authSecretInput" placeholder="请输入 Secret Token" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 text-center">
            <button onclick="verifyAndSaveToken()" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm py-2.5 rounded-lg transition-colors">验证并进入</button>
            <div id="authErrorMsg" class="text-xs text-rose-400 hidden"></div>
        </div>
    </div>

    <!-- 主页面内容容器 (验证通过后展示) -->
    <div id="mainAppContainer" class="max-w-md w-full mx-auto space-y-4 hidden">
        <!-- 头部 -->
        <header class="flex justify-between items-center pb-2 border-b border-slate-800">
            <div>
                <h1 class="text-xl font-bold tracking-tight text-indigo-400">BeanFlux</h1>
                <p class="text-xs text-slate-400">纯 GitHub 账户联动记账</p>
            </div>
            <div class="flex gap-2">
                <button id="undoBtn" onclick="undoLedger()" class="hidden text-xs bg-amber-600/20 text-amber-400 px-3 py-1.5 rounded-lg border border-amber-500/30">↩️ 撤销</button>
                <button onclick="toggleSettings()" class="text-xs bg-slate-800 px-3 py-1.5 rounded-lg">⚙️ 密钥</button>
            </div>
        </header>

        <!-- 密钥设置面板 -->
        <div id="settingsPanel" class="hidden bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <input type="password" id="secretToken" placeholder="输入新的 API 密钥" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
            <button onclick="saveSettings()" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-2 rounded-lg">更新密钥并刷新</button>
        </div>

        <!-- 导航 Tab -->
        <div class="flex gap-4 mb-2 border-b border-slate-800/50 pb-2">
            <button id="tab-record" onclick="switchTab('record')" class="flex-1 text-sm font-bold text-indigo-400 border-b-2 border-indigo-500 pb-1 transition-colors">记账录入</button>
            <button id="tab-stats" onclick="switchTab('stats')" class="flex-1 text-sm font-bold text-slate-500 hover:text-slate-300 pb-1 border-b-2 border-transparent transition-colors">本月收支</button>
        </div>

        <!-- 记账面板 -->
        <div id="recordPanel" class="space-y-4">
            <!-- 表单区域 -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4 shadow-xl">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1">🏷️ 记录类型</label>
                        <select id="txType" onchange="onTypeChange()" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 appearance-none">
                            <option value="expense">支出 (Expense)</option>
                            <option value="income">收入 (Income)</option>
                            <option value="transfer">转账 (Transfer)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1">📅 日期</label>
                        <input type="date" id="txDate" onchange="generatePreview()" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-indigo-500">
                    </div>
                </div>

                <!-- 金额与分类标签 -->
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-medium text-amber-400 mb-1">💰 金额</label>
                        <input type="number" id="txAmount" step="0.01" placeholder="0.00" oninput="generatePreview()" class="w-full bg-slate-950 border border-amber-600/50 rounded-lg px-3 py-2 text-base font-semibold text-amber-400 focus:border-amber-500 focus:outline-none placeholder-slate-700">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-slate-400 mb-1">🏷️ 分类标签 (*后第一参数)</label>
                        <select id="txCategorySelect" onchange="onCategoryChange()" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 appearance-none"></select>
                        <div id="txCategoryInputWrapper" class="hidden gap-2">
                            <input type="text" id="txCategoryInput" placeholder="输入自定义..." oninput="generatePreview()" class="w-full bg-slate-950 border border-indigo-500/60 rounded-lg px-3 py-2 text-sm text-indigo-200 focus:border-indigo-500 focus:outline-none placeholder-slate-600">
                            <button type="button" onclick="cancelCustomCategory()" class="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-lg w-10 flex items-center justify-center transition-colors" title="返回列表">✕</button>
                        </div>
                    </div>
                </div>

                <!-- 消费场景 / 备注 -->
                <div>
                    <label class="block text-xs font-medium text-slate-400 mb-1">📝 消费场景 / 备注 (第二参数)</label>
                    <select id="txDescSelect" onchange="onDescChange()" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 appearance-none"></select>
                    <div id="txDescInputWrapper" class="hidden gap-2">
                        <input type="text" id="txDescInput" placeholder="输入详细备注..." oninput="generatePreview()" class="w-full bg-slate-950 border border-indigo-500/60 rounded-lg px-3 py-2 text-sm text-indigo-200 focus:border-indigo-500 focus:outline-none placeholder-slate-600">
                        <button type="button" onclick="cancelCustomDesc()" class="shrink-0 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-lg w-10 flex items-center justify-center transition-colors" title="返回列表">✕</button>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 pt-3 border-t border-slate-800">
                    <div>
                        <label id="lblAcc1" class="block text-xs font-medium text-slate-400 mb-1">💳 支付方式 (扣款)</label>
                        <select id="txAcc1" onchange="generatePreview()" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-xs text-slate-300 focus:border-indigo-500 appearance-none"></select>
                    </div>
                    <div>
                        <label id="lblAcc2" class="block text-xs font-medium text-emerald-400 mb-1">🎯 支出分类 (流向)</label>
                        <select id="txAcc2" onchange="generatePreview()" class="w-full bg-slate-950 border border-emerald-800/50 rounded-lg px-2 py-2 text-xs text-emerald-300 focus:border-emerald-500 appearance-none"></select>
                    </div>
                </div>
            </div>

            <!-- 实时预览 & 提交框 -->
            <div id="commitBox" class="opacity-50 pointer-events-none transition-opacity duration-300 bg-slate-900 border border-slate-800 rounded-xl p-1 overflow-hidden">
                <div class="p-3 bg-slate-950 text-[11px] font-mono text-slate-400 whitespace-pre-wrap rounded-t-lg border-b border-slate-800 overflow-x-auto min-h-[4rem]" id="livePreviewCode">
                    等待填写金额以生成记录...
                </div>
                <button id="commitBtn" onclick="commitLedger()" class="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-b-lg transition flex items-center justify-center gap-2">
                    <span>🚀 确认无误，提交记账</span>
                </button>
            </div>

            <!-- 结果通知 -->
            <div id="resultAlert" class="hidden text-xs rounded-xl p-3 border"></div>
        </div>

        <!-- 报表、资产变动与明细面板 -->
        <div id="statsPanel" class="hidden space-y-4">
            <div class="grid grid-cols-2 gap-3">
                <div class="bg-slate-900 border border-emerald-800/50 rounded-xl p-4 shadow-lg">
                    <div class="text-xs text-slate-400 mb-1">本月收入 (Income)</div>
                    <div class="text-xl font-bold text-emerald-400" id="stat-income">¥ 0.00</div>
                </div>
                <div class="bg-slate-900 border border-rose-800/50 rounded-xl p-4 shadow-lg">
                    <div class="text-xs text-slate-400 mb-1">本月支出 (Expenses)</div>
                    <div class="text-xl font-bold text-rose-400" id="stat-expense">¥ 0.00</div>
                </div>
            </div>

            <!-- 资产流向变动保留 -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg">
                <h3 class="text-xs font-medium text-slate-300 mb-3 border-b border-slate-800 pb-2">💳 本月资产变动 (流动向)</h3>
                <div id="stat-accounts" class="space-y-2 text-sm text-slate-400 min-h-[4rem]">
                    点击下方刷新按钮获取最新数据...
                </div>
            </div>

            <!-- 收支明细查看 (含搜索与分页优化) -->
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
                <div class="flex justify-between items-center border-b border-slate-800 pb-2">
                    <h3 class="text-xs font-medium text-slate-300">📋 本月收支明细</h3>
                    <input type="text" id="detailSearchInput" placeholder="搜索标签/备注..." oninput="filterAndRenderDetails()" class="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 w-36">
                </div>
                <div id="stat-details" class="space-y-2 text-sm text-slate-400 min-h-[4rem]">
                    点击下方刷新按钮获取最新数据...
                </div>
                <div id="detailPagination" class="hidden text-center pt-2 border-t border-slate-800/50">
                    <button onclick="loadMoreDetails()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-4 py-1.5 rounded-lg transition-colors w-full">加载更多...</button>
                </div>
            </div>

            <button id="refreshStatsBtn" onclick="fetchStats()" class="w-full bg-slate-800 hover:bg-slate-700 text-white font-medium py-3 rounded-lg transition-colors flex justify-center items-center gap-2">
                <span>🔄 刷新分析当前月份</span>
            </button>
        </div>
    </div>

    <script>
        let currentPayload = null;
        let accountsData = { assets: [], expenses: [], incomes: [] };
        let allDetailsCache = [];
        let displayedCount = 10;

        const categories = {
            expense: ['餐饮', '交通', '购物', '教育', '居住', '生活', '娱乐', '其他'],
            income: ['工资', '公积金', '理财', '退款', '其他收入'],
            transfer: ['转账', '还款', '充值']
        };

        const descriptions = {
            expense: [
                { group: '🍔 餐饮美食', items: [{name:'外卖', acc:'Expenses:Food'}, {name:'早餐', acc:'Expenses:Food'}, {name:'午餐', acc:'Expenses:Food'}, {name:'晚餐', acc:'Expenses:Food'}, {name:'买菜/食材', acc:'Expenses:Food'}, {name:'聚餐/请客', acc:'Expenses:Food'}] },
                { group: '🚗 交通出行', items: [{name:'打车', acc:'Expenses:Transport'}, {name:'公交/地铁', acc:'Expenses:Transport'}, {name:'油费/充电', acc:'Expenses:Transport:Auto'}, {name:'高速过路费', acc:'Expenses:Transport:Auto'}] },
                { group: '🛒 生活购物', items: [{name:'淘宝/京东', acc:'Expenses:Shopping'}, {name:'日用品', acc:'Expenses:Shopping'}, {name:'服饰鞋包', acc:'Expenses:Shopping'}, {name:'数码/硬件', acc:'Expenses:Digital'}] },
                { group: '🏀 运动与爱好', items: [{name:'篮球场地/水费', acc:'Expenses:Entertainment'}, {name:'运动装备(鞋/弓箭等)', acc:'Expenses:Shopping:Sports'}, {name:'自驾游支出', acc:'Expenses:Travel'}] },
                { group: '👨‍👦 家庭与教育', items: [{name:'孩子文具/玩具', acc:'Expenses:Education'}, {name:'兴趣班/学费', acc:'Expenses:Education'}, {name:'家庭日常开销', acc:'Expenses:Family'}, {name:'教育基金', acc:'Expenses:Education'}] },
                { group: '💻 开发与订阅', items: [{name:'云服务器/域名', acc:'Expenses:Digital:Server'}, {name:'API/软件订阅', acc:'Expenses:Digital:Software'}, {name:'项目外包费', acc:'Expenses:Business'}] },
                { group: '🏠 居住与其他', items: [{name:'水电燃气', acc:'Expenses:Utilities'}, {name:'房租/物业', acc:'Expenses:Housing'}, {name:'话费网费', acc:'Expenses:Utilities'}] },
                { group: '✏️ 其他 (自定义)', items: [{name:'custom', label:'自定义...'}] }
            ],
            income: [
                { group: '💰 收入进账', items: [{name:'工资/薪水', acc:'Income:Salary'}, {name:'奖金/项目款', acc:'Income:Salary'}, {name:'理财收益', acc:'Income:Other'}, {name:'退款/返现', acc:'Income:Other'}] },
                { group: '✏️ 其他 (自定义)', items: [{name:'custom', label:'自定义...'}] }
            ],
            transfer: [
                { group: '🔄 资金流转', items: [{name:'信用卡还款'}, {name:'充值/提现'}, {name:'资金倒腾'}] },
                { group: '✏️ 其他 (自定义)', items: [{name:'custom', label:'自定义...'}] }
            ]
        };

        window.addEventListener('DOMContentLoaded', () => {
            document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
            const token = localStorage.getItem('cfg_secret_token');
            if (token) {
                verifyTokenOnLoad(token);
            } else {
                showAuthLock();
            }
            checkUndo();
        });

        async function verifyTokenOnLoad(token) {
            const success = await fetchAccounts(token);
            if (success) {
                unlockApp();
            } else {
                localStorage.removeItem('cfg_secret_token');
                showAuthLock('密钥已失效或验证失败，请重新输入');
            }
        }

        async function verifyAndSaveToken() {
            const inputVal = document.getElementById('authSecretInput').value.trim();
            const errBox = document.getElementById('authErrorMsg');
            errBox.classList.add('hidden');
            if (!inputVal) {
                errBox.innerText = '请输入密钥';
                errBox.classList.remove('hidden');
                return;
            }

            const success = await fetchAccounts(inputVal);
            if (success) {
                localStorage.setItem('cfg_secret_token', inputVal);
                document.getElementById('secretToken').value = inputVal;
                unlockApp();
            } else {
                errBox.innerText = '密钥错误或验证失败，请检查';
                errBox.classList.remove('hidden');
            }
        }

        function unlockApp() {
            document.getElementById('authOverlay').classList.add('hidden');
            document.getElementById('mainAppContainer').classList.remove('hidden');
            initSelects();
        }

        function showAuthLock(msg) {
            document.getElementById('authOverlay').classList.remove('hidden');
            document.getElementById('mainAppContainer').classList.add('hidden');
            if (msg) {
                const errBox = document.getElementById('authErrorMsg');
                errBox.innerText = msg;
                errBox.classList.remove('hidden');
            }
        }

        async function fetchAccounts(tokenToTest) {
            const token = tokenToTest || localStorage.getItem('cfg_secret_token');
            if (!token) return false;
            try {
                const res = await fetch('/api/accounts/sync', { headers: { 'X-Secret-Token': token } });
                if (res.status === 401) return false;
                const data = await res.json();
                if (data.success && Array.isArray(data.accounts)) {
                    const accList = data.accounts.map(a => a.account);
                    accountsData.assets = accList.filter(a => a.startsWith('Assets:') || a.startsWith('Liabilities:'));
                    accountsData.expenses = accList.filter(a => a.startsWith('Expenses:'));
                    accountsData.incomes = accList.filter(a => a.startsWith('Income:'));
                    return true;
                }
                return false;
            } catch (e) {
                console.error('拉取 GitHub 账户失败:', e);
                return false;
            }
        }

        function initSelects() {
            onTypeChange();
        }

        function onTypeChange() {
            const type = document.getElementById('txType').value;
            
            const catSelect = document.getElementById('txCategorySelect');
            const catList = categories[type] || ['其他'];
            catSelect.innerHTML = catList.map(c => '<option value="' + c + '">' + c + '</option>').join('') + '<option value="custom">✏️ 自定义...</option>';
            
            const descSelect = document.getElementById('txDescSelect');
            descSelect.innerHTML = descriptions[type].map(group => 
                '<optgroup label="' + group.group + '">' + 
                group.items.map(item => '<option value="' + item.name + '" data-acc="' + (item.acc || '') + '">' + (item.label || item.name) + '</option>').join('') +
                '</optgroup>'
            ).join('');
            
            cancelCustomCategory(true);
            cancelCustomDesc(true);

            const acc1 = document.getElementById('txAcc1');
            const acc2 = document.getElementById('txAcc2');
            const lbl1 = document.getElementById('lblAcc1');
            const lbl2 = document.getElementById('lblAcc2');

            if (type === 'expense') {
                lbl1.innerText = '💳 支付方式 (扣款)';
                lbl2.innerText = '🎯 支出分类 (流向)';
                fillSelect(acc1, accountsData.assets);
                fillSelect(acc2, accountsData.expenses);
            } else if (type === 'income') {
                lbl1.innerText = '📥 收款账户 (入账)';
                lbl2.innerText = '💰 收入来源 (来源)';
                fillSelect(acc1, accountsData.assets);
                fillSelect(acc2, accountsData.incomes);
            } else {
                lbl1.innerText = '📤 转出账户 (扣款)';
                lbl2.innerText = '📥 转入账户 (入账)';
                fillSelect(acc1, accountsData.assets);
                fillSelect(acc2, accountsData.assets);
            }
            
            onDescChange();
            generatePreview();
        }

        function onCategoryChange() {
            const sel = document.getElementById('txCategorySelect');
            const wrapper = document.getElementById('txCategoryInputWrapper');
            const input = document.getElementById('txCategoryInput');
            
            if (sel.value === 'custom') {
                sel.classList.add('hidden');
                wrapper.classList.remove('hidden');
                wrapper.classList.add('flex');
                input.focus();
            }
            generatePreview();
        }

        function cancelCustomCategory(isReset = false) {
            const sel = document.getElementById('txCategorySelect');
            const wrapper = document.getElementById('txCategoryInputWrapper');
            const input = document.getElementById('txCategoryInput');
            
            if(!isReset) sel.selectedIndex = 0;
            wrapper.classList.remove('flex');
            wrapper.classList.add('hidden');
            sel.classList.remove('hidden');
            input.value = '';
            
            if(!isReset) generatePreview();
        }

        function onDescChange() {
            const type = document.getElementById('txType').value;
            const sel = document.getElementById('txDescSelect');
            const wrapper = document.getElementById('txDescInputWrapper');
            const input = document.getElementById('txDescInput');
            const selectedOpt = sel.options[sel.selectedIndex];
            
            if (sel.value === 'custom') {
                sel.classList.add('hidden');
                wrapper.classList.remove('hidden');
                wrapper.classList.add('flex');
                input.focus();
            } else {
                const mappedAcc = selectedOpt ? selectedOpt.getAttribute('data-acc') : null;
                if (mappedAcc && type !== 'transfer') {
                    const acc2 = document.getElementById('txAcc2');
                    if (Array.from(acc2.options).some(o => o.value === mappedAcc)) {
                        acc2.value = mappedAcc;
                    }
                }
            }
            generatePreview();
        }

        function cancelCustomDesc(isReset = false) {
            const sel = document.getElementById('txDescSelect');
            const wrapper = document.getElementById('txDescInputWrapper');
            const input = document.getElementById('txDescInput');
            
            if(!isReset) sel.selectedIndex = 0;
            wrapper.classList.remove('flex');
            wrapper.classList.add('hidden');
            sel.classList.remove('hidden');
            input.value = '';
            
            if(!isReset) onDescChange(); 
        }

        function fillSelect(element, items) {
            const currentVal = element.value;
            element.innerHTML = items.map(i => '<option value="' + i + '">' + i + '</option>').join('');
            if (items.includes(currentVal)) {
                element.value = currentVal;
            }
        }

        function generatePreview() {
            const type = document.getElementById('txType').value;
            const date = document.getElementById('txDate').value;
            let amountRaw = document.getElementById('txAmount').value;
            
            const catSel = document.getElementById('txCategorySelect').value;
            const typeStr = catSel === 'custom' ? document.getElementById('txCategoryInput').value.trim() : catSel;

            const descSel = document.getElementById('txDescSelect').value;
            const desc = descSel === 'custom' ? document.getElementById('txDescInput').value.trim() : descSel;
            
            const acc1 = document.getElementById('txAcc1').value;
            const acc2 = document.getElementById('txAcc2').value;

            const box = document.getElementById('commitBox');
            const code = document.getElementById('livePreviewCode');

            if (!amountRaw || amountRaw <= 0 || !typeStr || !desc || !acc1 || !acc2) {
                box.classList.add('opacity-50', 'pointer-events-none');
                code.innerText = '请完整填写表单并选择有效账户与标签...';
                currentPayload = null;
                return;
            }

            const amount = parseFloat(amountRaw).toFixed(2);
            const currency = 'CNY';
            const [year, month] = date.split('-');
            const fileName = year + '/' + year + '-' + month + '.bean';
            
            let line1Acc, line2Acc;
            if (type === 'expense') {
                line1Acc = acc1; 
                line2Acc = acc2; 
            } else if (type === 'income') {
                line1Acc = acc2; 
                line2Acc = acc1; 
            } else {
                line1Acc = acc1; 
                line2Acc = acc2; 
            }

            const line1Amt = ' -' + amount + ' ' + currency;
            const line2Amt = '  ' + amount + ' ' + currency;

            const transaction = date + ' * "' + typeStr + '" "' + desc + '"\\n  ' + line1Acc.padEnd(35, ' ') + line1Amt + '\\n  ' + line2Acc.padEnd(35, ' ') + line2Amt;
            
            currentPayload = { fileName, transaction, description: desc, date };
            code.innerText = '; 将写入 -> ' + fileName + '\\n\\n' + transaction;
            box.classList.remove('opacity-50', 'pointer-events-none');
        }

        async function commitLedger() {
            if (!currentPayload) return;
            const token = localStorage.getItem('cfg_secret_token');
            const btn = document.getElementById('commitBtn');
            const alertBox = document.getElementById('resultAlert');
            
            btn.innerHTML = '⏳ 正在同步至 GitHub...';
            btn.classList.add('opacity-80', 'pointer-events-none');
            alertBox.classList.add('hidden');

            try {
                const res = await fetch('/api/commit', {
                    method: 'POST',
                    headers: { 'X-Secret-Token': token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(currentPayload)
                });
                const resText = await res.text();
                
                alertBox.classList.remove('hidden');
                if (res.ok) {
                    alertBox.className = 'text-xs rounded-xl p-3 border bg-emerald-900/30 border-emerald-800 text-emerald-400 mt-4 whitespace-pre-wrap';
                    alertBox.innerText = resText;
                    
                    localStorage.setItem('last_undo_record', JSON.stringify({ fileName: currentPayload.fileName, transaction: currentPayload.transaction }));
                    checkUndo();
                    
                    document.getElementById('txAmount').value = '';
                    if (document.getElementById('txDescSelect').value === 'custom') {
                        cancelCustomDesc();
                    }
                    generatePreview();
                } else {
                    alertBox.className = 'text-xs rounded-xl p-3 border bg-rose-900/30 border-rose-800 text-rose-400 mt-4 whitespace-pre-wrap';
                    alertBox.innerText = resText;
                }
            } catch (err) {
                alertBox.classList.remove('hidden');
                alertBox.className = 'text-xs rounded-xl p-3 border bg-rose-900/30 border-rose-800 text-rose-400 mt-4 whitespace-pre-wrap';
                alertBox.innerText = '❌ 网络请求失败: ' + err.message;
            } finally {
                btn.innerHTML = '🚀 确认无误，提交记账';
                btn.classList.remove('opacity-80', 'pointer-events-none');
            }
        }

        async function undoLedger() {
            const recordStr = localStorage.getItem('last_undo_record');
            if (!recordStr) return;
            const record = JSON.parse(recordStr);
            if (!confirm('确定要撤销上一笔在 [' + record.fileName + '] 的记账吗？')) return;

            const token = localStorage.getItem('cfg_secret_token');
            const alertBox = document.getElementById('resultAlert');
            alertBox.classList.add('hidden');

            try {
                const res = await fetch('/api/undo', {
                    method: 'POST',
                    headers: { 'X-Secret-Token': token, 'Content-Type': 'application/json' },
                    body: JSON.stringify(record)
                });
                const resText = await res.text();
                alertBox.classList.remove('hidden');
                
                if (res.ok) {
                    alertBox.className = 'text-xs rounded-xl p-3 border bg-amber-900/30 border-amber-800 text-amber-400 mt-4 whitespace-pre-wrap';
                    alertBox.innerText = resText;
                    localStorage.removeItem('last_undo_record');
                    checkUndo();
                } else {
                    alertBox.className = 'text-xs rounded-xl p-3 border bg-rose-900/30 border-rose-800 text-rose-400 mt-4 whitespace-pre-wrap';
                    alertBox.innerText = resText;
                }
            } catch (err) {
                alert('撤销失败: ' + err.message);
            }
        }

        function checkUndo() {
            const btn = document.getElementById('undoBtn');
            localStorage.getItem('last_undo_record') ? btn.classList.remove('hidden') : btn.classList.add('hidden');
        }

        function toggleSettings() { 
            const panel = document.getElementById('settingsPanel');
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                document.getElementById('secretToken').value = localStorage.getItem('cfg_secret_token') || '';
            }
        }

        async function saveSettings() {
            const val = document.getElementById('secretToken').value.trim();
            if(val) {
                const success = await fetchAccounts(val);
                if (success) {
                    localStorage.setItem('cfg_secret_token', val);
                    toggleSettings();
                    alert('✅ 密钥更新成功并验证通过！');
                    fetchAccounts();
                } else {
                    alert('⚠️ 密钥验证失败，请检查');
                }
            }
        }

        function switchTab(tab) {
            const recordBtn = document.getElementById('tab-record');
            const statsBtn = document.getElementById('tab-stats');
            const recordPanel = document.getElementById('recordPanel');
            const statsPanel = document.getElementById('statsPanel');

            if (tab === 'record') {
                recordPanel.classList.remove('hidden');
                statsPanel.classList.add('hidden');
                recordBtn.className = 'flex-1 text-sm font-bold text-indigo-400 border-b-2 border-indigo-500 pb-1 transition-colors';
                statsBtn.className = 'flex-1 text-sm font-bold text-slate-500 hover:text-slate-300 pb-1 border-b-2 border-transparent transition-colors';
            } else {
                recordPanel.classList.add('hidden');
                statsPanel.classList.remove('hidden');
                statsBtn.className = 'flex-1 text-sm font-bold text-indigo-400 border-b-2 border-indigo-500 pb-1 transition-colors';
                recordBtn.className = 'flex-1 text-sm font-bold text-slate-500 hover:text-slate-300 pb-1 border-b-2 border-transparent transition-colors';
                fetchStats();
            }
        }

        function handleFetchedDetails(details) {
            allDetailsCache = (details || []).sort((a, b) => new Date(b.date) - new Date(a.date));
            displayedCount = 10;
            document.getElementById('detailSearchInput').value = '';
            filterAndRenderDetails();
        }

        function filterAndRenderDetails() {
            const keyword = document.getElementById('detailSearchInput').value.trim().toLowerCase();
            const detailsContainer = document.getElementById('stat-details');
            const paginationDiv = document.getElementById('detailPagination');

            const filtered = allDetailsCache.filter(t => {
                const tag = (t.tag || '').toLowerCase();
                const desc = (t.desc || '').toLowerCase();
                const date = (t.date || '').toLowerCase();
                return tag.includes(keyword) || desc.includes(keyword) || date.includes(keyword);
            });

            if (filtered.length === 0) {
                detailsContainer.innerHTML = '<div class="text-center text-slate-500 py-4 text-xs">没有找到相关收支记录</div>';
                paginationDiv.classList.add('hidden');
                return;
            }

            const currentList = filtered.slice(0, displayedCount);

            detailsContainer.innerHTML = currentList.map(t => {
                const isIncome = t.type === 'income';
                const color = isIncome ? 'text-emerald-400' : 'text-rose-400';
                const sign = isIncome ? '+' : '-';
                return '<div class="flex justify-between items-center border-b border-slate-800/50 py-2 last:border-0">' +
                    '<div class="space-y-0.5 truncate pr-2">' +
                        '<div class="text-xs text-slate-300 font-medium truncate">' + t.tag + ' <span class="text-slate-500 font-normal">(' + t.desc + ')</span></div>' +
                        '<div class="text-[10px] text-slate-500 font-mono">' + t.date + '</div>' +
                    '</div>' +
                    '<div class="font-mono text-xs sm:text-sm font-semibold shrink-0 ' + color + '">' + sign + '¥' + t.amount.toFixed(2) + '</div>' +
                '</div>';
            }).join('');

            if (filtered.length > displayedCount) {
                paginationDiv.classList.remove('hidden');
            } else {
                paginationDiv.classList.add('hidden');
            }
        }

        function loadMoreDetails() {
            displayedCount += 10;
            filterAndRenderDetails();
        }

        async function fetchStats() {
            const token = localStorage.getItem('cfg_secret_token');
            if (!token) return alert('⚠️ 请先配置 API 密钥并保存。');
            
            const btn = document.getElementById('refreshStatsBtn');
            const accContainer = document.getElementById('stat-accounts');
            const detailsContainer = document.getElementById('stat-details');
            
            btn.innerHTML = '⏳ 正在解析 GitHub 账本数据...';
            btn.classList.add('opacity-80', 'pointer-events-none');
            
            try {
                const date = document.getElementById('txDate').value || new Date().toISOString().split('T')[0];
                
                const res = await fetch('/api/stats', {
                    method: 'POST',
                    headers: { 'X-Secret-Token': token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ date })
                });
                
                const data = await res.json();
                if (data.success) {
                    document.getElementById('stat-income').innerText = '¥ ' + data.income.toFixed(2);
                    document.getElementById('stat-expense').innerText = '¥ ' + data.expense.toFixed(2);
                    
                    if (Object.keys(data.accounts).length === 0) {
                        accContainer.innerHTML = '<div class="text-center text-slate-500 py-2">本月暂无资产变动记录</div>';
                    } else {
                        accContainer.innerHTML = Object.entries(data.accounts)
                            .sort((a, b) => b[1] - a[1]) 
                            .map(([acc, amt]) => {
                                const color = amt > 0 ? 'text-emerald-400' : (amt < 0 ? 'text-rose-400' : 'text-slate-400');
                                const sign = amt > 0 ? '+' : '';
                                return '<div class="flex justify-between border-b border-slate-800/50 pb-1 last:border-0"><span class="font-mono text-xs truncate max-w-[70%]" title="' + acc + '">' + acc + '</span><span class="font-mono ' + color + '">' + sign + amt.toFixed(2) + '</span></div>';
                            }).join('');
                    }

                    handleFetchedDetails(data.details);
                } else {
                    accContainer.innerHTML = '<div class="text-rose-400 py-2">获取失败: ' + data.error + '</div>';
                    detailsContainer.innerHTML = '<div class="text-rose-400 py-2">获取失败: ' + data.error + '</div>';
                }
            } catch (err) {
                accContainer.innerHTML = '<div class="text-rose-400 py-2">网络异常: ' + err.message + '</div>';
                detailsContainer.innerHTML = '<div class="text-rose-400 py-2">网络异常: ' + err.message + '</div>';
            } finally {
                btn.innerHTML = '🔄 刷新分析当前月份';
                btn.classList.remove('opacity-80', 'pointer-events-none');
            }
        }
    </script>
</body>
</html>`;
}