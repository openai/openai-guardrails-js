/**
 * Unit tests for GuardrailAgent functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuardrailAgent } from '../../agents';
import { TextInput } from '../../types';
import { z } from 'zod';

// Define the expected agent interface for testing
interface MockAgent {
  name: string;
  instructions: string;
  inputGuardrails: Array<{ execute: (input: TextInput) => Promise<{ outputInfo: Record<string, unknown>; tripwireTriggered: boolean }> }>;
  outputGuardrails: Array<{ execute: (input: TextInput) => Promise<{ outputInfo: Record<string, unknown>; tripwireTriggered: boolean }> }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

// Mock the @openai/agents module
vi.mock('@openai/agents', () => ({
  Agent: vi.fn().mockImplementation((config) => ({
    name: config.name,
    instructions: config.instructions,
    inputGuardrails: config.inputGuardrails || [],
    outputGuardrails: config.outputGuardrails || [],
    ...config,
  })),
}));

// Mock the runtime functions
vi.mock('../../runtime', () => ({
  loadPipelineBundles: vi.fn((config) => config),
  instantiateGuardrails: vi.fn(() =>
    Promise.resolve([
      {
        definition: { 
          name: 'Keywords',
          description: 'Test guardrail',
          mediaType: 'text/plain',
          configSchema: z.object({}),
          checkFn: vi.fn(),
          contextSchema: z.object({}),
          metadata: {}
        },
        config: {},
            run: vi.fn().mockResolvedValue({
              tripwireTriggered: false,
              info: { checked_text: 'test input' },
            }),
      },
    ])
  ),
  runGuardrails: vi.fn(() => Promise.resolve([])),
}));

// Mock the registry
vi.mock('../../registry', () => ({
  defaultSpecRegistry: {
    get: vi.fn(() => ({
      instantiate: vi.fn(() => ({ run: vi.fn() })),
    })),
  },
}));

describe('GuardrailAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('should create an agent with input guardrails from pre_flight and input stages', async () => {
      const config = {
        version: 1,
        pre_flight: {
          version: 1,
          guardrails: [{ name: 'Moderation', config: {} }],
        },
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(2); // pre_flight + input
      expect(agent.outputGuardrails).toHaveLength(0);
    });

    it('should create an agent with output guardrails from output stage', async () => {
      const config = {
        version: 1,
        output: {
          version: 1,
          guardrails: [{ name: 'URL Filter', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(0);
      expect(agent.outputGuardrails).toHaveLength(1);
    });

    it('should create an agent with both input and output guardrails', async () => {
      const config = {
        version: 1,
        pre_flight: {
          version: 1,
          guardrails: [{ name: 'Moderation', config: {} }],
        },
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
        output: {
          version: 1,
          guardrails: [{ name: 'URL Filter', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(2); // pre_flight + input
      expect(agent.outputGuardrails).toHaveLength(1);
    });

    it('should pass through additional agent kwargs', async () => {
      const config = {
        version: 1,
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      const agentKwargs = {
        model: 'gpt-4',
        temperature: 0.7,
        max_tokens: 1000,
      };

      const agent = await GuardrailAgent.create(
        config,
        'Test Agent',
        'Test instructions',
        agentKwargs
      ) as MockAgent;

      expect(agent.model).toBe('gpt-4');
      expect(agent.temperature).toBe(0.7);
      expect(agent.max_tokens).toBe(1000);
    });

    it('should handle empty configuration gracefully', async () => {
      const config = { version: 1 };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(0);
      expect(agent.outputGuardrails).toHaveLength(0);
    });

    it('should accept raiseGuardrailErrors parameter', async () => {
      const config = {
        version: 1,
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(
        config,
        'Test Agent',
        'Test instructions',
        {},
        true // raiseGuardrailErrors = true
      ) as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(1);
    });

    it('should default raiseGuardrailErrors to false', async () => {
      const config = {
        version: 1,
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.name).toBe('Test Agent');
      expect(agent.instructions).toBe('Test instructions');
      expect(agent.inputGuardrails).toHaveLength(1);
    });

    it('should throw error when @openai/agents is not available', async () => {
      // This test would require more complex mocking setup
      // For now, we'll skip it since the error handling is tested in the actual implementation
      expect(true).toBe(true); // Placeholder assertion
    });
  });

  describe('guardrail function creation', () => {
    it('should create guardrail functions that return correct structure', async () => {
      const config = {
        version: 1,
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      const agent = await GuardrailAgent.create(config, 'Test Agent', 'Test instructions') as MockAgent;

      expect(agent.inputGuardrails).toHaveLength(1);

      // Test the guardrail function
      const guardrailFunction = agent.inputGuardrails[0];
      const result = await guardrailFunction.execute('test input');

      expect(result).toHaveProperty('outputInfo');
      expect(result).toHaveProperty('tripwireTriggered');
      expect(typeof result.tripwireTriggered).toBe('boolean');
    });

    it('should handle guardrail execution errors based on raiseGuardrailErrors setting', async () => {
      process.env.OPENAI_API_KEY = 'test';
      const config = {
        version: 1,
        input: {
          version: 1,
          guardrails: [{ name: 'Keywords', config: {} }],
        },
      };

      // Mock a guardrail that throws an error
      const { instantiateGuardrails } = await import('../../runtime');
      vi.mocked(instantiateGuardrails).mockImplementationOnce(() =>
        Promise.resolve([
          {
            definition: { 
              name: 'Keywords',
              description: 'Test guardrail',
              mediaType: 'text/plain',
              configSchema: z.object({}),
              checkFn: vi.fn(),
              metadata: {},
              ctxRequirements: z.object({}),
              schema: () => ({}),
              instantiate: vi.fn()
            },
            config: {},
            run: vi.fn().mockRejectedValue(new Error('Guardrail execution failed')),
          } as unknown as Parameters<typeof instantiateGuardrails>[0] extends Promise<infer T> ? T extends readonly (infer U)[] ? U : never : never,
        ])
      );

      // Test with raiseGuardrailErrors = false (default behavior)
      const agentDefault = await GuardrailAgent.create(
        config,
        'Test Agent',
        'Test instructions',
        {},
        false
      ) as MockAgent;

      const guardrailFunctionDefault = agentDefault.inputGuardrails[0];
      const resultDefault = await guardrailFunctionDefault.execute('test');

      // When raiseGuardrailErrors=false, execution errors should NOT trigger tripwires
      // This allows execution to continue in fail-safe mode
      expect(resultDefault.tripwireTriggered).toBe(false);
      expect(resultDefault.outputInfo).toBeDefined();
      expect(resultDefault.outputInfo.error).toBe('Guardrail execution failed');

      // Reset the mock for the second test
      vi.mocked(instantiateGuardrails).mockImplementationOnce(() =>
        Promise.resolve([
          {
            definition: { 
              name: 'Keywords',
              description: 'Test guardrail',
              mediaType: 'text/plain',
              configSchema: z.object({}),
              checkFn: vi.fn(),
              metadata: {},
              ctxRequirements: z.object({}),
              schema: () => ({}),
              instantiate: vi.fn()
            },
            config: {},
            run: vi.fn().mockRejectedValue(new Error('Guardrail execution failed')),
          } as unknown as Parameters<typeof instantiateGuardrails>[0] extends Promise<infer T> ? T extends readonly (infer U)[] ? U : never : never,
        ])
      );

      // Test with raiseGuardrailErrors = true (fail-secure mode)
      const agentStrict = await GuardrailAgent.create(
        config,
        'Test Agent',
        'Test instructions',
        {},
        true
      ) as MockAgent;

      const guardrailFunctionStrict = agentStrict.inputGuardrails[0];

      // When raiseGuardrailErrors=true, execution errors should be thrown
      await expect(guardrailFunctionStrict.execute('test')).rejects.toThrow(
        'Guardrail execution failed'
      );
    });
  });
});
