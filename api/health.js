/**
 * OctoKlaw API — /api/health
 * Public endpoint. No auth required.
 * Returns system status, uptime, and arm connectivity.
 */
export default async function handler(req, res) {
  const started = Date.now();

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Powered-By', 'OctoKlaw');

  res.status(200).json({
    status: 'operational',
    version: '1.0.0',
    mesh: 'OctoKlaw Intelligence API',
    uptime_ms: process.uptime() * 1000,
    timestamp: new Date().toISOString(),
    endpoints: {
      '/api/health': { auth: false, description: 'System health check' },
      '/api/extract': { auth: true, description: 'Extract structured data from any URL' },
      '/api/analyze': { auth: true, description: 'AI-powered content analysis' },
      '/api/usage': { auth: true, description: 'API usage statistics' },
      '/api/keys': { auth: false, description: 'Generate new API key (POST)' }
    },
    response_time_ms: Date.now() - started
  });
}
