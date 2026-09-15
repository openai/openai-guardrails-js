/**
 * Tests for OpenAI vector store creation utilities.
 */

import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let createOpenAIVectorStoreFromPath: (
    path: string,
    config: { apiKey: string }
  ) => Promise<string>;

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
        constructor(
          public blobs: unknown[],
          public name: string,
          public options: Record<string, unknown>
        ) {}
      } as unknown as typeof File);

    vi.resetModules();
    ({ createOpenAIVectorStoreFromPath } = await import('../../../utils/openai-vector-store'));
  });

  afterEach(() => {
    vi.resetModules();
  });

  it.each(['/tmp/docs', '/tmp/documents.v1', '/tmp/archive.zip'])(
    'creates a vector store from directory files in %s',
    async (path) => {
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

      const id = await createOpenAIVectorStoreFromPath(path, { apiKey: 'k' });

      expect(id).toBe('vs_123');
      expect(openAiInstances[0].vectorStores.create).toHaveBeenCalled();
      expect(openAiInstances[0].files.create).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.any(File),
          purpose: 'assistants',
        })
      );
      expect(fsMock.readFile).toHaveBeenCalledWith(join(path, 'doc.txt'));
    }
  );

  it.each(['/tmp/doc.txt', '/tmp/doc.TXT'])(
    'creates a vector store from the supported file %s',
    async (path) => {
      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      });
      fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

      await expect(createOpenAIVectorStoreFromPath(path, { apiKey: 'k' })).resolves.toBe('vs_123');
      expect(fsMock.readFile).toHaveBeenCalledWith(path);
      expect(fsMock.readdir).not.toHaveBeenCalled();
    }
  );

  it.each(['/tmp/doc.zip', '/tmp/doc'])(
    'rejects the unsupported file %s without uploading',
    async (path) => {
      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      });

      await expect(createOpenAIVectorStoreFromPath(path, { apiKey: 'k' })).rejects.toThrow(
        `No supported files found in ${path}`
      );
      expect(openAiInstances[0].files.create).not.toHaveBeenCalled();
    }
  );

  it('filters unsupported files and subdirectories inside dotted directories', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    fsMock.readdir.mockResolvedValue([
      { isFile: () => true, name: 'doc.TXT' },
      { isFile: () => true, name: 'archive.zip' },
      { isFile: () => true, name: 'no-extension' },
      { isFile: () => false, name: 'nested.txt' },
    ]);
    fsMock.readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await expect(
      createOpenAIVectorStoreFromPath('/tmp/documents.v1', { apiKey: 'k' })
    ).resolves.toBe('vs_123');
    expect(fsMock.readFile).toHaveBeenCalledTimes(1);
    expect(fsMock.readFile).toHaveBeenCalledWith(join('/tmp/documents.v1', 'doc.TXT'));
    expect(openAiInstances[0].files.create).toHaveBeenCalledTimes(1);
  });

  it('throws when directory has no supported files', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
    });
    fsMock.readdir.mockResolvedValue([]);

    await expect(createOpenAIVectorStoreFromPath('/tmp/docs', { apiKey: 'key' })).rejects.toThrow(
      'No supported files found in /tmp/docs'
    );
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

    await expect(createOpenAIVectorStoreFromPath('/tmp/docs', { apiKey: 'key' })).rejects.toThrow(
      'No files were successfully uploaded'
    );
  });
});
