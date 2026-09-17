# TRACE · 美股工作台

用于美股研究、证据阅读和人工交易计划的本地工作台。HTML、CSS、JavaScript 前端，Python 本地数据服务，无需前端构建。

- Yahoo Finance 行情与公司相关新闻，自选股和 1M／3M 价格图。
- 独立 Intelligence Core：公共来源采集、证据版本、来源健康、去重聚合、历史时点回放与确定性精选。
- 交易计划、风险与仓位计算、本地保存、归档和 JSON 导出。
- 示例持仓估值、模拟收益对比，以及可手动切换的固定模拟行情。

TRACE 将真实市场数据和外部情报分成两个数据域：`/api/market` 提供市场上下文，`/api/intelligence/*` 提供来源归因的证据。当前没有把两者自动合成为买卖信号，也没有接入券商。

## 本地运行

需要 Python 3.9+；运行 JavaScript 测试另需 Node.js 18+。

```sh
git clone https://github.com/mop74720-commits/trace-us-stock-workbench.git
cd trace-us-stock-workbench
python -m pip install -r requirements.txt
python demo/server.py --port 8765
```

浏览器打开 <http://127.0.0.1:8765/>。服务仅监听 `127.0.0.1`。真实数据需要联网；默认行情和默认公共情报来源不需要 API Key。`tzdata` 提供美东时区数据，尤其适用于 Windows。

默认 Intelligence Core 使用独立的 `data/intelligence.sqlite3`。当前默认启用 CNBC、MarketWatch、Federal Reserve 与 White House 公共 RSS；X、Telegram、Polymarket、本地 JSONL 等适配器保留但默认关闭。X 只有在来源配置启用且显式传入 `--enable-x-api` 后才允许请求，并需要用户自行提供对应凭据。

常用启动参数：

```sh
# 完全关闭公共情报，仅运行原 TRACE 行情/计划工作台
python demo/server.py --port 8765 --no-intelligence

# 使用单独的情报数据库/配置
python demo/server.py --intel-db data/research-intelligence.sqlite3 \
  --intel-config config/intelligence.sources.json

# 仅在你已确认 API 权限/费用时显式允许已配置的 X 来源
python demo/server.py --enable-x-api
```

关注列表与计划保存在浏览器的 `trace-demo-v1` 中；情报证据存入 SQLite。二者互不覆盖。

## Intelligence API

同一个 TRACE 服务提供：

```text
GET  /api/intelligence
GET  /api/intelligence/brief
GET  /api/intelligence/feed
GET  /api/intelligence/digest
GET  /api/intelligence/evidence/{id}
POST /api/intelligence/collect
```

支持 `assets`、`market`、`person`、`origin`、`mode`、`category`、`source`、`q`、`window`、`offset`、`limit`、`as_of` 等只读筛选。Phase 1 明确不接受 Trader 模拟账户的 `holdings` 参数。

`/api/intelligence/brief` 是产品侧紧凑合同，只包含 `as_of / summary / events / scope / context / evidence_policy`，不会混入模拟行情、持仓或订单。

## 数据与安全边界

Yahoo Finance 行情与 RSS 可能延迟、限流或变更，不保证交易所级实时性。持仓数量、成本、现金和回测曲线仍为演示数据。

Intelligence Core 的证据保留来源、发布时间和首次观察时间；历史 `as_of` 回放不会读取在该时点以后才被系统观察到的证据版本。聚合、多源一致、来源权重和评分只用于研究阅读排序，不代表事实已被独立核实，也不是涨跌概率或交易建议。

外部文本按不可信数据处理；指令样式内容会被隔离。默认没有 LLM 请求、社交发布、登录、私信、券商连接或订单执行。交易计划不会执行订单。

## 测试

```sh
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs demo/intelligence.test.cjs
python -m unittest discover -s demo -p test_server.py -v
python -m unittest discover -s tests -p 'test_*.py' -v
python -m compileall -q trace demo/server.py
```

GitHub Actions 同时在 Python 3.9 / 3.11 与 Node.js 18 上运行这组回归测试。

详细功能、数据口径与文件说明见 [demo/README.md](demo/README.md)。架构规格和实施计划位于 `docs/superpowers/`。
