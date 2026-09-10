import { Agent, tool } from '@openai/agents';
import { OpenAI } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { z as z3 } from 'zod/v3';
import {
  GuardrailRegistry,
  GuardrailsAzureOpenAI,
  GuardrailsOpenAI,
  LLMConfig,
  LLMOutput,
  runLLM,
} from '../../../..';

const registry = new GuardrailRegistry();
const configSchema = z.object({ limit: z.number().default(3) });
registry.register(
  'custom',
  (_context, text: string, config: z.output<typeof configSchema>) => ({
    tripwireTriggered: text.length > config.limit,
    info: {},
  }),
  'Custom Zod 4 config',
  'text/plain',
  configSchema
);
// @ts-expect-error Zod 3 configuration schemas are no longer compatible.
const oldSchema: z.ZodType = z3.object({});
void oldSchema;

const modelConfig: z.input<typeof LLMConfig> = { model: 'test-model' };
const parsedConfig: z.output<typeof LLMConfig> = LLMConfig.parse(modelConfig);
const confidence: number = parsedConfig.confidence_threshold;
const output = LLMOutput.extend({ labels: z.array(z.string()) });
const openai = new OpenAI({ apiKey: 'test-key' });
void runLLM('text', 'Check', openai, 'test-model', output).then(([result]) => {
  const flagged: boolean = result.flagged;
  return flagged;
});
void confidence;

const agentTool = tool({
  name: 'echo',
  description: 'Echo text',
  parameters: z.object({ text: z.string() }),
  execute: async ({ text }) => text,
});
new Agent({ name: 'typed', tools: [agentTool], outputType: z.object({ answer: z.string() }) });

async function clients() {
  const client = await GuardrailsOpenAI.create({ version: 1 }, { apiKey: 'test-key' });
  await client.guardrails.chat.completions.create(
    {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      response_format: zodResponseFormat(output, 'output'),
    },
    { maxRetries: 0, headers: { 'x-test': 'yes' } }
  );
  const azure = await GuardrailsAzureOpenAI.create(
    { version: 1 },
    {
      apiKey: 'test-key',
      endpoint: 'https://example.openai.azure.com',
      apiVersion: 'test',
    }
  );
  await azure.guardrails.responses.create({ model: 'test-model', input: 'Hello' });
}
void clients;
