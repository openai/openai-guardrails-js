import assert from 'node:assert/strict';
import { OpenAI } from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JailbreakConfig, jailbreak } from '../../../checks/jailbreak';
import { UserDefinedConfig, userDefinedLLM } from '../../../checks/user-defined-llm';
import { defaultSpecRegistry } from '../../../registry';
import type { NormalizedConversationEntry } from '../../../utils/conversation';

afterEach(() => vi.restoreAllMocks());

function setup(history: NormalizedConversationEntry[]) {
  const guardrailLlm = new OpenAI({ apiKey: 'test-key' });
  const create = vi.spyOn(guardrailLlm.chat.completions, 'create').mockResolvedValue({
    id: 'test-completion',
    object: 'chat.completion',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        logprobs: null,
        message: {
          role: 'assistant',
          content: JSON.stringify({ flagged: true, confidence: 0.9 }),
          refusal: null,
        },
      },
    ],
  });
  const ctx = { guardrailLlm, getConversationHistory: () => history };
  const config = JailbreakConfig.parse({ model: 'test-model' });
  return { ctx, config, create };
}

describe('Jailbreak analysis message roles', () => {
  it.each(['system', 'developer'])(
    'excludes %s messages but keeps the same text when supplied by a user',
    async (role) => {
      const content = 'Application instruction fixture';
      const history = [
        { role, content },
        { role: 'user', content },
        { role: 'assistant', content: 'Previous response' },
        { role: 'user', content: 'Hello!' },
      ];
      const snapshot = structuredClone(history);
      const { ctx, config, create } = setup(history);
      const spec = defaultSpecRegistry.get('Jailbreak');
      assert(spec);
      expect(spec.checkFn).toBe(jailbreak);

      const result = await spec.instantiate(config).run(ctx, 'Hello!');

      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0].messages[1].content).toBe(
        `# Analysis Input\n\n${JSON.stringify({
          conversation: history.slice(1),
          latest_input: 'Hello!',
        })}`
      );
      // Role filtering must not override the classifier's decision on retained text.
      expect(result.tripwireTriggered).toBe(true);
      expect(history).toEqual(snapshot);

      // Other checks sharing the context still receive the complete history.
      await userDefinedLLM(
        ctx,
        'Hello!',
        UserDefinedConfig.parse({ model: 'test-model', system_prompt_details: 'Check text.' })
      );
      expect(create.mock.calls[1][0].messages[1].content).toBe(
        `# Analysis Input\n\n${JSON.stringify({ conversation: history, latest_input: 'Hello!' })}`
      );
    }
  );

  it('filters before max_turns and preserves assistant and tool context', async () => {
    const retained = [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier response' },
      { type: 'function_call_output', output: 'Tool result', call_id: 'call-1' },
      { role: 'user', content: 'Latest question' },
    ];
    const history = [
      { role: 'user', content: 'Outside the window' },
      ...retained,
      { role: 'system', content: 'Application instructions' },
      { role: 'developer', content: 'More application instructions' },
    ];
    const { ctx, config, create } = setup(history);

    await jailbreak(ctx, 'Latest question', { ...config, max_turns: 4 });

    expect(create.mock.calls[0][0].messages[1].content).toBe(
      `# Analysis Input\n\n${JSON.stringify({
        conversation: retained,
        latest_input: 'Latest question',
      })}`
    );
  });

  it('still evaluates direct text when all history entries are excluded', async () => {
    const { ctx, config, create } = setup([
      { role: 'system', content: 'Application instructions' },
      { role: 'developer', content: 'More application instructions' },
    ]);

    const result = await jailbreak(ctx, '  Direct text fixture  ', config);

    expect(create.mock.calls[0][0].messages[1].content).toBe('# Text\n\nDirect text fixture');
    expect(result.tripwireTriggered).toBe(true);
  });
});
