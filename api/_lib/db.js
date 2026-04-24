import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

/**
 * Authenticate request via x-api-key header.
 * Returns { key_row, error_response }
 */
export async function authenticate(req) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return { key_row: null, error_response: { status: 401, body: { error: 'Missing x-api-key header' } } };
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return { key_row: null, error_response: { status: 403, body: { error: 'Invalid or inactive API key' } } };
  }

  // Check monthly quota
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('api_key_id', data.id)
    .gte('created_at', startOfMonth.toISOString());

  if (count >= data.monthly_quota) {
    return { key_row: data, error_response: { status: 429, body: { error: 'Monthly quota exceeded', quota: data.monthly_quota, used: count } } };
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { key_row: data, error_response: null };
}

/**
 * Log API usage
 */
export async function logUsage(apiKeyId, endpoint, urlRequested, statusCode, responseTimeMs, tokensUsed = 0) {
  await supabase.from('usage_logs').insert({
    api_key_id: apiKeyId,
    endpoint,
    url_requested: urlRequested,
    status_code: statusCode,
    response_time_ms: responseTimeMs,
    tokens_used: tokensUsed
  });
}

/**
 * Check / set cache
 */
export async function getCached(urlHash) {
  const { data } = await supabase
    .from('intelligence_cache')
    .select('*')
    .eq('url_hash', urlHash)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (data) {
    // Increment hit count
    await supabase
      .from('intelligence_cache')
      .update({ hit_count: data.hit_count + 1 })
      .eq('id', data.id);
  }

  return data;
}

export async function setCache(urlHash, url, extractedData, contentType) {
  await supabase.from('intelligence_cache').upsert({
    url_hash: urlHash,
    url,
    extracted_data: extractedData,
    content_type: contentType,
    cached_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    hit_count: 0
  }, { onConflict: 'url_hash' });
}

export { supabase };
