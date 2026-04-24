import { supabase } from './_lib/db.js';
import { createHash, randomBytes } from 'crypto';

/**
 * OctoKlaw API — /api/keys
 * POST: Generate a new API key
 * Body: { "name": "My App", "email": "user@example.com" }
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Powered-By', 'OctoKlaw');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required', usage: 'POST { "name": "My App", "email": "user@example.com" }' });
  }

  const { name, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing required field: name' });

  try {
    // Generate API key: ok_ prefix + 32 random hex chars
    const rawKey = `ok_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        key_hash: keyHash,
        name,
        owner_email: email || null,
        tier: 'free',
        rate_limit_per_min: 60,
        monthly_quota: 1000
      })
      .select('id, name, tier, rate_limit_per_min, monthly_quota, created_at')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'API key created. Store it securely — it cannot be retrieved again.',
      api_key: rawKey,
      key_id: data.id,
      name: data.name,
      tier: data.tier,
      limits: {
        rate_per_minute: data.rate_limit_per_min,
        monthly_quota: data.monthly_quota
      },
      created_at: data.created_at
    });

  } catch (err) {
    res.status(500).json({ error: 'Key generation failed', message: err.message });
  }
}
