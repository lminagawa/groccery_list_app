/**
 * Cloudflare Worker for Shared Shopping List API
 * 
 * NEW FEATURE: AI Shopping Concierge
 * ===================================
 * 
 * Endpoint: POST /api/generate
 * 
 * This endpoint allows users to generate shopping lists from natural language prompts
 * using AI (OpenRouter API with Llama 3 70B by default).
 * 
 * Testing Instructions:
 * ---------------------
 * 1. Set up the OpenRouter API key:
 *    wrangler secret put OPENROUTER_API_KEY
 * 
 * 2. (Optional) Set a different model:
 *    wrangler secret put MODEL
 *    Default: meta-llama/llama-3-70b-instruct
 * 
 * 3. Run locally:
 *    wrangler dev
 * 
 * 4. Open in browser:
 *    http://127.0.0.1:8787/?t=<your_token>
 *    (Use any alphanumeric token 16+ chars, e.g., "test1234567890abc")
 * 
 * 5. Click the "🤖 AI" button in the bottom bar
 * 
 * 6. Enter a prompt like:
 *    - "平日5日分の夕食の買い物リスト"
 *    - "週末のバーベキューに必要なもの"
 *    - "一人暮らしの基本的な食材"
 * 
 * 7. The list will be generated and automatically saved to KV
 * 
 * Request format:
 * POST /api/generate
 * {
 *   "prompt": "平日5日分の夕食の買い物リスト",
 *   "token": "your-list-token-here"
 * }
 * 
 * Response format (success):
 * {
 *   "status": "success",
 *   "items": [
 *     {
 *       "id": "uuid",
 *       "label": "牛肉",
 *       "tags": ["Woolies"],
 *       "checked": false,
 *       "pos": 0,
 *       "updated_at": 1234567890
 *     },
 *     ...
 *   ]
 * }
 */

// Import catalog API modules
import { 
  getAllSpecials, 
  formatSpecialsForAI, 
  searchProduct,
  matchItemsWithCatalog 
} from './catalog-api.js';

// Import RapidAPI module (official APIs)
import {
  getAllSpecialsRapidAPI,
  searchProductRapidAPI,
  formatRapidAPISpecialsForAI
} from './catalog-rapidapi.js';

// Import AI matcher
import {
  hybridMatch,
  enhanceWithCatalogPrices,
  simpleKeywordMatch
} from './catalog-ai-matcher.js';

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// Token validation: alphanumeric, underscore, hyphen, min 16 chars
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{16,}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // Serve index.html for root path
    if (url.pathname === '/' || url.pathname === '/index.html') {
      try {
        const asset = await env.ASSETS.fetch(new URL('/index.html', request.url));
        return new Response(asset.body, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Disable caching to ensure latest UI assets are served after deploys
            'Cache-Control': 'no-store',
          },
        });
      } catch (error) {
        console.error('Error serving index.html:', error);
        return new Response('App not found', { status: 404 });
      }
    }

    // Parse path: /api/generate
    if (url.pathname === '/api/generate' && method === 'POST') {
      return await handleGenerate(request, env);
    }

    // Parse path: /api/transcribe
    if (url.pathname === '/api/transcribe' && method === 'POST') {
      return await handleTranscribe(request, env);
    }

    // Parse path: /api/specials (Get current specials from Woolworths & Coles - Mock data)
    if (url.pathname === '/api/specials' && method === 'GET') {
      return await handleGetSpecials(request, env);
    }

    // Parse path: /api/specials-rapidapi (Get specials from RapidAPI)
    if (url.pathname === '/api/specials-rapidapi' && method === 'GET') {
      return await handleGetSpecialsRapidAPI(request, env);
    }

    // Parse path: /api/search (Search for a product - Mock data)
    if (url.pathname === '/api/search' && method === 'GET') {
      return await handleSearchProduct(request, env);
    }

    // Parse path: /api/search-rapidapi (Search using RapidAPI)
    if (url.pathname === '/api/search-rapidapi' && method === 'GET') {
      return await handleSearchProductRapidAPI(request, env);
    }

    // Parse path: /api/match (Match list items with catalog)
    if (url.pathname === '/api/match' && method === 'POST') {
      return await handleMatchItems(request, env);
    }

    // Parse path: /api/ai-match (AI-powered matching - Mock data)
    if (url.pathname === '/api/ai-match' && method === 'POST') {
      return await handleAIMatch(request, env);
    }

    // Parse path: /api/ai-match-rapidapi (AI matching with RapidAPI)
    if (url.pathname === '/api/ai-match-rapidapi' && method === 'POST') {
      return await handleAIMatchRapidAPI(request, env);
    }

    // Parse path: /api/filter-specials (Filter specials by user's list using AI)
    if (url.pathname === '/api/filter-specials' && method === 'POST') {
      return await handleFilterSpecials(request, env);
    }

    // Parse path: /api/clear-cache (Clear RapidAPI cache - for development)
    if (url.pathname === '/api/clear-cache' && method === 'POST') {
      try {
        await env.SHOPLIST.delete('catalog:specials:rapidapi');
        return jsonResponse({ status: 'success', message: 'Cache cleared' });
      } catch (error) {
        return jsonResponse({ error: 'Failed to clear cache' }, 500);
      }
    }

    // Parse path: /api/list/:token
    const pathMatch = url.pathname.match(/^\/api\/list\/([^/]+)$/);
    if (!pathMatch) {
      return jsonResponse({ error: 'Invalid path' }, 404);
    }

    const token = pathMatch[1];

    // Validate token format
    if (!TOKEN_PATTERN.test(token)) {
      return jsonResponse({ error: 'Invalid token format' }, 400);
    }

    const kvKey = `list:${token}`;

    try {
      switch (method) {
        case 'GET':
          return await handleGet(env.SHOPLIST, kvKey);
        case 'PUT':
          return await handlePut(request, env.SHOPLIST, kvKey);
        case 'DELETE':
          return await handleDelete(env.SHOPLIST, kvKey);
        default:
          return jsonResponse({ error: 'Method not allowed' }, 405);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};

/**
 * GET /api/list/:token
 * Returns the list document or default empty list
 */
async function handleGet(kv, kvKey) {
  const stored = await kv.get(kvKey, 'text');

  if (!stored) {
    return jsonResponse(createDefaultDocument());
  }

  const doc = JSON.parse(stored);
  if (!Array.isArray(doc.items)) {
    doc.items = [];
  }
  if (typeof doc.version !== 'number') {
    doc.version = 0;
  }

  return jsonResponse(doc);
}

/**
 * PUT /api/list/:token
 * Updates the list document with validation and pos renumbering
 */
async function handlePut(request, kv, kvKey) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  // Validate structure
  if (!body || typeof body.title !== 'string' || !Array.isArray(body.items)) {
    return jsonResponse({ error: 'Invalid document structure' }, 400);
  }

  const deletedItemIds = Array.isArray(body.deletedItemIds)
    ? body.deletedItemIds.filter((id) => typeof id === 'string' && id.length > 0)
    : [];

  const incomingItems = new Map();
  try {
    body.items.forEach((item, index) => {
      const normalized = normalizeItem(item, index);
      incomingItems.set(normalized.id, normalized);
    });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Invalid item data' }, 400);
  }

  const stored = await kv.get(kvKey, 'text');
  const existingDoc = stored ? JSON.parse(stored) : createDefaultDocument();
  if (!Array.isArray(existingDoc.items)) {
    existingDoc.items = [];
  }
  if (typeof existingDoc.version !== 'number') {
    existingDoc.version = 0;
  }

  const existingItems = new Map();
  try {
    existingDoc.items.forEach((item, index) => {
      const normalized = normalizeItem(item, index);
      existingItems.set(normalized.id, normalized);
    });
  } catch (error) {
    // If existing data is corrupted, start fresh
    console.error('Error normalizing existing items:', error);
  }

  const deletedSet = new Set(deletedItemIds);
  const mergedItems = [];
  const processedIds = new Set();

  // Resolve items present in incoming payload
  for (const [id, incomingItem] of incomingItems.entries()) {
    if (deletedSet.has(id)) {
      processedIds.add(id);
      continue;
    }

    const existingItem = existingItems.get(id);
    if (existingItem) {
      const incomingUpdatedAt = Number(incomingItem.updated_at) || 0;
      const existingUpdatedAt = Number(existingItem.updated_at) || 0;
      mergedItems.push(incomingUpdatedAt >= existingUpdatedAt ? incomingItem : existingItem);
      processedIds.add(id);
    } else {
      mergedItems.push(incomingItem);
      processedIds.add(id);
    }
  }

  // Preserve items that were not included in this payload and not explicitly deleted
  for (const [id, existingItem] of existingItems.entries()) {
    if (processedIds.has(id)) continue;
    if (deletedSet.has(id)) continue;
    mergedItems.push(existingItem);
  }

  mergedItems.sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  mergedItems.forEach((item, index) => {
    item.pos = index;
  });

  const nextVersion = (existingDoc.version || 0) + 1;
  const incomingTitle = typeof body.title === 'string' ? body.title : existingDoc.title || 'Shopping';

  const mergedDoc = {
    title: incomingTitle,
    items: mergedItems,
    version: nextVersion,
    updated_at: Date.now(),
  };

  await kv.put(kvKey, JSON.stringify(mergedDoc));

  return jsonResponse(mergedDoc);
}

/**
 * DELETE /api/list/:token
 * Deletes the list document
 */
async function handleDelete(kv, kvKey) {
  await kv.delete(kvKey);
  return jsonResponse({ ok: true });
}

/**
 * Helper: Create JSON response with CORS headers
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function createDefaultDocument() {
  return {
    title: 'Shopping',
    items: [],
    version: 0,
    updated_at: Date.now(),
  };
}

function normalizeItem(item, fallbackPos = 0) {
  if (!item || typeof item !== 'object') {
    throw new Error('Invalid item structure');
  }

  if (typeof item.id !== 'string' || !item.id) {
    throw new Error('Item missing id');
  }

  if (typeof item.label !== 'string') {
    throw new Error('Item missing label');
  }

  if (typeof item.checked !== 'boolean') {
    throw new Error('Item missing checked state');
  }

  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag) => typeof tag === 'string' && tag.length > 0)
    : [];

  let updatedAt = Number(item.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    updatedAt = Date.now();
  }

  const pos = Number.isFinite(item.pos) ? Number(item.pos) : fallbackPos;

  return {
    id: item.id,
    label: item.label,
    checked: item.checked,
    tags,
    pos,
    updated_at: updatedAt,
  };
}

/**
 * Helper: Generate mock AI response for development
 * Used when API rate limit is reached or USE_MOCK_AI=true
 */
function generateMockAIResponse(prompt, specialsData = []) {
  const lowerPrompt = prompt.toLowerCase();
  
  // Common Japanese shopping items by category
  const mockItems = [];
  
  if (lowerPrompt.includes('朝食') || lowerPrompt.includes('breakfast')) {
    mockItems.push(
      { label: '食パン', tags: ['Woolies'] },
      { label: '牛乳 1L', tags: ['Coles'] },
      { label: '卵 6個入り', tags: ['Woolies'] },
      { label: 'バター', tags: ['ALDI'] }
    );
  } else if (lowerPrompt.includes('夕食') || lowerPrompt.includes('ディナー') || lowerPrompt.includes('dinner')) {
    mockItems.push(
      { label: '牛肉 500g', tags: ['Woolies'] },
      { label: '玉ねぎ', tags: ['Coles'] },
      { label: 'にんじん', tags: ['Coles'] },
      { label: 'じゃがいも', tags: ['Woolies'] },
      { label: '醤油', tags: ['Asian Grocery'] }
    );
  } else if (lowerPrompt.includes('カレー') || lowerPrompt.includes('curry')) {
    mockItems.push(
      { label: 'カレールー', tags: ['Asian Grocery'] },
      { label: '鶏肉 600g', tags: ['Coles'] },
      { label: 'じゃがいも 3個', tags: ['Woolies'] },
      { label: 'にんじん 2本', tags: ['Coles'] },
      { label: '玉ねぎ 2個', tags: ['Woolies'] }
    );
  } else if (lowerPrompt.includes('パーティー') || lowerPrompt.includes('party') || lowerPrompt.includes('バーベキュー') || lowerPrompt.includes('bbq')) {
    mockItems.push(
      { label: 'ソーセージ 1kg', tags: ['Coles'] },
      { label: 'ハンバーガーパン', tags: ['Woolies'] },
      { label: 'レタス', tags: ['Coles'] },
      { label: 'トマト', tags: ['Woolies'] },
      { label: 'ビール 6缶', tags: ['Woolies'] },
      { label: 'ポテトチップス', tags: ['ALDI'] }
    );
  } else {
    // Default generic items
    mockItems.push(
      { label: '牛乳', tags: ['Woolies'] },
      { label: 'パン', tags: ['Coles'] },
      { label: '卵', tags: ['Woolies'] },
      { label: 'トマト', tags: ['Coles'] }
    );
  }
  
  // If specials available, add 1-2 special items
  if (specialsData.length > 0) {
    const special = specialsData[0];
    mockItems.push({ 
      label: special.name, 
      tags: [special.store] 
    });
  }
  
  return {
    choices: [{
      message: {
        content: JSON.stringify({ items: mockItems })
      }
    }],
    model: 'mock-ai',
    usage: { total_tokens: 0 }
  };
}

/**
 * Helper: Call OpenRouter API with a specific model
 * Strict JSON enforcement: Updated prompt to guarantee JSON-only output
 */
async function callOpenRouter(model, prompt, apiKey, signal) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://shared-shopping-list.grocery-shopping-list.workers.dev',
      'X-Title': 'Shared Shopping List',
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      top_p: 0.95,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `あなたはオーストラリアのスーパーマーケット向け買い物リスト作成AIです。

【ユーザーのリクエスト】
${prompt}

【タスク】
上記のリクエストに基づいて、最適な買い物リストを作成してください。

【重要な指示】
1. **具体的な商品名**: 
   - 曖昧な表現は避ける (例: ❌「野菜」→ ✅「トマト」「玉ねぎ」「にんじん」)
   - オーストラリアで一般的な商品名を使用
   
2. **料理の場合は全材料を含める**:
   - 料理名が含まれる場合、その料理を作るために必要な材料を漏れなくリストアップ
   - 基本調味料(塩、こしょう、油など)も忘れずに含める
   
3. **数量の明示**:
   - 必要に応じて数量や単位を含める (例: 「牛肉 500g」「卵 6個」「牛乳 1L」)
   
4. **店舗タグの選択**:
   - 各商品に最適な店舗を1つ選ぶ
   - 選択肢: Woolies, Coles, ALDI, IGA, Asian Grocery, Chemist, Kmart
   - 生鮮食品 → Woolies/Coles/IGA
   - アジア食材 → Asian Grocery
   - 日用品 → Chemist/Kmart

【出力形式】
以下のJSON形式で出力してください。説明文やマークダウンは不要です:

{"items":[{"label":"商品名(日本語または英語)","tags":["店舗名"],"checked":false}]}

例:
{"items":[{"label":"牛肉 500g","tags":["Woolies"],"checked":false},{"label":"玉ねぎ 2個","tags":["Coles"],"checked":false}]}`
        },
      ],
    }),
    signal,
  });
  return response;
}

/**
 * Helper: Generate with fallback models and API keys
 * Optimized: Uses only reliable free models
 */
async function generateWithFallbacks(prompt, env) {
  // Use reliable free models only (excluding frequently failing models like DeepSeek)
  const DEFAULT_MODEL = env.MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free';
  
  // Fallback to other working free models
  const FALLBACK_MODELS = (env.MODEL_FALLBACKS ?? 'mistralai/mistral-7b-instruct:free,google/gemma-2-9b-it:free').split(',');
  
  const models = [DEFAULT_MODEL, ...FALLBACK_MODELS];
  
  // NEW: Support for two API keys
  const apiKeys = [env.OPENROUTER_API_KEY];
  if (env.OPENROUTER_API_KEY_2) {
    apiKeys.push(env.OPENROUTER_API_KEY_2);
  }
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
  
  let lastError = null;
  
  try {
    // Try each API key
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      console.log(`Using API key ${keyIndex + 1}/${apiKeys.length}`);
      
      // Try each model with current API key
      for (const model of models) {
        try {
          console.log(`Trying model: ${model} with key ${keyIndex + 1}`);
          
          const response = await callOpenRouter(model.trim(), prompt, apiKey, controller.signal);
          
          // Success case
          if (response.status === 200) {
            const data = await response.json();
            console.log(`✓ Model ${model} succeeded with key ${keyIndex + 1}`);
            return data;
          }
          
          // Parse error details
          let errorData;
          try {
            errorData = await response.json();
          } catch {
            errorData = { error: { message: 'Unknown error', code: response.status } };
          }
          
          // 404: Privacy/policy issue or model not found - Try next model or key
          if (response.status === 404) {
            console.error(`⚠ Model ${model} not accessible (404) on key ${keyIndex + 1}. Reason: ${errorData.error?.message || 'Unknown'}`);
            lastError = `Model ${model} not accessible: ${errorData.error?.message || 'Check privacy settings'}`;
            
            // Try next key if available
            if (keyIndex + 1 < apiKeys.length) {
              console.log(`Trying next API key for this model...`);
              break; // Break to try next key
            }
            // Otherwise, try next model
            continue;
          }
          
          // 429: Rate limit - Try next key if available, otherwise stop
          if (response.status === 429) {
            const resetTime = errorData.error?.metadata?.headers?.['X-RateLimit-Reset'];
            const resetDate = resetTime ? new Date(parseInt(resetTime)).toLocaleString('ja-JP') : 'unknown';
            console.error(`⚠ Rate limit exceeded (429) on key ${keyIndex + 1}. Resets at: ${resetDate}`);
            
            if (keyIndex + 1 < apiKeys.length) {
              console.log(`Switching to API key ${keyIndex + 2}...`);
              break; // Break from models loop to try next key
            } else {
              throw new Error(`All API keys rate limited. Try again after ${resetDate}`);
            }
          }
          
          // 402: Payment required → Try next key if available, otherwise try next model
          if (response.status === 402) {
            console.log(`⚠ Model ${model} requires payment (402) on key ${keyIndex + 1}`);
            
            if (keyIndex + 1 < apiKeys.length) {
              console.log(`Will try API key ${keyIndex + 2} for this model...`);
              lastError = `Payment required for ${model} on key ${keyIndex + 1}`;
              break; // Break from models loop to try next key
            } else {
              console.log(`No more API keys, trying next model...`);
              lastError = `Payment required for ${model} on all keys`;
              continue;
            }
          }
          
          // 5xx: Server error → try next model
          if (response.status >= 500) {
            console.log(`⚠ Server error ${response.status} for ${model}, trying next...`);
            lastError = `Server error ${response.status}`;
            continue;
          }
          
          // Other errors → try next model
          console.log(`⚠ Model ${model} failed with status ${response.status}: ${errorData.error?.message || 'Unknown'}`);
          lastError = errorData.error?.message || `HTTP ${response.status}`;
          continue;
          
        } catch (modelError) {
          // Network or fetch errors - try next model/key
          console.error(`⚠ Exception with model ${model} on key ${keyIndex + 1}:`, modelError.message);
          lastError = modelError.message;
          
          // Try next key if available
          if (keyIndex + 1 < apiKeys.length) {
            break; // Break to try next key
          }
          continue; // Otherwise try next model
        }
      }
    }
    
    // All models and keys failed
    const errorMsg = `All models and API keys failed. Last error: ${lastError || 'Unknown'}. 
Tried ${apiKeys.length} API key(s) and ${models.length} model(s). 
If you see 404 errors, check privacy settings: https://openrouter.ai/settings/privacy`;
    console.error(errorMsg);
    throw new Error(errorMsg);
    
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper: Safely parse and validate JSON from LLM output
 * Handles markdown code fences, text pollution, and validates schema
 */
function safeJsonParseLLMOutput(text) {
  try {
    // Remove code fences and markdown remnants
    const cleaned = text.replace(/```json|```/g, "").trim();
    
    // Extract first JSON object
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object found");

    // Parse JSON
    const json = JSON.parse(match[0]);

    // Basic schema validation
    if (!Array.isArray(json.items)) throw new Error("Missing 'items' array");
    
    for (const item of json.items) {
      if (typeof item.label !== "string") throw new Error("Invalid label");
    }

    return json;
  } catch (err) {
    console.error("LLM JSON parse failed:", err);
    return { error: "Invalid JSON", raw: text };
  }
}

/**
 * Helper: Normalize tag to allowed list
 * Tags are restricted to specific stores
 */
const ALLOWED_TAGS = ["Woolies", "Coles", "ALDI", "IGA", "Asian Grocery", "Chemist", "Kmart"];

function getAllowedTag(tag) {
  if (!tag) return "Woolies";
  const found = ALLOWED_TAGS.find(t => tag.toLowerCase().includes(t.toLowerCase()));
  return found || "Woolies";
}

function parseShoppingItemsFromTranscript(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const fillerPattern = /(?:買い物リスト|リスト|買うもの|買う物|ショッピングリスト|に|へ|を|も)?(?:追加|登録|入れて|加えて|お願いします|お願い|ください|欲しい|ほしい|買って|買う|必要|いる|要る)/g;
  const normalized = text
    .replace(/[「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .replace(fillerPattern, ' ')
    .replace(/(?:それと|あと|それから|それに|追加で|ついでに)/g, ' ')
    .replace(/[。!?！？]/g, '、')
    .trim();

  const seen = new Set();
  return normalized
    .split(/\s*(?:、|，|,|;|；|\/|\n|&|＆|\+| plus | and | と | や | または | 及び | および |(?<=[^\u3040-\u309f])と|と(?=[^\u3040-\u309f])|(?<=[^\u3040-\u309f])や|や(?=[^\u3040-\u309f]))\s*/iu)
    .map((part) => part
      .replace(/^(?:あと|それと|それから|追加で)\s*/g, '')
      .replace(/\s*(?:を|も|と|や|です|で|して|してね)$|^\s*(?:と|や)\s*/g, '')
      .trim())
    .filter((label) => label.length > 0 && label.length <= 64)
    .filter((label) => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20)
    .map((label, index) => ({
      label,
      tags: [],
      checked: false,
      pos: index,
    }));
}

async function transcribeWithGroq(audioFile, env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Groq service not configured');
  }

  const formData = new FormData();
  formData.append('file', audioFile);
  formData.append('model', env.GROQ_TRANSCRIPTION_MODEL ?? 'whisper-large-v3-turbo');
  formData.append('response_format', 'json');
  formData.append('temperature', '0');
  formData.append('language', 'ja');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('Groq transcription failed:', response.status, errorText);
    throw new Error(`Groq transcription failed (${response.status})`);
  }

  return response.json();
}

/**
 * POST /api/transcribe
 * Transcribe short voice input with Groq and turn it into shopping items.
 */
async function handleTranscribe(request, env) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: 'Invalid form data' }, 400);
  }

  const audioFile = formData.get('file');
  if (!audioFile || typeof audioFile !== 'object' || typeof audioFile.arrayBuffer !== 'function') {
    return jsonResponse({ error: 'Missing audio file' }, 400);
  }

  try {
    const data = await transcribeWithGroq(audioFile, env);
    const transcript = typeof data.text === 'string' ? data.text.trim() : '';
    const items = parseShoppingItemsFromTranscript(transcript);

    return jsonResponse({
      status: 'ok',
      text: transcript,
      items,
    });
  } catch (error) {
    console.error('Error in handleTranscribe:', error);
    const status = error.message === 'Groq service not configured' ? 500 : 502;
    return jsonResponse({
      error: '音声入力の文字起こしに失敗しました',
      details: error.message,
    }, status);
  }
}

/**
 * Helper: Safely parse and validate list data from AI response
 * Uses safeJsonParseLLMOutput for robust parsing
 */
function safeParseList(text) {
  // Parse with safe JSON extraction
  const parsed = safeJsonParseLLMOutput(text);
  
  // Handle parsing errors
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  
  // Normalize items with allowed tags only
  return parsed.items
    .filter(item => item.label && typeof item.label === 'string')
    .map((item, index) => ({
      id: crypto.randomUUID(),
      label: item.label.trim().slice(0, 64),
      tags: [getAllowedTag(Array.isArray(item.tags) ? item.tags[0] : null)],
      checked: true, // Initial state is checked for preview
      pos: index,
      updated_at: Date.now(),
    }));
}

/**
 * POST /api/generate
 * Generate shopping list using AI (OpenRouter)
 * NOW WITH CATALOG INTEGRATION: AI considers current specials
 */
async function handleGenerate(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { prompt, token, useSpecials = false } = body;

  // Validate input
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return jsonResponse({ error: 'Missing or invalid prompt' }, 400);
  }

  if (!token || typeof token !== 'string') {
    return jsonResponse({ error: 'Missing token' }, 400);
  }

  // Validate token format
  if (!TOKEN_PATTERN.test(token)) {
    return jsonResponse({ error: 'Invalid token format' }, 400);
  }

  // Fetch existing list document
  const kvKey = `list:${token}`;
  const stored = await env.SHOPLIST.get(kvKey, 'text');
  const existingDoc = stored ? JSON.parse(stored) : createDefaultDocument();

  // Call OpenRouter API with fallback
  try {
    const apiKey = env.OPENROUTER_API_KEY;

    // NEW: Mock mode for development (when API limit reached)
    const useMockAI = env.USE_MOCK_AI === 'true';
    
    if (!useMockAI && !apiKey) {
      console.error('OPENROUTER_API_KEY not configured');
      return jsonResponse({ error: 'AI service not configured' }, 500);
    }

    // NEW: Fetch specials if requested
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);
    
    let enhancedPrompt = prompt;
    let specialsData = [];
    
    try {
      if (useSpecials) {
        specialsData = await getAllSpecials(env.SHOPLIST, controller.signal);
        const specialsText = formatSpecialsForAI(specialsData);
        enhancedPrompt = `${prompt}\n\n${specialsText}\n\n※上記の特売品を優先的に使用してリストを作成してください。`;
      }
    } catch (specialsError) {
      console.warn('Failed to fetch specials, continuing without:', specialsError);
    }

    // Generate with fallbacks (or mock)
    let openRouterData;
    
    if (useMockAI) {
      console.log('🤖 Using MOCK AI mode (USE_MOCK_AI=true)');
      openRouterData = generateMockAIResponse(prompt, specialsData);
    } else {
      openRouterData = await generateWithFallbacks(enhancedPrompt, env);
    }
    
    clearTimeout(timeoutId);
    
    // Extract content from response
    if (!openRouterData.choices || !openRouterData.choices[0] || !openRouterData.choices[0].message) {
      console.error('Invalid OpenRouter response structure:', openRouterData);
      return jsonResponse({ error: 'Invalid AI response' }, 502);
    }

    const content = openRouterData.choices[0].message.content;

    // Parse and validate
    const normalizedItems = safeParseList(content);

    // NEW: Enhance with catalog prices if specials were used
    let enhancedItems = normalizedItems;
    if (useSpecials && specialsData.length > 0) {
      try {
        // Build API keys array for fallback
        const apiKeys = [apiKey];
        if (env.OPENROUTER_API_KEY_2) {
          apiKeys.push(env.OPENROUTER_API_KEY_2);
        }
        
        enhancedItems = await enhanceWithCatalogPrices(
          normalizedItems, 
          specialsData, 
          apiKeys
        );
        console.log('Enhanced items with catalog prices');
      } catch (enhanceError) {
        console.warn('Failed to enhance with catalog:', enhanceError);
        // Continue with original items
      }
    }

    // Return suggestions without saving
    return jsonResponse({
      status: 'ok',
      suggestions: enhancedItems,
      specialsUsed: useSpecials && specialsData.length > 0,
      specialsCount: specialsData.length,
      pricesIncluded: enhancedItems.some(item => item.price !== undefined),
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('OpenRouter API timeout');
      return jsonResponse({ error: 'AI生成がタイムアウトしました' }, 504);
    }
    console.error('Error in handleGenerate:', error);
    return jsonResponse({ 
      error: 'AI生成に失敗しました',
      details: error.message 
    }, 500);
  }
}

/**
 * GET /api/specials
 * Get current specials from Woolworths & Coles
 */
async function handleGetSpecials(request, env) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const specials = await getAllSpecials(env.SHOPLIST, controller.signal);
    
    clearTimeout(timeoutId);
    
    return jsonResponse({
      status: 'success',
      specials,
      count: specials.length,
      cached: true,
    });
  } catch (error) {
    console.error('Error in handleGetSpecials:', error);
    return jsonResponse({ error: 'Failed to fetch specials' }, 500);
  }
}

/**
 * GET /api/search?q=product_name
 * Search for a product across Woolworths & Coles
 */
async function handleSearchProduct(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  
  if (!query || query.trim().length === 0) {
    return jsonResponse({ error: 'Missing search query' }, 400);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const results = await searchProduct(query.trim(), controller.signal);
    
    clearTimeout(timeoutId);
    
    return jsonResponse({
      status: 'success',
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error('Error in handleSearchProduct:', error);
    return jsonResponse({ error: 'Search failed' }, 500);
  }
}

/**
 * POST /api/match
 * Match shopping list items with catalog products
 * Body: { items: [...] }
 */
async function handleMatchItems(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  
  const { items } = body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Invalid or empty items array' }, 400);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const matches = await matchItemsWithCatalog(items, controller.signal);
    
    clearTimeout(timeoutId);
    
    return jsonResponse({
      status: 'success',
      matches,
      totalSavings: calculateTotalSavings(matches),
    });
  } catch (error) {
    console.error('Error in handleMatchItems:', error);
    return jsonResponse({ error: 'Matching failed' }, 500);
  }
}

/**
 * Helper: Calculate total savings from matched items
 */
function calculateTotalSavings(matches) {
  let savings = 0;
  
  for (const match of matches) {
    if (match.catalogMatch && match.catalogMatch.wasPrice && match.catalogMatch.price) {
      savings += (match.catalogMatch.wasPrice - match.catalogMatch.price);
    }
  }
  
  return Math.round(savings * 100) / 100;
}

/**
 * POST /api/ai-match
 * AI-powered matching of user items with catalog
 * Body: { items: ["牛肉", "牛乳", "パン"] }
 */
async function handleAIMatch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }
  
  const { items } = body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Invalid or empty items array' }, 400);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    // Get all catalog items
    const catalogItems = await getAllSpecials(env.SHOPLIST, controller.signal);
    
    if (catalogItems.length === 0) {
      return jsonResponse({ 
        error: 'Catalog is empty',
        matches: items.map(item => ({
          userInput: item,
          matches: [],
          bestMatch: null,
        }))
      }, 200);
    }
    
    const apiKey = env.OPENROUTER_API_KEY;
    
    // Build API keys array for fallback
    const apiKeys = [apiKey];
    if (env.OPENROUTER_API_KEY_2) {
      apiKeys.push(env.OPENROUTER_API_KEY_2);
    }
    
    // Try AI matching
    const matches = await hybridMatch(items, catalogItems, apiKeys);
    
    clearTimeout(timeoutId);
    
    // Calculate total savings
    let totalSavings = 0;
    matches.forEach(match => {
      if (match.bestMatch && match.bestMatch.wasPrice) {
        totalSavings += (match.bestMatch.wasPrice - match.bestMatch.price);
      }
    });
    
    return jsonResponse({
      status: 'success',
      matches,
      catalogSize: catalogItems.length,
      totalSavings: Math.round(totalSavings * 100) / 100,
      method: matches[0]?.method || 'ai',
    });
  } catch (error) {
    console.error('Error in handleAIMatch:', error);
    return jsonResponse({ error: 'AI matching failed', details: error.message }, 500);
  }
}

/**
 * GET /api/specials-rapidapi
 * Get current specials from RapidAPI (Woolworths & Coles)
 */
async function handleGetSpecialsRapidAPI(request, env) {
  try {
    const apiKey = env.RAPIDAPI_KEY;
    if (!apiKey) {
      return jsonResponse({ 
        error: 'RapidAPI key not configured',
        help: 'Run: wrangler secret put RAPIDAPI_KEY'
      }, 500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const specials = await getAllSpecialsRapidAPI(env.SHOPLIST, apiKey, controller.signal);
    
    clearTimeout(timeoutId);
    
    return jsonResponse({
      status: 'success',
      specials,
      count: specials.length,
      source: 'RapidAPI',
      cached: true,
    });
  } catch (error) {
    console.error('Error in handleGetSpecialsRapidAPI:', error);
    return jsonResponse({ 
      error: 'Failed to fetch specials from RapidAPI',
      details: error.message 
    }, 500);
  }
}

/**
 * GET /api/search-rapidapi?q=product_name
 * Search for a product using RapidAPI
 */
async function handleSearchProductRapidAPI(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q');
  
  if (!query || query.trim().length === 0) {
    return jsonResponse({ error: 'Missing search query' }, 400);
  }

  const apiKey = env.RAPIDAPI_KEY;
  if (!apiKey) {
    return jsonResponse({ 
      error: 'RapidAPI key not configured',
      help: 'Run: wrangler secret put RAPIDAPI_KEY'
    }, 500);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const results = await searchProductRapidAPI(query.trim(), apiKey, env.SHOPLIST, controller.signal);
    
    clearTimeout(timeoutId);
    
    return jsonResponse({
      status: 'success',
      query,
      results,
      count: results.length,
      source: 'RapidAPI',
    });
  } catch (error) {
    console.error('Error in handleSearchProductRapidAPI:', error);
    return jsonResponse({ error: 'Search failed', details: error.message }, 500);
  }
}

/**
 * POST /api/ai-match-rapidapi
 * AI-powered item matching using RapidAPI catalog
 */
async function handleAIMatchRapidAPI(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  
  const { items } = body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Invalid items array' }, 400);
  }

  const apiKey = env.RAPIDAPI_KEY;
  if (!apiKey) {
    return jsonResponse({ 
      error: 'RapidAPI key not configured',
      help: 'Run: wrangler secret put RAPIDAPI_KEY'
    }, 500);
  }

  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return jsonResponse({ 
      error: 'OpenRouter API key not configured',
      help: 'Run: wrangler secret put OPENROUTER_API_KEY'
    }, 500);
  }
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 40000);
    
    // Get all catalog items from RapidAPI
    const catalogItems = await getAllSpecialsRapidAPI(env.SHOPLIST, apiKey, controller.signal);
    
    if (catalogItems.length === 0) {
      return jsonResponse({ 
        error: 'Catalog is empty',
        matches: items.map(item => ({
          userInput: item,
          matches: [],
          bestMatch: null,
        }))
      }, 200);
    }
    
    // Build API keys array for fallback
    const openRouterKeys = [openRouterKey];
    if (env.OPENROUTER_API_KEY_2) {
      openRouterKeys.push(env.OPENROUTER_API_KEY_2);
    }
    
    // Try AI matching
    const matches = await hybridMatch(items, catalogItems, openRouterKeys);
    
    clearTimeout(timeoutId);
    
    // Calculate total savings
    let totalSavings = 0;
    matches.forEach(match => {
      if (match.bestMatch && match.bestMatch.wasPrice) {
        totalSavings += (match.bestMatch.wasPrice - match.bestMatch.price);
      }
    });
    
    return jsonResponse({
      status: 'success',
      matches,
      catalogSize: catalogItems.length,
      totalSavings: Math.round(totalSavings * 100) / 100,
      method: matches[0]?.method || 'ai',
      source: 'RapidAPI',
    });
  } catch (error) {
    console.error('Error in handleAIMatchRapidAPI:', error);
    return jsonResponse({ error: 'AI matching failed', details: error.message }, 500);
  }
}

/**
 * Filter specials by relevance to user's shopping list using AI
 */
async function handleFilterSpecials(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }
  
  const { items, specials } = body;
  
  if (!Array.isArray(items) || items.length === 0) {
    return jsonResponse({ error: 'Invalid items array' }, 400);
  }

  if (!Array.isArray(specials) || specials.length === 0) {
    return jsonResponse({ error: 'Invalid specials array' }, 400);
  }

  const openRouterKey = env.OPENROUTER_API_KEY;
  if (!openRouterKey) {
    return jsonResponse({ 
      error: 'OpenRouter API key not configured',
      help: 'Run: wrangler secret put OPENROUTER_API_KEY'
    }, 500);
  }
  
  try {
    // Limit to first 100 specials to avoid token limits
    const specialsToAnalyze = specials.slice(0, 100);
    
    const prompt = `You are a shopping assistant analyzing special offers.

USER'S SHOPPING LIST:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

SPECIAL OFFERS (${specialsToAnalyze.length} total):
${specialsToAnalyze.map((s, i) => `${i + 1}. ${s.name} - $${s.price} (was $${s.wasPrice}) at ${s.store}`).join('\n')}

TASK: Identify which special offers match items in the shopping list.
Consider:
- Direct matches (e.g., "milk" → "Full Cream Milk")
- Category matches (e.g., "meat" → "Beef Steak", "Chicken")
- Substitutes (e.g., "butter" → "Margarine")
- Complementary items (e.g., "pasta" → "Pasta Sauce")

OUTPUT FORMAT: Return ONLY comma-separated numbers of relevant specials.
Examples: "1,5,12" or "none" if no matches.
NO explanations, NO other text.`;

    // Try with fallback models and API keys
    const DEFAULT_MODEL = env.MODEL ?? 'meta-llama/llama-3.1-8b-instruct:free';
    const FALLBACK_MODELS = ['mistralai/mistral-7b-instruct:free', 'google/gemma-2-9b-it:free'];
    const models = [DEFAULT_MODEL, ...FALLBACK_MODELS];
    
    // NEW: Support for two API keys
    const apiKeys = [env.OPENROUTER_API_KEY];
    if (env.OPENROUTER_API_KEY_2) {
      apiKeys.push(env.OPENROUTER_API_KEY_2);
    }
    
    let aiText = null;
    
    // Try each API key
    for (let keyIndex = 0; keyIndex < apiKeys.length && !aiText; keyIndex++) {
      const currentKey = apiKeys[keyIndex];
      console.log(`Trying filter with API key ${keyIndex + 1}/${apiKeys.length}`);
      
      // Try each model with current API key
      for (const model of models) {
        try {
          console.log(`Trying filter model: ${model} with key ${keyIndex + 1}`);
          
          const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentKey}`,
              'HTTP-Referer': 'https://shared-shopping-list.grocery-shopping-list.workers.dev',
              'X-Title': 'Shared Shopping List - Filter',
            },
            body: JSON.stringify({
              model: model.trim(),
              messages: [
                {
                  role: 'user',
                  content: prompt
                }
              ],
              max_tokens: 500,
              temperature: 0.3,
            }),
          });

          if (aiResponse.ok) {
            const data = await aiResponse.json();
            aiText = data.choices[0].message.content.trim();
            console.log(`✓ AI filtering succeeded with model ${model} and key ${keyIndex + 1}`);
            break; // Success, exit models loop
          } else {
            // Check if we should try next key
            if (aiResponse.status === 429 || aiResponse.status === 402) {
              console.log(`Model ${model} got status ${aiResponse.status} on key ${keyIndex + 1}`);
              if (keyIndex + 1 < apiKeys.length) {
                console.log(`Breaking to try next API key...`);
                break; // Break to try next key
              }
            }
            console.log(`Model ${model} failed with status ${aiResponse.status} on key ${keyIndex + 1}`);
            continue;
          }
        } catch (modelError) {
          console.error(`Error with model ${model} on key ${keyIndex + 1}:`, modelError);
          continue;
        }
      }
    }
    
    if (!aiText) {
      throw new Error('All models failed for filtering');
    }
    
    if (aiText.toLowerCase() === 'none') {
      return jsonResponse({
        status: 'success',
        filtered: [],
        count: 0,
        totalSpecials: specials.length,
      });
    }
    
    // Parse the numbers
    const indices = aiText
      .split(',')
      .map(n => parseInt(n.trim()) - 1) // Convert to 0-based index
      .filter(n => !isNaN(n) && n >= 0 && n < specialsToAnalyze.length);
    
    const filtered = indices.map(i => specialsToAnalyze[i]);
    
    return jsonResponse({
      status: 'success',
      filtered,
      count: filtered.length,
      totalSpecials: specials.length,
      aiResponse: aiText,
    });
  } catch (error) {
    console.error('Error in handleFilterSpecials:', error);
    return jsonResponse({ error: 'AI filtering failed', details: error.message }, 500);
  }
}
