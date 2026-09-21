# 财账簿 · 源码说明

本地运行的财务效率桌面应用，数据全程不出本机。

- **技术栈**：Electron（桌面壳）+ 原生 HTML/JS（无打包器）+ SheetJS（Excel 解析/生成）+ ECharts（图表）
- **运行环境**：Windows / Node.js ≥ 18

## 一、如何跑起来

```bash
cd finance-desktop
npm install --registry=https://registry.npmmirror.com   # 装依赖（electron、xlsx、echarts）
# 若 electron 二进制下载失败，设置镜像后重装：
#   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm start                                               # 启动桌面应用
npm run smoke                                           # 无界面冒烟测试（可选）
```

> 压缩包内已去掉 `node_modules`（约 400MB，均为可重新下载的第三方库），拿到源码后先执行上面的 `npm install` 即可。

## 二、目录结构（每个文件是干什么的）

```
finance-desktop/
├── package.json            项目清单：入口 main.js、脚本、依赖
├── main.js                 ★ 主进程：建窗口、单实例锁、账户鉴权与会话、账本读写(IPC)、导出另存对话框
├── auth-core.cjs           ★ 账户安全内核（纯逻辑）：scrypt 加盐哈希、用户名/密码规则、失败锁定
├── preload.js              ★ 桥接层：用 contextBridge 把白名单 API 挂到 window.ledgerAPI / window.authAPI
├── renderer/
│   ├── index.html          页面骨架：侧栏账本与账户区、4 个标签页、登录门、3 个弹窗
│   ├── styles.css          全部样式（主题变量在文件顶部 :root）
│   ├── app.js              ★ 渲染进程入口：启动先过登录门、状态管理、账本 CRUD、导入回调
│   ├── auth-ui.mjs         登录门 UI：登录/注册切换、密码强度条、锁定倒计时、自动登录勾选
│   ├── records-ui.mjs      流水页：增删改查、筛选、分页、补录表单弹窗
│   ├── export-ui.mjs       报表页：导出按钮接线、状态提示
│   ├── charts/
│   │   └── dashboard.mjs   看板：时间范围筛选、ECharts 趋势图/饼图、TOP 榜（纯函数+DOM 分离）
│   ├── ui/
│   │   └── select.mjs      自绘下拉组件（替代本机不稳定的原生 select 弹层）
│   ├── xlsx/
│   │   ├── import-core.mjs ★ 导入核心算法（纯函数）：表头识别、列映射猜测、金额清洗、分类推断
│   │   ├── import-ui.mjs   导入页 UI：拖拽/选文件、Sheet 切换、映射确认表、预览、确认入库
│   │   └── export-core.mjs ★ 报表生成（纯函数）：三张 Sheet 的组装、数字/百分比格式、文件名清洗
│   └── vendor/             离线第三方库（xlsx.full.min.js / echarts.min.js，页面直接用 <script> 引入）
├── test/                   Node 原生断言测试，共 25 组用例
│   ├── auth-core.test.mjs      账户哈希/校验/强度规则/锁定窗口
│   ├── import-core.test.mjs    → node test/import-core.test.mjs
│   ├── dashboard.test.mjs      → node test/dashboard.test.mjs
│   ├── records.test.mjs        → node test/records.test.mjs
│   └── export.test.mjs         → node test/export.test.mjs
└── samples/                两份导入测试用 Excel 样例
```

★ = 最值得先读的核心文件。

## 三、架构要点（读代码前先看这节）

1. **进程模型**：`main.js`（主进程，有文件系统权限）↔ `renderer/`（网页，无权限）。两者只通过 `preload.js` 暴露的 `window.ledgerAPI` / `window.authAPI` 通信（IPC invoke/handle），渲染层拿不到 `require`/`fs`——这是 Electron 安全三件套：`nodeIntegration:false + contextIsolation:true + sandbox:true`。另有**单实例锁**（main.js 顶部）：重复启动会唤起已有窗口，防止两个实例抢缓存目录、互相覆盖账本内存态。
2. **数据存哪**：目录名取自 package.json 的 `productName`，本机实际路径是 `%APPDATA%/财账簿/`：
   - `ledgers/<账本id>.json` —— 每套账本一个文件，`ownerId` 字段绑定账户
   - `accounts/<账户id>.json` —— 每账户一个文件，只存 `salt + scrypt哈希`，永不存明文密码
   - `renderer.log` —— 网页 console 落盘（排障用）

   记录结构：
   ```js
   { id, date:'YYYY-MM-DD', type:'income'|'expense', category, amount, note, source }
   // source: '手动' | 'demo' | 'imp-<批次id>'（批次 id 用于导入历史与一键撤销）
   ```
3. **本机账户体系（阶段 7）**：注册/登录/改密全部在本机完成，安全设计与通用云端方案同内核，只是没有服务器——
   - 口令校验只发生在主进程（`auth-core.cjs`）：`scrypt(N=16384)` + 16 字节随机盐 + `timingSafeEqual` 恒定时间比较，接口层永远不回传哈希
   - 连续 5 次失败锁 60 秒（`checkLock/registerFailure` 纯函数，锁定秒数经 IPC 返回值传给 UI 倒计时——注意 Error 自定义属性过不了 IPC 序列化，所以 auth 用返回对象而非 throw）
   - 会话保存在主进程内存（`session`），所有 `ledger:*` IPC 强制校验 `ownerId`，渲染进程无法伪造身份访问他人账本
   - 自动登录：密码经 Electron `safeStorage`（Windows DPAPI，绑定本机本用户）加密存入账户文件 `encPass`，启动时解密→验哈希→免密进入
   - 第一个注册的账户自动继承升级前的无主历史账本（`migrateLegacyLedgers`）
4. **纯函数与 UI 分离**：`import-core / export-core / dashboard` 里的计算函数不碰 DOM、XLSX 实例作参数注入，因此可以脱离 Electron 直接在 Node 里测试（`test/` 目录）。想改算法，先跑对应测试保证不破坏行为。
5. **导入的三种识别模式**（`import-core.mjs` 的 `guessMapping`）：
   - `twoCol`：收入、支出各一列（银行流水常见）
   - `signed`：一列金额，正数收入负数支出
   - `typeCol`：类型列 + 金额列
   识别出的列映射会显示在"导入"页供你人工纠正后再入库。
6. **本机平台坑（已在代码里规避）**：这台 Win11/Electron 渲染所有原生弹层不稳定（`window.prompt`、`<select>` 下拉、`<datalist>`），替代方案是自绘模态框（app.js 的 `askText`）、分段按钮（补录表单收支类型）、分类芯片，以及通用组件 `ui/select.mjs`（把原生 select 隐藏当数据容器，弹层自绘）。改 UI 时不要重新引入这三种原生控件。另：`app.setPath('gpuCacheDirectory')` 在此 Electron 版本不受支持，调用即崩，勿再尝试。

## 四、常见修改入口速查

| 想改什么 | 改哪里 |
|---|---|
| 密码/用户名规则、锁定策略 | `auth-core.cjs`（常量 `MAX_FAIL` / `LOCK_MS` / `validatePassword`） |
| 登录门界面与交互 | `renderer/auth-ui.mjs` + `index.html` 的 `#auth-mask` 区块 |
| 窗口大小/标题/安全策略 | `main.js` 顶部 `createWindow()` |
| 主题色、布局样式 | `renderer/styles.css` 的 `:root` 变量区 |
| 增删概览卡片/图表 | `renderer/index.html` 结构 + `charts/dashboard.mjs` |
| 导入识别规则（关键字、分类推断） | `xlsx/import-core.mjs` 的 `KEYWORDS` / `CATEGORY_RULES` |
| 报表列、Sheet 内容 | `xlsx/export-core.mjs` |
| 分页大小、筛选器 | `records-ui.mjs` 顶部 `PAGE_SIZE` |
| 新增一个 IPC 能力 | `main.js` 加 `ipcMain.handle` → `preload.js` 加白名单方法 |

改完 `renderer/` 下的文件：窗口里 `Ctrl+R` 刷新即可生效；改 `main.js` / `preload.js`：重启应用生效。

## 五、验证手段

- 全量单测：依次跑 `node test/*.test.mjs`（5 个文件），25 组用例应全部 ✅
- 渲染层报错排查：应用运行时如果界面异常，看 `%APPDATA%/财账簿/renderer.log`（主进程会把网页 console 输出落盘到这里）
