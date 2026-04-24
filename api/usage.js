import { authenticate, supabase } from './_lib/db.js';

/**
 * OctoKlaw API — /api/usage
 * GET: Returns usage statistics for the authenticated API key
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Powered-By', 'OctoKlaw');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET required' });
  }

  const { key_row, error_response } = await authenticate(req);
  if (error_response) return res.status(error_response.status).json(error_response.body);

  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const { count: monthlyCount } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('api_key_id', key_row.id)
      .gte('created_at', startOfMonth.toISOString());

    const { count: todayCount } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('api_key_id', key_row.id)
      .gte('created_at', startOfDay.toISOString());

    const { data: avgData } = await supabase
      .from('usage_logs')
      .select('response_time_ms')
      .eq('api_key_id', key_row.id)
      .gte('created_at', startOfMonth.toISOString())
      .limit(1000);

    const avgResponseTime = avgData && avgData.length > 0
      ? Math.round(avgData.reduce((sum, r) => sum + (r.response_time_ms || 0), 0) / avgData.length)
      : 0;

    res.status(200).json({
      key: {
        id: key_row.id,
        name: key_row.name,
        tier: key_row.tier,
        created_at: key_row.created_at
      },
      usage: {
        today: todayCount || 0,
        this_month: monthlyCount || 0,
        monthly_quota: key_row.monthly_quota,
        remaining: key_row.monthly_quota - (monthlyCount || 0),
        avg_response_time_ms: avgResponseTime
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Usage fetch failed', message: err.message });
  }
}
