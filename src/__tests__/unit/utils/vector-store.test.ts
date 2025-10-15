/**
 * Tests for vector store utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  createVectorStore,
  VectorStoreConfig,
  Document,
} from '../../../utils/vector-store';

const sampleDocs: Document[] = [
  { id: 'doc1', content: 'First', embedding: [1, 0, 0] },
  { id: 'doc2', content: 'Second', embedding: [0, 1, 0] },
];

describe('createVectorStore memory implementation', () => {
  it('creates a memory store and supports CRUD operations', async () => {
    const store = await createVectorStore({
      type: 'memory',
      config: {},
    });

    await store.addDocuments(sampleDocs);
    expect(await store.getDocument('doc1')).toMatchObject({ content: 'First' });

    const results = await store.search('query', 1);
    expect(results).toHaveLength(1);
    expect(results[0].document.id).toBe('doc1');

    await store.deleteDocuments(['doc1']);
    expect(await store.getDocument('doc1')).toBeNull();
  });

  it('returns empty results when no embeddings', async () => {
    const store = await createVectorStore({
      type: 'memory',
      config: {},
    });

    await store.addDocuments([{ id: 'x', content: 'no embed' }]);
    const results = await store.search('q');
    expect(results).toEqual([]);
  });
});

describe('createVectorStore unsupported types', () => {
  const unsupported: Array<VectorStoreConfig['type']> = ['pinecone', 'weaviate', 'chroma'];

  for (const type of unsupported) {
    it(`throws not implemented error for ${type}`, async () => {
      const store = await createVectorStore({ type, config: {} });
      await expect(store.search('hi')).rejects.toThrow('not implemented');
    });
  }
});
