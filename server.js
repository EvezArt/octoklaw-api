import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function authenticate(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return { key_row: null, error: { status: 401, body: { error: 'Missing x-api-key header' } } };
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const { data, error } = await supabase.from('api_keys').select('*').eq('key_hash', keyHash).eq('is_active', true).single();
  if (error || !data) return { key_row: null, error: { status: 403, body: { error: 'Invalid or inactive API key' } } };
  const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
  const { count } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true }).eq('api_key_id', data.id).gte('created_at', startOfMonth.toISOString());
  if (count >= data.monthly_quota) return { key_row: data, error: { status: 429, body: { error: 'Monthly quota exceeded', quota: data.monthly_quota, used: count } } };
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  return { key_row: data, error: null };
}

async function logUsage(id, endpoint, url, status, ms, tokens = 0) {
  await supabase.from('usage_logs').insert({ api_key_id: id, endpoint, url_requested: url, status_code: status, response_time_ms: ms, tokens_used: tokens });
}

async function getCached(urlHash) {
  const { data } = await supabase.from('intelligence_cache').select('*').eq('url_hash', urlHash).gt('expires_at', new Date().toISOString()).single();
  if (data) await supabase.from('intelligence_cache').update({ hit_count: data.hit_count + 1 }).eq('id', data.id);
  return data;
}

async function setCache(urlHash, url, extracted, ct) {
  await supabase.from('intelligence_cache').upsert({ url_hash: urlHash, url, extracted_data: extracted, content_type: ct, cached_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), hit_count: 0 }, { onConflict: 'url_hash' });
}

app.get('/api/health', (req, res) => {
  res.setHeader('X-Powered-By', 'OctoKlaw');
  res.json({ status: 'operational', version: '1.0.0', mesh: 'OctoKlaw Intelligence API', uptime_ms: process.uptime() * 1000, timestamp: new Date().toISOString() });
});

app.post('/api/keys', async (req, res) => {
  res.setHeader('X-Powered-By', 'OctoKlaw');
  const { name, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing required field: name' });
  try {
    const rawKey = `ok_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const { data, error } = await supabase.from('api_keys').insert({ key_hash: keyHash, name, owner_email: email || null, tier: 'free', rate_limit_per_min: 60, monthly_quota: 1000 }).select('id, name, tier, rate_limit_per_min, monthly_quota, created_at').single();
    if (error) throw error;
    res.status(201).json({ message: 'API key created. Store it securely.', api_key: rawKey, key_id: data.id, name: data.name, tier: data.tier, limits: { rate_per_minute: data.rate_limit_per_min, monthly_quota: data.monthly_quota }, created_at: data.created_at });
  } catch (err) { res.status(500).json({ error: 'Key generation failed', message: err.message }); }
});

app.post('/api/extract', async (req, res) => {
  res.setHeader('X-Powered-By', 'OctoKlaw');
  const started = Date.now();
  const { key_row, error } = await authenticate(req);
  if (error) return res.status(error.status).json(error.body);
  const { url, selectors = ['title', 'meta', 'headings', 'links', 'text'] } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing required field: url' });
  try {
    const urlHash = createHash('sha256').update(url).digest('hex');
    const cached = await getCached(urlHash);
    if (cached) { await logUsage(key_row.id, '/api/extract', url, 200, Date.now() - started); return res.json({ source: 'cache', url, data: cached.extracted_data, response_time_ms: Date.now() - started }); }
    const fr = await fetch(url, { headers: { 'User-Agent': 'OctoKlaw/1.0' }, signal: AbortSignal.timeout(15000) });
    const ct = fr.headers.get('content-type') || 'unknown'; const body = await fr.text(); const extracted = {};
    if (selectors.includes('title')) { const m = body.match(/<title[^>]*>(.*?)<\/title>/si); extracted.title = m ? m[1].trim() : null; }
    if (selectors.includes('meta')) { extracted.meta = {}; const r = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi; let m; while ((m = r.exec(body))) extracted.meta[m[1]] = m[2]; }
    if (selectors.includes('headings')) { extracted.headings = []; const r = /<h([1-6])[^>]*>(.*?)<\/h\1>/gis; let m; while ((m = r.exec(body))) extracted.headings.push({ level: +m[1], text: m[2].replace(/<[^>]+>/g,'').trim() }); }
    if (selectors.includes('links')) { extracted.links = []; const r = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis; let m, c=0; while ((m=r.exec(body)) && c<100) { extracted.links.push({ href:m[1], text:m[2].replace(/<[^>]+>/g,'').trim() }); c++; } }
    if (selectors.includes('text')) { const s = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); extracted.text_preview = s.substring(0,2000); extracted.text_length = s.length; }
    await setCache(urlHash, url, extracted, ct); const ms = Date.now()-started;
    await logUsage(key_row.id, '/api/extract', url, 200, ms);
    res.json({ source: 'live', url, content_type: ct, data: extracted, response_time_ms: ms });
  } catch (err) { await logUsage(key_row.id, '/api/extract', url, 500, Date.now()-started); res.status(500).json({ error: 'Extraction failed', message: err.message }); }
});

app.post('/api/analyze', async (req, res) => {
  res.setHeader('X-Powered-By', 'OctoKlaw');
  const started = Date.now();
  const { key_row, error } = await authenticate(req);
  if (error) return res.status(error.status).json(error.body);
  let { text, url } = req.body || {};
  try {
    if (url && !text) { const fr = await fetch(url, { headers: {'User-Agent':'OctoKlaw/1.0'}, signal: AbortSignal.timeout(15000) }); const html = await fr.text(); text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,5000); }
    if (!text) return res.status(400).json({ error: 'Provide either "url" or "text"' });
    const words = text.split(/\s+/), wc = words.length;
    const pos = new Set(['good','great','excellent','amazing','wonderful','fantastic','love','best','happy','success','win','profit','growth','innovative','powerful','impressive','outstanding','brilliant']);
    const neg = new Set(['bad','terrible','awful','horrible','hate','worst','fail','loss','crash','decline','problem','issue','risk','threat','danger','poor','weak','broken','critical','severe']);
    let p=0,n=0; const lw = words.map(w=>w.toLowerCase().replace(/[^a-z]/g,''));
    lw.forEach(w=>{if(pos.has(w))p++;if(neg.has(w))n++;});
    const sc = wc>0?(p-n)/Math.sqrt(wc):0;
    const sentiment = sc>0.1?'positive':sc<-0.1?'negative':'neutral';
    const entities = { emails:[...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)||[])], urls:[...new Set(text.match(/https?:\/\/[^\s<>"{}|]+/g)||[])].slice(0,20), prices:[...new Set(text.match(/\$[\d,]+\.?\d*/g)||[])] };
    const stop = new Set('the a an is are was were be been have has had do does did will would could should may might to of in for on with at by from and but or not'.split(' '));
    const freq={}; lw.filter(w=>w.length>2&&!stop.has(w)).forEach(w=>{freq[w]=(freq[w]||0)+1;});
    const keywords = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([word,count])=>({word,count,tf:+(count/wc).toFixed(4)}));
    const techS=lw.filter(w=>['api','code','software','data','server','deploy','cloud','database'].includes(w)).length;
    const finS=lw.filter(w=>['price','market','stock','revenue','invest','profit','trading','financial'].includes(w)).length;
    const cat = techS>finS?'technology':finS>techS?'finance':'general';
    const sentences=text.match(/[^.!?]+[.!?]+/g)||[text.substring(0,200)];
    const summary=sentences.slice(0,3).join(' ').trim();
    const ms=Date.now()-started; await logUsage(key_row.id,'/api/analyze',url||'(text)',200,ms,wc);
    res.json({ analysis:{ word_count:wc, sentiment:{label:sentiment,score:+sc.toFixed(3),positive_signals:p,negative_signals:n}, category:cat, keywords, entities, summary }, source:url||'text_input', response_time_ms:ms });
  } catch(err) { await logUsage(key_row.id,'/api/analyze',url||'(error)',500,Date.now()-started); res.status(500).json({error:'Analysis failed',message:err.message}); }
});

app.get('/api/usage', async (req, res) => {
  res.setHeader('X-Powered-By', 'OctoKlaw');
  const { key_row, error } = await authenticate(req);
  if (error) return res.status(error.status).json(error.body);
  try {
    const now=new Date(), som=new Date(now.getFullYear(),now.getMonth(),1), sod=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const {count:mc}=await supabase.from('usage_logs').select('*',{count:'exact',head:true}).eq('api_key_id',key_row.id).gte('created_at',som.toISOString());
    const {count:tc}=await supabase.from('usage_logs').select('*',{count:'exact',head:true}).eq('api_key_id',key_row.id).gte('created_at',sod.toISOString());
    const {data:ad}=await supabase.from('usage_logs').select('response_time_ms').eq('api_key_id',key_row.id).gte('created_at',som.toISOString()).limit(1000);
    const avg=ad?.length?Math.round(ad.reduce((s,r)=>s+(r.response_time_ms||0),0)/ad.length):0;
    res.json({ key:{id:key_row.id,name:key_row.name,tier:key_row.tier}, usage:{today:tc||0,this_month:mc||0,monthly_quota:key_row.monthly_quota,remaining:key_row.monthly_quota-(mc||0),avg_response_time_ms:avg} });
  } catch(err) { res.status(500).json({error:'Usage fetch failed',message:err.message}); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🐙 OctoKlaw API running on :${PORT}`));
