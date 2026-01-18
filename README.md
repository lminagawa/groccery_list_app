🌐 Languages: [English](README.md) | [日本語](README.ja.md)

# 🛒 Shared Shopping List

A lightweight, AI-powered shopping list app built on Cloudflare Workers + KV. Share grocery lists with a single URL—no accounts needed.

## 🌟 Demo

- **Live App**: https://shared-shopping-list.grocery-shopping-list.workers.dev
- **Screenshots**:

  <img width="200" height="450" alt="Shared Shopping List" src="https://github.com/user-attachments/assets/8425f181-ce51-444b-9ff4-3b9fd5d83b4f" />
  <img width="200" height="450" alt="image" src="https://github.com/user-attachments/assets/e02e1ec3-4b88-47c2-8770-ec6b3f61e22d" />
  <img width="200" height="450" alt="image" src="https://github.com/user-attachments/assets/01a4f30b-d298-4b2f-b5fc-1ced52ac93dc" />
  <img width="200" height="450" alt="image" src="https://github.com/user-attachments/assets/3a91527b-dc06-447f-bf95-678c5afb18aa" />

---

## ✨ Features

### 🤖 AI Shopping Concierge
- **Natural Language List Generation** - Generate shopping lists from prompts like "Weekend BBQ ingredients" or "5日分の夕食の買い物リスト"
- **Specials-Aware AI** - AI considers current store specials when generating lists (optional)
- **Multi-Language Support** - Works with Japanese, English, and other languages
- **Smart Fallback** - Automatic API key rotation when rate limits are reached

### 💰 Smart Catalog Integration
- **Woolworths & Coles Specials** - Fetch real-time or cached special offers from major Australian supermarkets
- **Price Comparison** - Compare prices between stores at a glance
- **AI Product Matching** - Fuzzy matching between user input and catalog items (e.g., "牛肉" → "Australian Beef Mince")
- **Savings Calculator** - Automatic calculation of total savings from specials

### 🔗 Seamless Sharing
- **Token-based URLs** - Share via a unique tokenized link instead of accounts
- **Real-time Sync** - 7-second polling with version-based conflict resolution
- **Cross-Device Access** - Works on any device with a web browser

### 🏷️ Flexible Organization
- **Preset Store Tags** - Woolies, Coles, ALDI, IGA, Asian Grocery, Chemist, Kmart
- **Custom Tags** - Create your own tags stored locally
- **Tag Filtering** - Filter view by selected tags

### 📱 Mobile-First UX
- **Responsive Design** - Optimized for smartphones and tablets
- **Touch-Friendly** - Large tap targets and swipe-compatible UI
- **iOS Safe Area Support** - Proper padding for notched devices
- **Offline-Resilient** - Graceful handling of network issues

### 💸 Cost-Effective
- **Cloudflare Free Tier** - Runs entirely within free limits
- **Edge Computing** - Low latency worldwide via Cloudflare's edge network

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  index.html (Vanilla JS, Mobile-First CSS)               │   │
│  │  • Shopping list UI with real-time sync                  │   │
│  │  • AI generation modal                                   │   │
│  │  • Specials browser (Woolies/Coles tabs)                 │   │
│  │  • Share modal with URL copy                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker (Edge)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  worker.js - API Routes                                  │   │
│  │  ├── GET/PUT/DELETE /api/list/:token  (CRUD operations)  │   │
│  │  ├── POST /api/generate               (AI list gen)      │   │
│  │  ├── GET  /api/specials               (Mock specials)    │   │
│  │  ├── GET  /api/specials-rapidapi      (RapidAPI)         │   │
│  │  ├── GET  /api/search                 (Product search)   │   │
│  │  ├── POST /api/match                  (Catalog match)    │   │
│  │  ├── POST /api/ai-match               (AI matching)      │   │
│  │  └── POST /api/filter-specials        (AI filter)        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ catalog-api.js │  │catalog-rapidapi │  │catalog-ai-match │   │
│  │ (Mock Data)    │  │ (Real APIs)     │  │ (AI Matching)   │   │
│  └────────────────┘  └─────────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐
   │ Cloudflare  │    │ OpenRouter  │    │ RapidAPI        │
   │ KV Storage  │    │ (LLM API)   │    │ (Coles/Woolies) │
   └─────────────┘    └─────────────┘    └─────────────────┘
```

---

## 📁 Project Structure

```
groccery_list_app/
├── index.html              # Single-page frontend (Vanilla JS)
├── public/
│   └── index.html          # Static assets for deployment
├── src/
│   ├── worker.js           # Main Cloudflare Worker (API routes)
│   ├── catalog-api.js      # Mock catalog data integration
│   ├── catalog-rapidapi.js # RapidAPI integration (Woolies/Coles)
│   ├── catalog-ai-matcher.js # AI-powered product matching
│   ├── catalog-mock-data.js  # Mock specials data
│   └── catalog-frontend.js   # Frontend catalog components
├── functions/
│   └── _middleware.js      # Cloudflare Pages middleware
├── test/
│   ├── worker.test.js      # Worker API tests
│   ├── frontend.test.js    # Frontend tests
│   └── setup.js            # Test setup
├── wrangler.toml           # Cloudflare Workers config
├── package.json            # Dependencies & scripts
└── vitest.config.js        # Test configuration
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/list/:token` | Fetch shopping list by token |
| `PUT` | `/api/list/:token` | Update shopping list (version-based merge) |
| `DELETE` | `/api/list/:token` | Delete shopping list |
| `POST` | `/api/generate` | AI-generate shopping list from prompt |
| `GET` | `/api/specials` | Get current specials (mock data) |
| `GET` | `/api/specials-rapidapi` | Get specials via RapidAPI |
| `GET` | `/api/search?q=...` | Search products in catalog |
| `POST` | `/api/match` | Match list items with catalog |
| `POST` | `/api/ai-match` | AI-powered fuzzy matching |
| `POST` | `/api/filter-specials` | AI-filter specials by user list |

### Example: AI Generate Request
```bash
curl -X POST https://your-worker.workers.dev/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Weekend BBQ shopping list", "token": "your-list-token", "useSpecials": true}'
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare account (free tier works)
- (Optional) OpenRouter API key for AI features
- (Optional) RapidAPI key for real catalog data

### 1. Clone & Install

```bash
git clone https://github.com/HikaLucaM/groccery_list_app.git
cd groccery_list_app
npm install
```

### 2. Cloudflare Setup

```bash
# Login to Cloudflare
npx wrangler login

# Create KV namespaces
npx wrangler kv:namespace create SHOPLIST
npx wrangler kv:namespace create SHOPLIST --preview

# Update wrangler.toml with the returned IDs
```

### 3. Set Secrets (for AI & Catalog features)

```bash
# OpenRouter API key (for AI generation)
wrangler secret put OPENROUTER_API_KEY

# Optional: Backup API key for fallback
wrangler secret put OPENROUTER_API_KEY_2

# Optional: RapidAPI key (for real Woolies/Coles data)
wrangler secret put RAPIDAPI_KEY
```

### 4. Deploy

```bash
# Deploy Worker
npm run deploy

# Or deploy everything (Worker + Pages)
npm run deploy:all
```

### 5. Local Development

```bash
# Start local dev server
npm run dev

# Open http://localhost:8787
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

---

## 🔒 Security

> ⚠️ **Important**: This project uses API keys. Please read [SECURITY.md](SECURITY.md) before contributing.

**Key Points:**
- Never commit API keys to Git
- Use `.dev.vars` for local development (in `.gitignore`)
- Use `wrangler secret put` for production secrets
- Token URLs should be treated like passwords

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | Local dev setup guide |
| [SECURITY.md](SECURITY.md) | Security best practices |
| [CATALOG_INTEGRATION.md](CATALOG_INTEGRATION.md) | Catalog API implementation |
| [RAPIDAPI_SETUP.md](RAPIDAPI_SETUP.md) | RapidAPI configuration |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Deployment instructions |
| [TESTING.md](TESTING.md) | Testing guide |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Vanilla JavaScript, CSS3 (Mobile-First) |
| **Backend** | Cloudflare Workers (Edge Runtime) |
| **Storage** | Cloudflare KV |
| **AI** | OpenRouter API (Llama 3 70B default) |
| **Catalog APIs** | RapidAPI (Woolies/Coles) |
| **Testing** | Vitest, jsdom |
| **Deployment** | Wrangler CLI |

---

## 📄 License

[MIT](LICENSE)

## 🤝 Contributing

Pull requests welcome! Please read [SECURITY.md](SECURITY.md) first.

## 📮 Contact

Open an [issue](https://github.com/HikaLucaM/groccery_list_app/issues) for bugs, features, or questions.
