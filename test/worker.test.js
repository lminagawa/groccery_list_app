/**
 * Test suite for Cloudflare Worker API
 * 
 * Tests cover:
 * - Token validation
 * - CORS handling
 * - GET/PUT/DELETE operations
 * - Data validation and normalization
 * - Concurrent edit merging
 * - Version management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/worker.js';

// Mock KV store
class MockKVNamespace {
  constructor() {
    this.data = new Map();
  }

  async get(key, type = 'text') {
    const value = this.data.get(key);
    return value || null;
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async delete(key) {
    this.data.delete(key);
  }

  clear() {
    this.data.clear();
  }
}

// Helper to create mock request
function createRequest(method, path, body = null) {
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new Request(`https://example.com${path}`, init);
}

function createFormRequest(path, formData) {
  return new Request(`https://example.com${path}`, {
    method: 'POST',
    body: formData,
  });
}

describe('Cloudflare Worker API', () => {
  let mockKV;
  let env;

  beforeEach(() => {
    mockKV = new MockKVNamespace();
    env = { SHOPLIST: mockKV };
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight request', async () => {
      const request = createRequest('OPTIONS', '/api/list/test-token-123456');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include CORS headers in all responses', async () => {
      const request = createRequest('GET', '/api/list/test-token-123456');
      const response = await worker.fetch(request, env);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('POST /api/transcribe', () => {
    it('should reject requests without audio file', async () => {
      const formData = new FormData();
      const request = createFormRequest('/api/transcribe', formData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing audio file');
    });

    it('should return transcribed shopping items from Groq response', async () => {
      const originalFetch = globalThis.fetch;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        text: '牛乳とパン、卵を追加してください',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));

      const formData = new FormData();
      formData.append('file', new Blob(['fake audio'], { type: 'audio/webm' }), 'voice.webm');

      const request = createFormRequest('/api/transcribe', formData);
      const response = await worker.fetch(request, { ...env, GROQ_API_KEY: 'test-key' });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.text).toBe('牛乳とパン、卵を追加してください');
      expect(data.items.map((item) => item.label)).toEqual(['牛乳', 'パン', '卵']);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        })
      );

      vi.stubGlobal('fetch', originalFetch);
    });

    it('should report configuration errors when Groq API key is missing', async () => {
      const formData = new FormData();
      formData.append('file', new Blob(['fake audio'], { type: 'audio/webm' }), 'voice.webm');

      const request = createFormRequest('/api/transcribe', formData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.details).toContain('Groq service not configured');
    });
  });

  describe('Token Validation', () => {
    it('should accept valid token (16+ chars, alphanumeric, dash, underscore)', async () => {
      const request = createRequest('GET', '/api/list/valid-token_1234567890');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
    });

    it('should reject token shorter than 16 characters', async () => {
      const request = createRequest('GET', '/api/list/short');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid token format');
    });

    it('should reject token with invalid characters', async () => {
      const request = createRequest('GET', '/api/list/invalid@token#12345');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
    });

    it('should reject invalid path format', async () => {
      const request = createRequest('GET', '/api/invalid/path');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('Invalid path');
    });
  });

  describe('GET /api/list/:token', () => {
    it('should return default document when list does not exist', async () => {
      const request = createRequest('GET', '/api/list/new-token-123456789');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.title).toBe('Shopping');
      expect(data.items).toEqual([]);
      expect(data.version).toBe(0);
      expect(data.updated_at).toBeGreaterThan(0);
    });

    it('should return existing list document', async () => {
      const existingDoc = {
        title: 'Grocery List',
        items: [
          {
            id: 'item-1',
            label: 'Milk',
            checked: false,
            tags: ['woolies'],
            pos: 0,
            updated_at: Date.now(),
          },
        ],
        version: 3,
        updated_at: Date.now(),
      };

      await mockKV.put('list:existing-token-123456', JSON.stringify(existingDoc));

      const request = createRequest('GET', '/api/list/existing-token-123456');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.title).toBe('Grocery List');
      expect(data.items).toHaveLength(1);
      expect(data.items[0].label).toBe('Milk');
      expect(data.version).toBe(3);
    });

    it('should normalize malformed document (missing items)', async () => {
      const malformedDoc = {
        title: 'Test',
        version: 1,
      };

      await mockKV.put('list:malformed-token-12345', JSON.stringify(malformedDoc));

      const request = createRequest('GET', '/api/list/malformed-token-12345');
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items).toEqual([]);
    });
  });

  describe('PUT /api/list/:token', () => {
    it('should create new list with valid data', async () => {
      const newList = {
        title: 'My List',
        items: [
          {
            id: 'item-1',
            label: 'Bread',
            checked: false,
            tags: ['coles'],
            pos: 0,
            updated_at: Date.now(),
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const request = createRequest('PUT', '/api/list/new-list-token-123456', newList);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.title).toBe('My List');
      expect(data.items).toHaveLength(1);
      expect(data.items[0].label).toBe('Bread');
      expect(data.version).toBe(1); // Incremented from 0
    });

    it('should reject invalid JSON', async () => {
      const request = new Request('https://example.com/api/list/token-12345678901234', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid JSON');
    });

    it('should reject missing title', async () => {
      const invalidData = {
        items: [],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', invalidData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid document structure');
    });

    it('should reject missing items array', async () => {
      const invalidData = {
        title: 'Test',
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', invalidData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
    });

    it('should reject item without id', async () => {
      const invalidData = {
        title: 'Test',
        items: [
          {
            label: 'Item without id',
            checked: false,
          },
        ],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', invalidData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
    });

    it('should reject item without label', async () => {
      const invalidData = {
        title: 'Test',
        items: [
          {
            id: 'item-1',
            checked: false,
          },
        ],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', invalidData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
    });

    it('should reject item without checked state', async () => {
      const invalidData = {
        title: 'Test',
        items: [
          {
            id: 'item-1',
            label: 'Test Item',
          },
        ],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', invalidData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
    });

    it('should normalize item positions sequentially', async () => {
      const listData = {
        title: 'Test',
        items: [
          {
            id: 'item-3',
            label: 'Third',
            checked: false,
            tags: [],
            pos: 10,
            updated_at: Date.now(),
          },
          {
            id: 'item-1',
            label: 'First',
            checked: false,
            tags: [],
            pos: 5,
            updated_at: Date.now(),
          },
          {
            id: 'item-2',
            label: 'Second',
            checked: false,
            tags: [],
            pos: 8,
            updated_at: Date.now(),
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', listData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items[0].label).toBe('First');
      expect(data.items[0].pos).toBe(0);
      expect(data.items[1].label).toBe('Second');
      expect(data.items[1].pos).toBe(1);
      expect(data.items[2].label).toBe('Third');
      expect(data.items[2].pos).toBe(2);
    });

    it('should filter out invalid tags', async () => {
      const listData = {
        title: 'Test',
        items: [
          {
            id: 'item-1',
            label: 'Item',
            checked: false,
            tags: ['valid', '', null, 123, 'another-valid'],
            pos: 0,
            updated_at: Date.now(),
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', listData);
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items[0].tags).toEqual(['valid', 'another-valid']);
    });

    it('should set default updated_at if missing or invalid', async () => {
      const beforeTime = Date.now();
      
      const listData = {
        title: 'Test',
        items: [
          {
            id: 'item-1',
            label: 'Item without timestamp',
            checked: false,
            tags: [],
            pos: 0,
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const request = createRequest('PUT', '/api/list/token-12345678901234', listData);
      const response = await worker.fetch(request, env);

      const afterTime = Date.now();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items[0].updated_at).toBeGreaterThanOrEqual(beforeTime);
      expect(data.items[0].updated_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Concurrent Edit Merging', () => {
    it('should merge new items from both users', async () => {
      // User A creates initial list
      const initialData = {
        title: 'Shared List',
        items: [
          {
            id: 'item-a',
            label: 'Item A',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const req1 = createRequest('PUT', '/api/list/shared-token-123456', initialData);
      await worker.fetch(req1, env);

      // User B adds Item B (concurrent with User A potentially adding Item C)
      const userBData = {
        title: 'Shared List',
        items: [
          {
            id: 'item-a',
            label: 'Item A',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
          {
            id: 'item-b',
            label: 'Item B',
            checked: false,
            tags: [],
            pos: 1,
            updated_at: 2000,
          },
        ],
        baseVersion: 1,
        deletedItemIds: [],
      };

      const req2 = createRequest('PUT', '/api/list/shared-token-123456', userBData);
      await worker.fetch(req2, env);

      // User A adds Item C (concurrent operation)
      const userAData = {
        title: 'Shared List',
        items: [
          {
            id: 'item-a',
            label: 'Item A',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
          {
            id: 'item-c',
            label: 'Item C',
            checked: false,
            tags: [],
            pos: 1,
            updated_at: 3000,
          },
        ],
        baseVersion: 1,
        deletedItemIds: [],
      };

      const req3 = createRequest('PUT', '/api/list/shared-token-123456', userAData);
      const response = await worker.fetch(req3, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Both Item B and Item C should be present
      expect(data.items).toHaveLength(3);
      const labels = data.items.map(item => item.label).sort();
      expect(labels).toEqual(['Item A', 'Item B', 'Item C']);
    });

    it('should keep newer version of same item based on updated_at', async () => {
      // Initial state
      const initialData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Milk',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const req1 = createRequest('PUT', '/api/list/merge-token-123456', initialData);
      await worker.fetch(req1, env);

      // User A checks the item (older timestamp)
      const userAData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Milk',
            checked: true,
            tags: [],
            pos: 0,
            updated_at: 2000,
          },
        ],
        baseVersion: 1,
        deletedItemIds: [],
      };

      const req2 = createRequest('PUT', '/api/list/merge-token-123456', userAData);
      await worker.fetch(req2, env);

      // User B edits the label (newer timestamp)
      const userBData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Milk (2L)',
            checked: false,
            tags: ['woolies'],
            pos: 0,
            updated_at: 3000, // Newer than User A
          },
        ],
        baseVersion: 1,
        deletedItemIds: [],
      };

      const req3 = createRequest('PUT', '/api/list/merge-token-123456', userBData);
      const response = await worker.fetch(req3, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // User B's version should win (newer timestamp)
      expect(data.items[0].label).toBe('Milk (2L)');
      expect(data.items[0].checked).toBe(false);
      expect(data.items[0].tags).toEqual(['woolies']);
    });

    it('should handle deletion in concurrent edits', async () => {
      // Initial state with 2 items
      const initialData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Item 1',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
          {
            id: 'item-2',
            label: 'Item 2',
            checked: false,
            tags: [],
            pos: 1,
            updated_at: 1000,
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const req1 = createRequest('PUT', '/api/list/delete-token-123456', initialData);
      await worker.fetch(req1, env);

      // User A deletes item-1
      const userAData = {
        title: 'List',
        items: [
          {
            id: 'item-2',
            label: 'Item 2',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
        ],
        baseVersion: 1,
        deletedItemIds: ['item-1'],
      };

      const req2 = createRequest('PUT', '/api/list/delete-token-123456', userAData);
      const response = await worker.fetch(req2, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // item-1 should be deleted
      expect(data.items).toHaveLength(1);
      expect(data.items[0].id).toBe('item-2');
    });

    it('should preserve items not in payload unless explicitly deleted', async () => {
      // Initial state with 3 items
      const initialData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Item 1',
            checked: false,
            tags: [],
            pos: 0,
            updated_at: 1000,
          },
          {
            id: 'item-2',
            label: 'Item 2',
            checked: false,
            tags: [],
            pos: 1,
            updated_at: 1000,
          },
          {
            id: 'item-3',
            label: 'Item 3',
            checked: false,
            tags: [],
            pos: 2,
            updated_at: 1000,
          },
        ],
        baseVersion: 0,
        deletedItemIds: [],
      };

      const req1 = createRequest('PUT', '/api/list/preserve-token-123', initialData);
      await worker.fetch(req1, env);

      // User A only updates item-1 (doesn't include item-2 or item-3 in payload)
      const userAData = {
        title: 'List',
        items: [
          {
            id: 'item-1',
            label: 'Item 1 Updated',
            checked: true,
            tags: [],
            pos: 0,
            updated_at: 2000,
          },
        ],
        baseVersion: 1,
        deletedItemIds: [],
      };

      const req2 = createRequest('PUT', '/api/list/preserve-token-123', userAData);
      const response = await worker.fetch(req2, env);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // All 3 items should still exist
      expect(data.items).toHaveLength(3);
      
      const item1 = data.items.find(i => i.id === 'item-1');
      expect(item1.label).toBe('Item 1 Updated');
      expect(item1.checked).toBe(true);
      
      const item2 = data.items.find(i => i.id === 'item-2');
      expect(item2).toBeDefined();
      expect(item2.label).toBe('Item 2');
      
      const item3 = data.items.find(i => i.id === 'item-3');
      expect(item3).toBeDefined();
      expect(item3.label).toBe('Item 3');
    });
  });

  describe('Version Management', () => {
    it('should increment version on each update', async () => {
      const token = 'version-token-123456';
      
      // First PUT
      const data1 = {
        title: 'List',
        items: [],
        baseVersion: 0,
        deletedItemIds: [],
      };
      
      const req1 = createRequest('PUT', `/api/list/${token}`, data1);
      const res1 = await worker.fetch(req1, env);
      const result1 = await res1.json();
      
      expect(result1.version).toBe(1);
      
      // Second PUT
      const data2 = {
        title: 'List',
        items: [],
        baseVersion: 1,
        deletedItemIds: [],
      };
      
      const req2 = createRequest('PUT', `/api/list/${token}`, data2);
      const res2 = await worker.fetch(req2, env);
      const result2 = await res2.json();
      
      expect(result2.version).toBe(2);
      
      // Third PUT
      const data3 = {
        title: 'List',
        items: [],
        baseVersion: 2,
        deletedItemIds: [],
      };
      
      const req3 = createRequest('PUT', `/api/list/${token}`, data3);
      const res3 = await worker.fetch(req3, env);
      const result3 = await res3.json();
      
      expect(result3.version).toBe(3);
    });

    it('should update updated_at timestamp on PUT', async () => {
      const beforeTime = Date.now();
      
      const data = {
        title: 'List',
        items: [],
        baseVersion: 0,
        deletedItemIds: [],
      };
      
      const request = createRequest('PUT', '/api/list/timestamp-token-123', data);
      const response = await worker.fetch(request, env);
      
      const afterTime = Date.now();
      const result = await response.json();
      
      expect(result.updated_at).toBeGreaterThanOrEqual(beforeTime);
      expect(result.updated_at).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('DELETE /api/list/:token', () => {
    it('should delete existing list', async () => {
      const token = 'delete-test-token-123';
      
      // Create a list first
      const data = {
        title: 'To Delete',
        items: [],
        baseVersion: 0,
        deletedItemIds: [],
      };
      
      const putReq = createRequest('PUT', `/api/list/${token}`, data);
      await worker.fetch(putReq, env);
      
      // Verify it exists
      const getReq1 = createRequest('GET', `/api/list/${token}`);
      const getRes1 = await worker.fetch(getReq1, env);
      const getData1 = await getRes1.json();
      expect(getData1.title).toBe('To Delete');
      
      // Delete it
      const deleteReq = createRequest('DELETE', `/api/list/${token}`);
      const deleteRes = await worker.fetch(deleteReq, env);
      
      expect(deleteRes.status).toBe(200);
      const deleteData = await deleteRes.json();
      expect(deleteData.ok).toBe(true);
      
      // Verify it returns default after deletion
      const getReq2 = createRequest('GET', `/api/list/${token}`);
      const getRes2 = await worker.fetch(getReq2, env);
      const getData2 = await getRes2.json();
      expect(getData2.title).toBe('Shopping'); // Default title
      expect(getData2.items).toEqual([]);
    });
  });

  describe('HTTP Method Handling', () => {
    it('should reject unsupported HTTP methods', async () => {
      const request = new Request('https://example.com/api/list/token-12345678901234', {
        method: 'PATCH',
      });

      const response = await worker.fetch(request, env);

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data.error).toContain('Method not allowed');
    });
  });

  describe('POST /api/generate - AI Shopping List Generation', () => {
    let consoleErrorSpy;

    beforeEach(() => {
      // Mock OpenRouter API key
      env.OPENROUTER_API_KEY = 'test-api-key';
      env.MODEL = 'meta-llama/llama-3-70b-instruct';
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      if (consoleErrorSpy) {
        consoleErrorSpy.mockRestore();
      }
    });

    it('should reject request without prompt', async () => {
      const request = createRequest('POST', '/api/generate', {
        token: 'test-token-123456',
      });
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('prompt');
    });

    it('should reject request without token', async () => {
      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト用の買い物リスト',
      });
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('token');
    });

    it('should reject request with invalid token format', async () => {
      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト用の買い物リスト',
        token: 'short',
      });
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Invalid token format');
    });

    it('should reject request with empty prompt', async () => {
      const request = createRequest('POST', '/api/generate', {
        prompt: '   ',
        token: 'test-token-123456',
      });
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('prompt');
    });

    it('should handle missing API key gracefully', async () => {
      delete env.OPENROUTER_API_KEY;

      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト用の買い物リスト',
        token: 'test-token-123456',
      });
      const response = await worker.fetch(request, env);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('AI service not configured');
    });

  it('should successfully generate suggestions with mocked OpenRouter response', async () => {
      const token = 'generate-test-token-123';
      
      // Mock global fetch for OpenRouter API
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url, options) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [
                        { label: '牛乳', tags: ['Woolies'], checked: false },
                        { label: 'パン', tags: ['Coles'], checked: false },
                        { label: '卵', tags: ['ALDI'], checked: false },
                      ],
                    }),
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url, options);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: '週末の朝食用の買い物リスト',
        token: token,
      });

      const response = await worker.fetch(request, env);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.suggestions).toHaveLength(3);
      expect(data.suggestions[0].label).toBe('牛乳');
      expect(data.suggestions[0].tags).toEqual(['Woolies']);
      expect(data.suggestions[0].checked).toBe(true);
      expect(data.suggestions[0].id).toBeDefined();
      expect(data.suggestions[0].pos).toBe(0);
      expect(data.suggestions[0].updated_at).toBeDefined();

      // Restore original fetch
      global.fetch = originalFetch;
    });

    it('should handle OpenRouter response with code fences', async () => {
      const token = 'generate-fence-token-123';
      
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: '```json\n{"items":[{"label":"トマト","tags":["Asian Grocery"],"checked":false}]}\n```',
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'アジア食材の買い物',
        token: token,
      });

      const response = await worker.fetch(request, env);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.suggestions).toHaveLength(1);
      expect(data.suggestions[0].label).toBe('トマト');

      global.fetch = originalFetch;
    });

    it('should use only first tag when multiple tags provided', async () => {
      const token = 'multi-tag-token-123';
      
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [
                        { label: 'りんご', tags: ['Woolies', 'Coles', 'ALDI'], checked: false },
                      ],
                    }),
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'フルーツ',
        token: token,
      });

      const response = await worker.fetch(request, env);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.suggestions[0].tags).toEqual(['Woolies']); // Only first tag

      global.fetch = originalFetch;
    });

    it('should handle OpenRouter API error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト',
        token: 'error-token-123456',
      });

      const response = await worker.fetch(request, env);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('AI生成に失敗しました');
      expect(data.details).toBeDefined();

      global.fetch = originalFetch;
    });

    it('should handle invalid JSON response from OpenRouter', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: 'This is not valid JSON',
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト',
        token: 'invalid-json-token-123',
      });

      const response = await worker.fetch(request, env);
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
      expect(data.details).toBe('Invalid JSON');

      global.fetch = originalFetch;
    });

    it('should truncate long item labels to 64 characters', async () => {
      const token = 'long-label-token-123';
      
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [
                        { 
                          label: 'これは非常に長いアイテム名で64文字を超えているため切り詰められるべきです。これは非常に長いアイテム名で64文字を超えているため切り詰められるべきです。', 
                          tags: [], 
                          checked: false 
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト',
        token: token,
      });

      const response = await worker.fetch(request, env);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.suggestions[0].label.length).toBeLessThanOrEqual(64);

      global.fetch = originalFetch;
    });

    it('should not modify existing list until user confirmation', async () => {
      const token = 'version-test-token-123';
      
      // Create initial list
      const putReq = createRequest('PUT', `/api/list/${token}`, {
        title: 'Existing List',
        items: [],
        baseVersion: 0,
        deletedItemIds: [],
      });
      await worker.fetch(putReq, env);

      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [{ label: 'テストアイテム', tags: [], checked: false }],
                    }),
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const genReq = createRequest('POST', '/api/generate', {
        prompt: 'テスト',
        token: token,
      });
      await worker.fetch(genReq, env);

      // Check list remains unchanged (no automatic save)
      const getReq = createRequest('GET', `/api/list/${token}`);
      const getRes = await worker.fetch(getReq, env);
      const savedData = await getRes.json();
      
      expect(savedData.version).toBe(1); // Remains unchanged until user adds items manually
      expect(savedData.items).toHaveLength(0);

      global.fetch = originalFetch;
    });

    it('should include CORS headers in generate response', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn((url) => {
        if (url.includes('openrouter.ai')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      items: [{ label: 'テスト', tags: [], checked: false }],
                    }),
                  },
                },
              ],
            }),
          });
        }
        return originalFetch(url);
      });

      const request = createRequest('POST', '/api/generate', {
        prompt: 'テスト',
        token: 'cors-test-token-123',
      });

      const response = await worker.fetch(request, env);
      
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');

      global.fetch = originalFetch;
    });
  });
});
