import { authenticate, logUsage, getCached, setCache } from './_lib/db.js';
import { createHash } from 'crypto';

/**
 * OctoKlaw API — /api/extract
 * Extract structured intelligence from any URL.
 * 
 * POST body: { "url": "https://...", "selectors": ["title", "meta", "headings", "links", "images", "text"] }
 * Returns: structured extraction with caching (24h TTL)
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Powered-By', 'OctoKlaw');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required', usage: 'POST { "url": "https://..." }' });
  }

  const started = Date.now();
  const { key_row, error_response } = await authenticate(req);
  if (error_response) return res.status(error_response.status).json(error_response.body);

  const { url, selectors = ['title', 'meta', 'headings', 'links', 'text'] } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Missing required field: url' });

  try {
    const urlHash = createHash('sha256').update(url).digest('hex');
    const cached = await getCached(urlHash);
    if (cached) {
      await logUsage(key_row.id, '/api/extract', url, 200, Date.now() - started);
      return res.status(200).json({
        source: 'cache',
        url,
        data: cached.extracted_data,
        cached_at: cached.cached_at,
        expires_at: cached.expires_at,
        response_time_ms: Date.now() - started
      });
    }

    const fetchRes = await fetch(url, {
      headers: {
        'User-Agent': 'OctoKlaw/1.0 (+https://octoklaw.vercel.app)',
        'Accept': 'text/html,application/json,text/plain;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(15000)
    });

    const contentType = fetchRes.headers.get('content-type') || 'unknown';
    const body = await fetchRes.text();
    const extracted = {};

    if (selectors.includes('title')) {
      const titleMatch = body.match(/<title[^>]*>(.*?)<\/title>/si);
      extracted.title = titleMatch ? titleMatch[1].trim() : null;
    }

    if (selectors.includes('meta')) {
      extracted.meta = {};
      const metaRegex = /<meta\s+(?:name|property)=["']([^"']+)["']\s+content=["']([^"']+)["']/gi;
      let match;
      while ((match = metaRegex.exec(body)) !== null) {
        extracted.meta[match[1]] = match[2];
      }
    }

    if (selectors.includes('headings')) {
      extracted.headings = [];
      const hRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gis;
      let match;
      while ((match = hRegex.exec(body)) !== null) {
        extracted.headings.push({ level: parseInt(match[1]), text: match[2].replace(/<[^>]+>/g, '').trim() });
      }
    }

    if (selectors.includes('links')) {
      extracted.links = [];
      const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
      let match;
      let count = 0;
      while ((match = linkRegex.exec(body)) !== null && count < 100) {
        extracted.links.push({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() });
        count++;
      }
    }

    if (selectors.includes('images')) {
      extracted.images = [];
      const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*/gi;
      let match;
      let count = 0;
      while ((match = imgRegex.exec(body)) !== null && count < 50) {
        const altMatch = match[0].match(/alt=["']([^"']*?)["']/i);
        extracted.images.push({ src: match[1], alt: altMatch ? altMatch[1] : null });
        count++;
      }
    }

    if (selectors.includes('text')) {
      const stripped = body
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      extracted.text_preview = stripped.substring(0, 2000);
      extracted.text_length = stripped.length;
    }

    await setCache(urlHash, url, extracted, contentType);
    const responseTimeMs = Date.now() - started;
    await logUsage(key_row.id, '/api/extract', url, 200, responseTimeMs);

    res.status(200).json({
      source: 'live',
      url,
      content_type: contentType,
      data: extracted,
      response_time_ms: responseTimeMs
    });

  } catch (err) {
    const responseTimeMs = Date.now() - started;
    await logUsage(key_row.id, '/api/extract', url, 500, responseTimeMs);
    res.status(500).json({ error: 'Extraction failed', message: err.message, response_time_ms: responseTimeMs });
  }
}
