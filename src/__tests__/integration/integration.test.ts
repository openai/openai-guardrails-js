/**
 * Integration tests for the guardrails system.
 *
 * This module tests the complete integration of all components including:
 * - Guardrail registration and execution
 * - Configuration bundle loading
 * - Error handling
 * - Performance and scalability
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GuardrailRegistry } from '../../registry';
import { CheckFn } from '../../types';
import { loadConfigBundle } from '../../runtime';

// Mock check function for testing
const mockCheck: CheckFn<object, string, object> = (ctx, data) => ({
  tripwireTriggered: data === 'trigger',
  info: {
    sampled_text: data,
  },
});

describe('Integration Tests', () => {
  let registry: GuardrailRegistry;

  beforeEach(() => {
    registry = new GuardrailRegistry();

    // Register test guardrails
    registry.register('test_guard', mockCheck, 'Test guardrail', 'text/plain');

    registry.register('trigger_guard', mockCheck, 'Trigger guardrail', 'text/plain');
  });

  describe('Guardrail Registration and Execution', () => {
    it('should register and execute guardrails', () => {
      const spec = registry.get('test_guard');
      expect(spec).toBeDefined();
      expect(spec!.name).toBe('test_guard');

      const guardrail = spec!.instantiate({});
      expect(guardrail).toBeDefined();
    });

    it('should handle multiple guardrails in sequence', () => {
      const spec1 = registry.get('test_guard');
      const spec2 = registry.get('trigger_guard');

      expect(spec1).toBeDefined();
      expect(spec2).toBeDefined();
      expect(spec1!.name).toBe('test_guard');
      expect(spec2!.name).toBe('trigger_guard');
    });

    it('should execute guardrails with different inputs', async () => {
      const spec = registry.get('test_guard');
      const guardrail = spec!.instantiate({});

      // Test non-triggering input
      const result1 = await guardrail.run({}, 'safe data');
      expect(result1.tripwireTriggered).toBe(false);

      // Test triggering input
      const result2 = await guardrail.run({}, 'trigger');
      expect(result2.tripwireTriggered).toBe(true);
    });
  });

  describe('Configuration Bundle Loading', () => {
    it('should load and validate configuration bundle', () => {
      const bundleJson = JSON.stringify({
        version: 1,
        stageName: 'test',
        guardrails: [
          {
            name: 'test_guard',
            config: { threshold: 10 },
          },
        ],
      });

      const bundle = loadConfigBundle(bundleJson);
      expect(bundle.version).toBe(1);
      expect(bundle.stageName).toBe('test');
      expect(bundle.guardrails).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid guardrail names gracefully', () => {
      const spec = registry.get('nonexistent_guard');
      expect(spec).toBeUndefined();
    });

    it('should handle malformed configuration bundles', () => {
      const invalidBundle = JSON.stringify({
        stageName: 'test',
        // Missing required fields
      });

      expect(() => loadConfigBundle(invalidBundle)).toThrow();
    });

    // TODO: Add test for runtime errors once registry mocking is resolved
    it('should have placeholder for runtime error tests', () => {
      expect(true).toBe(true);
    });
  });

  // TODO: Add performance tests once registry mocking is resolved
  describe('Performance and Scalability', () => {
    it('should have placeholder for performance tests', () => {
      expect(true).toBe(true);
    });
  });
});
