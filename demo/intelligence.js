'use strict';

(function(root) {
  let brief = null;
  let status = null;
  let loading = false;
  let error = '';
  let filters = {assets:'', market:'us', person:'', origin:'all'};

  function emit() {
    root.dispatchEvent(new CustomEvent('trace-intelligence'));
  }

  function queryString() {
    const params = new URLSearchParams();
    for (const [key,value] of Object.entries(filters)) {
      if (value !== '' && !(key === 'origin' && value === 'all')) params.set(key,value);
    }
    return params.toString();
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {...options, signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw new Error('http_'+response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function validBrief(value) {
    return value && typeof value === 'object' && !('market' in value)
      && Array.isArray(value.events) && value.summary && value.scope && value.context
      && value.evidence_policy === 'source_attributed_unverified';
  }

  async function refresh() {
    loading = true;
    error = '';
    emit();
    try {
      const query = queryString();
      const suffix = query ? '?' + query : '';
      const [nextBrief, rootPayload] = await Promise.all([
        request('/api/intelligence/brief' + suffix),
        request('/api/intelligence' + suffix),
      ]);
      if (!validBrief(nextBrief) || !rootPayload || !rootPayload.status) throw new Error('invalid_payload');
      brief = nextBrief;
      status = rootPayload.status;
    } catch (_) {
      error = '情报服务暂不可用，请稍后重试。';
    } finally {
      loading = false;
      emit();
    }
  }

  async function collect() {
    error = '';
    emit();
    try {
      await request('/api/intelligence/collect', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:'{}',
      });
      await refresh();
    } catch (_) {
      error = '情报采集请求失败，请稍后重试。';
      emit();
    }
  }

  function setFilters(next) {
    const allowed = ['assets','market','person','origin'];
    const updated = {...filters};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(next,key)) updated[key] = String(next[key] ?? '');
    }
    filters = updated;
  }

  function formatVerification(value) {
    if (value === 'unverified') return '未核实';
    if (value === 'market_quote') return '市场报价';
    return '状态未知';
  }

  const api = {refresh, collect, setFilters, formatVerification};
  Object.defineProperties(api, {
    brief:{get:()=>brief},
    status:{get:()=>status},
    loading:{get:()=>loading},
    error:{get:()=>error},
    filters:{get:()=>({...filters})},
  });
  root.TraceIntelligence = api;

  function installView() {
    if (typeof pageNames === 'undefined' || typeof render !== 'function' || typeof nav !== 'function') return;
    icons.intelligence = '<path d="M4 5h16v14H4zM7 9h10M7 13h7M7 17h4"/>';
    pageNames.intelligence = '情报';
    let initialized = false;
    const baseRender = render;

    function intelTime(value) {
      if (!Number.isFinite(value)) return '—';
      return etTime(new Date(value * 1000).toISOString());
    }

    function healthLabel(value) {
      return ({healthy:'正常',degraded:'降级',pending:'待采集',stale:'过期',error:'错误',disabled:'关闭'})[value] || '未知';
    }

    function sourceHealth() {
      const sources = api.status?.sources || [];
      if (!sources.length) return '<div class="empty"><p>暂无来源状态。</p></div>';
      return `<div class="table-wrap"><table><thead><tr><th>来源</th><th>类型</th><th>状态</th><th>覆盖</th><th>最近成功</th></tr></thead><tbody>${sources.map(source => `<tr><td><strong>${esc(source.name)}</strong><div class="muted">${esc(source.id)}</div></td><td>${esc(source.kind)}</td><td><span class="badge ${source.health === 'healthy' ? 'up' : source.health === 'disabled' ? '' : 'warn'}">${healthLabel(source.health)}</span></td><td class="muted">${esc(source.coverage || '尚未采集')}</td><td class="number">${Number.isFinite(source.last_success) ? intelTime(source.last_success) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function evidenceList(event) {
      const rows = Array.isArray(event.evidence) ? event.evidence : [];
      if (!rows.length) return '<p class="muted">暂无可展示证据。</p>';
      return rows.map(item => `<article><div><a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source || item.source_id)} ↗</a> <span class="badge">${esc(item.tier || 'unrated')}</span></div><p>${esc(item.quote || '')}</p><span class="muted">发布 ${intelTime(item.published_at)} · 首次观察 ${intelTime(item.observed_at)}</span></article>`).join('');
    }

    function eventList() {
      const rows = api.brief?.events || [];
      if (!rows.length) return `<div class="empty"><h3>暂无入选情报</h3><p>${api.loading ? '正在读取证据库…' : '当前筛选范围内没有达到展示条件的事件。可查看来源状态或请求新一轮采集。'}</p></div>`;
      return `<div class="news-list">${rows.map(event => `<article><div class="chips"><span class="badge blue">${esc((event.assets || []).join(' · ') || event.category || '市场')}</span><span class="badge ${event.verification === 'unverified' ? 'warn' : ''}">${api.formatVerification(event.verification)}</span>${event.possible_conflict ? '<span class="badge warn">可能冲突</span>' : ''}</div><h3>${esc(event.title)}</h3><p>${esc(event.summary || '')}</p><div class="muted">发布 ${intelTime(event.published_at)} · 首次观察 ${intelTime(event.observed_at)} · ${Number(event.independent_reports || 0)} 个独立来源组</div><details><summary>查看证据（${Number(event.evidence_count || 0)}）</summary>${evidenceList(event)}</details></article>`).join('')}</div>`;
    }

    function intelligencePage() {
      const current = api.filters;
      const summary = api.brief?.summary || {selected_reports:0,related_reports:0,quotes:0,source_health:api.status?.health || 'pending'};
      const notice = api.error ? `<div class="data-status warning"><span>${esc(api.error)}</span><button class="btn secondary" data-intel-retry>重试</button></div>`
        : `<div class="notice">情报只用于研究阅读：多源一致不等于事实已核实；人物发言不自动映射股票，也不生成买卖指令。证据与真实 Yahoo 行情保持独立。</div>`;
      const form = `<form id="intel-filters" class="toolbar"><div class="chips"><label class="small">关注资产 <input class="search" name="assets" maxlength="100" value="${esc(current.assets)}" placeholder="NVDA, MSFT"></label><label class="small">人物 <select name="person"><option value="">全部</option><option value="trump" ${current.person==='trump'?'selected':''}>Trump</option><option value="musk" ${current.person==='musk'?'selected':''}>Musk</option><option value="powell" ${current.person==='powell'?'selected':''}>Powell</option></select></label><label class="small">来源形态 <select name="origin"><option value="all">全部</option><option value="report" ${current.origin==='report'?'selected':''}>报道 / 公告</option><option value="account_post" ${current.origin==='account_post'?'selected':''}>账号原帖</option><option value="imported_post" ${current.origin==='imported_post'?'selected':''}>导入社交帖</option></select></label></div><button class="btn secondary" type="submit">应用筛选</button></form>`;
      const stats = `<div class="market-strip"><div class="market-tile"><div class="tile-label">精选</div><div class="tile-bottom"><strong class="tile-price number">${Number(summary.selected_reports || 0)}</strong></div><small>规则筛选，不是真实概率</small></div><div class="market-tile"><div class="tile-label">相关报道</div><div class="tile-bottom"><strong class="tile-price number">${Number(summary.related_reports || 0)}</strong></div><small>当前 24h 阅读范围</small></div><div class="market-tile"><div class="tile-label">市场报价</div><div class="tile-bottom"><strong class="tile-price number">${Number(summary.quotes || 0)}</strong></div><small>独立于新闻事实</small></div><div class="market-tile"><div class="tile-label">来源健康</div><div class="tile-bottom"><strong class="tile-price">${healthLabel(summary.source_health)}</strong></div><small>${api.brief ? '截至 ' + intelTime(api.brief.as_of) : '等待数据'}</small></div></div>`;
      return heading('情报', `<div class="table-actions"><button class="btn secondary" data-intel-retry ${api.loading?'disabled':''}>刷新视图</button><button class="btn" data-intel-collect ${api.loading?'disabled':''}>请求采集</button></div>`, '可追溯证据、人物与政策信息、历史可用时间')
        + notice + form + stats
        + `<div class="portfolio-grid"><section class="panel">${panelHeader('情报事件','<span class="muted">source-attributed · unverified</span>',api.brief?.events?.length || 0)}<div class="panel-body">${eventList()}</div></section><section class="panel">${panelHeader('来源健康',`<span class="badge ${api.status?.health==='healthy'?'up':'warn'}">${healthLabel(api.status?.health)}</span>`)}${sourceHealth()}</section></div>`;
    }

    render = function() {
      if (page !== 'intelligence') return baseRender();
      syncAccount();
      document.getElementById('data-mode').value=TraceMarket.mode;
      document.getElementById('refresh-data').disabled=TraceMarket.loading || !isLive();
      document.getElementById('refresh-data').textContent=TraceMarket.loading?'加载中…':'刷新';
      document.getElementById('data-footer').textContent=isLive()?'Yahoo Finance · '+(TraceMarket.loading?'加载中':('请求 '+etTime(TraceMarket.fetchedAt))) : '固定模拟样本 · 2026-09-17';
      nav();
      main.innerHTML=intelligencePage();
      if (!initialized) {
        initialized=true;
        if (!api.filters.assets) {
          const assets=state.watch.map(id=>events.find(item=>item.id===id)?.ticker).filter(Boolean).join(', ');
          api.setFilters({assets});
        }
        api.refresh();
      }
    };

    root.addEventListener('trace-intelligence',()=>{ if (page==='intelligence') render(); });
    document.addEventListener('submit',event=>{
      if (event.target.id!=='intel-filters') return;
      event.preventDefault();
      const data=new FormData(event.target);
      api.setFilters({assets:data.get('assets'),market:'us',person:data.get('person'),origin:data.get('origin')});
      api.refresh();
    });
    document.addEventListener('click',event=>{
      const button=event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-intel-collect')) api.collect();
      else if (button.hasAttribute('data-intel-retry')) api.refresh();
    });
    if (location.hash==='#intelligence') navigate(); else nav();
  }

  if (typeof root.addEventListener === 'function') root.addEventListener('DOMContentLoaded', installView);
})(window);
