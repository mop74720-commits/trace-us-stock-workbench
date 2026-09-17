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
})(window);
