/**
 * Tests for OpenAI vector store creation utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fsMock = {
  access: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
};

const openAiState = {
  failUploads: false,
};

const openAiInstances: MockOpenAI[] = [];

class MockOpenAI {
  public files = {
    create: vi.fn(async () => {
      if (openAiState.failUploads) {
        throw new Error('upload failure');
      }
      return { id: 'file_1' };
    }),
    retrieve: vi.fn(async () => ({ status: 'processed' })),
  };

  public vectorStores = {
    create: vi.fn(async () => ({ id: 'vs_123' })),
    files: {
      create: vi.fn(async () => ({})),
    },
  };

  constructor(public config: { apiKey: string }) {
    // no-op
    openAiInstances.push(this);
  }
}

vi.mock('fs/promises', () => fsMock);
vi.mock('openai', () => ({
  default: MockOpenAI,
}));

describe('createOpenAIVectorStoreFromPath', () => {
  let createOpenAIVectorStoreFromPath: any;

  beforeEach(async () => {
    openAiState.failUploads = false;
    openAiInstances.length = 0;
    fsMock.access.mockReset();
    fsMock.stat.mockReset();
    fsMock.readdir.mockReset();
    fsMock.readFile.mockReset();
    global.File =
      global.File ||
      (class PolyfillFile {
        constructor(public blobs: any[], public name: string, public options: any) {}
      } as any);

    vi.resetModules();
    ({ createOpenAIVectorStoreFromPath } = await import('../../../utils/openai-vector-store'));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('creates a vector store from directory files', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    fsMock.readdir.mockResolvedValue([
      {
        isFile: () => true,
        name: 'doc.txt',
      },
    ]);
    fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const id = await createOpenAIVectorStoreFromPath('/tmp/docs', { apiKey: 'k' });

    expect(id).toBe('vs_123');
    expect(openAiInstances[0].vectorStores.create).toHaveBeenCalled();
    expect(openAiInstances[0].files.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(File),
        purpose: 'assistants',
      })
    );
  });

  it('throws when directory has no supported files', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    fsMock.readdir.mockResolvedValue([]);

    await expect(
      createOpenAIVectorStoreFromPath('/tmp/docs', { apiKey: 'key' })
    ).rejects.toThrow('No supported files found in /tmp/docs');
  });

  it('throws when uploads fail and no files were uploaded', async () => {
    openAiState.failUploads = true;
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    fsMock.readdir.mockResolvedValue([
      {
        isFile: () => true,
        name: 'doc.txt',
      },
    ]);
    fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(
      createOpenAIVectorStoreFromPath('/tmp/docs', { apiKey: 'key' })
    ).rejects.toThrow('No files were successfully uploaded');
  });
});
