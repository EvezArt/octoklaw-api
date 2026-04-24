# OctoKlaw Intelligence API

> Web intelligence as a service. Extract, analyze, and monitor any URL.

[![Deployed on Vercel](https://img.shields.io/badge/deployed-vercel-black)](https://octoklaw-api.vercel.app)
[![Powered by Supabase](https://img.shields.io/badge/powered%20by-supabase-green)](https://supabase.com)

## Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | No | System status and endpoint directory |
| `/api/keys` | POST | No | Generate a new API key |
| `/api/extract` | POST | Yes | Extract structured data from any URL |
| `/api/analyze` | POST | Yes | AI-powered content analysis (sentiment, entities, keywords) |
| `/api/usage` | GET | Yes | View your API usage statistics |

## Quick Start

```bash
# 1. Get an API key
curl -X POST https://octoklaw-api.vercel.app/api/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "My App", "email": "me@example.com"}'

# 2. Extract data from any URL
curl -X POST https://octoklaw-api.vercel.app/api/extract \
  -H "Content-Type: application/json" \
  -H "x-api-key: ok_YOUR_KEY_HERE" \
  -d '{"url": "https://example.com"}'

# 3. Analyze content
curl -X POST https://octoklaw-api.vercel.app/api/analyze \
  -H "Content-Type: application/json" \
  -H "x-api-key: ok_YOUR_KEY_HERE" \
  -d '{"url": "https://example.com"}'
```

## Authentication

All authenticated endpoints require the `x-api-key` header.

## Rate Limits

| Tier | Requests/min | Monthly Quota | Price |
|------|-------------|---------------|-------|
| Free | 60 | 1,000 | $0 |
| Pro | 300 | 50,000 | $29/mo |
| Enterprise | Unlimited | Unlimited | Custom |

## Architecture

- **Runtime**: Vercel Serverless Functions (Node.js 20)
- **Database**: Supabase (PostgreSQL) — API keys, usage metering, intelligence cache
- **Monitoring**: Postman automated health checks
- **Source**: GitHub (auto-deploy on push)

## Built by OctoKlaw Mesh

Part of the [OctoKlaw](https://github.com/EvezArt/octoklaw-rom) autonomous infrastructure.

---

*Revenue ARM activated. Every API call is metered. Growth is monotonic.*
