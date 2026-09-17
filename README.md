# TRACE · 美股工作台

用于美股研究和人工交易计划的本地工作台。HTML、CSS、JavaScript 前端，Python 本地数据服务，无需前端构建。

- Yahoo Finance 行情与新闻，自选股和 1M／3M 价格图。
- 交易计划、风险与仓位计算、本地保存、归档和 JSON 导出。
- 示例持仓估值、模拟收益对比，以及可手动切换的固定模拟行情。

## 本地运行

需要 Python 3.9+；运行 JavaScript 测试另需 Node.js 18+。

```sh
git clone https://github.com/mop74720-commits/trace-us-stock-workbench.git
cd trace-us-stock-workbench
python -m pip install -r requirements.txt
python demo/server.py --port 8765
```

浏览器打开 <http://127.0.0.1:8765/>。服务仅监听本机；真实数据需要联网，无需 API Key。`tzdata` 提供美东时区数据，尤其适用于 Windows。

关注列表与计划保存在浏览器的 `trace-demo-v1` 中。继续使用同一浏览器及地址，可保留已有记录。

## 数据范围

行情与新闻来自 Yahoo Finance 公开接口，可能延迟、限流或变更。持仓数量、成本、现金和回测曲线为演示数据。没有接入 AI 推理或券商，交易计划不会执行订单。

## 测试

```sh
node --test demo/logic.test.cjs demo/market.test.cjs demo/live-market.test.cjs
python -m unittest discover -s demo -p test_server.py -v
```

详细功能、数据口径与文件说明见 [demo/README.md](demo/README.md)。
