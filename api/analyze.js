import { authenticate, logUsage } from './_lib/db.js';

/**
 * OctoKlaw API — /api/analyze
 * AI-powered content analysis: sentiment, entities, summary, classification.
 *
 * POST body: { "url": "https://..." } or { "text": "..." }
 * Returns: structured analysis
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Powered-By', 'OctoKlaw');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  const started = Date.now();
  const { key_row, error_response } = await authenticate(req);
  if (error_response) return res.status(error_response.status).json(error_response.body);

  let { text, url } = req.body || {};

  try {
    if (url && !text) {
      const fetchRes = await fetch(url, {
        headers: { 'User-Agent': 'OctoKlaw/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      const html = await fetchRes.text();
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
    }

    if (!text) {
      return res.status(400).json({ error: 'Provide either "url" or "text"' });
    }

    const words = text.split(/\s+/);
    const wordCount = words.length;

    const positiveWords = new Set(['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'best', 'happy', 'success', 'win', 'profit', 'growth', 'innovative', 'breakthrough', 'revolutionary', 'powerful', 'impressive', 'outstanding', 'brilliant']);
    const negativeWords = new Set(['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'fail', 'loss', 'crash', 'decline', 'problem', 'issue', 'risk', 'threat', 'danger', 'poor', 'weak', 'broken', 'critical', 'severe']);

    let posCount = 0, negCount = 0;
    const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
    lowerWords.forEach(w => {
      if (positiveWords.has(w)) posCount++;
      if (negativeWords.has(w)) negCount++;
    });

    const sentimentScore = wordCount > 0 ? (posCount - negCount) / Math.sqrt(wordCount) : 0;
    const sentiment = sentimentScore > 0.1 ? 'positive' : sentimentScore < -0.1 ? 'negative' : 'neutral';

    const entities = {
      emails: [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [])],
      urls: [...new Set(text.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/g) || [])].slice(0, 20),
      prices: [...new Set(text.match(/\$[\d,]+\.?\d*/g) || [])],
      dates: [...new Set(text.match(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s*\d{0,4}/gi) || [])].slice(0, 20),
      numbers: [...new Set(text.match(/\b\d{4,}\b/g) || [])].slice(0, 20)
    };

    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off', 'up', 'down', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they', 'them', 'we', 'us', 'i', 'me', 'my', 'your', 'his', 'her', 'their', 'our']);
    const freq = {};
    lowerWords.filter(w => w.length > 2 && !stopWords.has(w)).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count, tf: +(count / wordCount).toFixed(4) }));

    const techWords = ['api', 'code', 'software', 'algorithm', 'data', 'server', 'deploy', 'cloud', 'database', 'function'];
    const finWords = ['price', 'market', 'stock', 'revenue', 'invest', 'profit', 'trading', 'financial', 'dollar', 'fund'];
    const newsWords = ['breaking', 'report', 'announced', 'according', 'official', 'statement', 'update', 'press'];

    const techScore = lowerWords.filter(w => techWords.includes(w)).length;
    const finScore = lowerWords.filter(w => finWords.includes(w)).length;
    const newsScore = lowerWords.filter(w => newsWords.includes(w)).length;

    const maxScore = Math.max(techScore, finScore, newsScore, 1);
    const category = techScore === maxScore ? 'technology' : finScore === maxScore ? 'finance' : newsScore === maxScore ? 'news' : 'general';

    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text.substring(0, 200)];
    const summary = sentences.slice(0, 3).join(' ').trim();

    const responseTimeMs = Date.now() - started;
    await logUsage(key_row.id, '/api/analyze', url || '(text input)', 200, responseTimeMs, wordCount);

    res.status(200).json({
      analysis: {
        word_count: wordCount,
        sentiment: { label: sentiment, score: +sentimentScore.toFixed(3), positive_signals: posCount, negative_signals: negCount },
        category,
        keywords,
        entities,
        summary
      },
      source: url || 'text_input',
      response_time_ms: responseTimeMs
    });

  } catch (err) {
    await logUsage(key_row.id, '/api/analyze', url || '(error)', 500, Date.now() - started);
    res.status(500).json({ error: 'Analysis failed', message: err.message });
  }
}
