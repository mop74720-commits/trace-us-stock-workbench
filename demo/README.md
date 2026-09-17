# TRACE · 美股工作台 Demo

TRACE 是一个本地运行的美股研究工作台：真实行情通过 Python 服务读取 Yahoo Finance；独立 Intelligence Core 读取公共信息源并保留可追溯证据。两类数据在 Phase 1 中保持分离，不自动生成买卖信号。

## 打开

在项目根目录安装依赖并启动服务（Python 3.9+）：

```powershell
python -m pip install -r requirements.txt
python demo/server.py --port 8765
```

访问 http://127.0.0.1:8765 。服务只监听本机。旧的 `python -m http.server` 只能提供静态文件，不能提供行情或情报 API。

如只想运行原行情工作台：

```powershell
python demo/server.py --port 8765 --no-intelligence
```

情报数据库默认位于 `data/intelligence.sqlite3`，可通过 `--intel-db` 指定新文件。来源配置默认读取 `config/intelligence.sources.json`。

## 已实现

### 市场工作台

- SPY／QQQ／IWM 行情摘要、价格图、自选股、相关新闻、待处理计划。
- 自选股与行情联动，1M／3M 切换；价格图支持鼠标和左右方向键查看数据。
- 真实模式支持 SPY、QQQ、IWM、NVDA、MSFT、AMD、AAPL、TSLA；报价、涨跌幅及价格图来自同一 Yahoo chart 响应。
- 昨收取报价日期之前的最近交易日收盘；不会把三个月区间的 `chartPreviousClose` 误当昨收。
- 报价时间以美东时间显示，并与本地请求时间区分；来源、延迟说明和旧缓存状态可见。
- Yahoo Finance RSS 新闻按 GUID 合并重复项，保留原标题、发布时间、域名及原文链接。
- 交易计划支持参考价、失效价、风险预算、整股仓位、现金及单股上限；计划本地保存、归档和 JSON 导出。
- 示例持仓数量、成本和现金仍为演示样本；A/B 收益曲线仍为虚构展示。

### 情报工作台

新增 `#intelligence` 页面。浏览器通过 `TraceIntelligence` 读取同源 API，不直接访问外部来源。

页面展示：

- 当前精选事件、相关报道和市场报价计数；
- 当前来源健康；
- 关注资产、人物与来源形态筛选；
- 事件标题、摘要、发布时间、首次观察时间；
- `未核实` / `市场报价` 状态；
- 可能冲突提示；
- 每个事件背后的证据来源、摘录和原始链接；
- 手动请求采集与刷新。

人物筛选只表示内容相关或账号归因。Trump 被提及不等于 `DJT`，Musk 被提及不等于 `TSLA`。媒体报道人物发言与经过账号作者校验的原帖分开标注。

## Intelligence Core

默认启用的公共研究来源：

- CNBC RSS；
- MarketWatch RSS；
- Federal Reserve RSS；
- White House RSS。

保留但默认关闭的适配器包括 X、Telegram 公共预览、Polymarket、CoinDesk 和本地 JSONL。

X 默认不会联网。要允许某个已在配置中启用的 X 来源，除了提供对应环境变量外还必须显式启动：

```powershell
python demo/server.py --enable-x-api
```

这个开关只允许读取已配置来源，不会发布、点赞、关注、私信或下单。

### 证据与时间语义

每份标准证据至少保留：来源、外部 ID、内容版本、来源链接、发布时间、首次观察时间、资产/主题标签和处理器版本。

- `published_at`：来源声明的发布时间；缺失时不会猜测。
- `observed_at` / `first_observed_at`：TRACE 实际获得该证据版本的时间。
- 内容发生变化时追加新版本，不覆盖旧版本。
- 内容未变化只增加观察记录，不创建新内容版本。
- 历史 `as_of` 查询只读取在截止时点之前已经被 TRACE 观察到的版本；后续修订不会倒填到过去。
- 来源失败可保留最后一次成功证据，但不会延长证据本身的有效期。

转载去重、标题相似聚合、来源权重、相关性和精选阈值都是透明的阅读排序规则，不是事实核查概率。多源一致也保持 `unverified`。

外部文本被视为不可信输入。明显的提示词注入、要求泄露密钥或绕过风控等指令样式文本会被隔离，不进入摘要。

## HTTP API

原有接口保持不变：

```text
GET /api/health
GET /api/market
GET /api/news
```

新增：

```text
GET  /api/intelligence
GET  /api/intelligence/brief
GET  /api/intelligence/feed
GET  /api/intelligence/digest
GET  /api/intelligence/evidence/{id}
POST /api/intelligence/collect
```

常用只读筛选：

```text
assets=NVDA,MSFT
market=us|all
person=trump|musk|powell
origin=all|report|account_post|imported_post
mode=selected|timeline|quotes
window=24h|7d
category=...
source=...
q=...
offset=0
limit=30
as_of=带时区的 ISO-8601 时间
```

Phase 1 不接受 `holdings` 参数。非法时间、枚举、重复参数或越界分页返回 4xx，而不是自动纠正。

`GET /api/intelligence/brief` 的固定顶层合同：

```json
{
  "as_of": 0,
  "summary": {},
  "events": [],
  "scope": {},
  "context": {},
  "evidence_policy": "source_attributed_unverified"
}
```

这里故意没有 `market`、`positions`、`orders` 或 synthetic price。真实市场上下文仍由 `/api/market` 独立提供；未来的 `DecisionContext` 才会显式组合两个数据域。

`POST /api/intelligence/collect` 只接受同源本地 JSON POST。它只是请求采集线程执行一轮调度，不在 HTTP 请求线程里长时间抓取外部来源。

## 数据与安全边界

Yahoo Finance 行情与新闻可能延迟、限流或变更；不保证交易所级实时性。日线 `close` 不是包含分红的总回报序列。

情报来源健康只表示最近抓取/解析状态，不代表信息完整、真实或来源一定有新内容。公共 RSS 也不是全站全文档案，停机跨过上游窗口时可能缺历史消息。

当前没有 LLM 推理、券商、真实订单、自动交易或“某条新闻导致某只股票涨跌”的因果推断。持仓、买入成本、现金与回测曲线仍是演示样本；计划不是订单。

服务只监听 `127.0.0.1`。行情缓存仍是内存缓存：行情 60 秒、Yahoo 新闻 300 秒；失败时已有缓存标为旧数据，无缓存则显示不可用，不回退到虚构实时价格。情报证据使用独立 SQLite 持久化。

## 文件

- `index.html`：页面入口。
- `styles.css`：响应式视觉样式。
- `app.js`：原 TRACE 市场、计划、持仓和回测交互。
- `intelligence.js`：情报数据客户端与 `#intelligence` 页面扩展；不修改 `TraceMarket` 状态。
- `server.py`：同源静态服务、Yahoo 行情/新闻、Intelligence 生命周期和 API。
- `market.js`：真实行情加载、模式切换与失败处理。
- `market-demo.js`：固定模拟价格序列，只在显式选择模拟模式时使用。
- `logic.js`：独立数字计算。
- `../trace/intelligence/`：来源、处理、精选、证据存储和历史回放。
- `../trace/contracts/intelligence.py`：产品 API 参数与 brief 合同。

原有地址 `#overview`、`#evidence`、`#plans`、`#portfolio`、`#experiments` 保持可用；新增 `#intelligence`。

## 测试

```powershell
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs demo/intelligence.test.cjs
python -m unittest discover -s demo -p test_server.py -v
python -m unittest discover -s tests -p 'test_*.py' -v
python -m compileall -q trace demo/server.py
```

GitHub Actions 在 Python 3.9 / 3.11 和 Node.js 18 上执行同一组测试。
