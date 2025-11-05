#!/usr/bin/env node
/**
 * PII Masking Example: Interactive chat with GuardrailsOpenAI.
 *
 * Demonstrates how to mask PII in the pre-flight stage (block=false) so that
 * user inputs are sanitized before reaching the model, while also blocking
 * PII that appears in the model's output (block=true).
 *
 * Highlights:
 * - Pre-flight PII guardrail automatically replaces detected entities with tokens like <EMAIL_ADDRESS>
 * - Encoded PII detection (Base64/URL/hex) is enabled via detect_encoded_pii
 * - Output stage blocks responses when PII is detected in the model reply
 * - Console output shows what was masked and which entities were found
 *
 * Run with: npx tsx pii_mask_example.ts
 *
 * Prerequisites:
 * - Set OPENAI_API_KEY in your environment
 */

import * as readline from 'readline';
import {
  GuardrailResult,
  GuardrailTripwireTriggered,
  GuardrailsOpenAI,
  GuardrailsResponse,
} from '../../src';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const PIPELINE_CONFIG = {
  version: 1,
  pre_flight: {
    version: 1,
    guardrails: [
      {
        name: 'Contains PII',
        config: {
          entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN'],
          block: false,
          detect_encoded_pii: true,
        },
      },
    ],
  },
  input: {
    version: 1,
    guardrails: [
      {
        name: 'Moderation',
        config: {
          categories: ['hate', 'violence'],
        },
      },
    ],
  },
  output: {
    version: 1,
    guardrails: [
      {
        name: 'Contains PII',
        config: {
          entities: ['EMAIL_ADDRESS', 'PHONE_NUMBER', 'US_SSN'],
          block: true,
          detect_encoded_pii: true,
        },
      },
    ],
  },
};

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\nEnter a message (or type "exit"): ',
  });
}

function formatEntitySummary(entities: Record<string, string[]> | undefined): string {
  if (!entities) {
    return 'None';
  }
  const parts: string[] = [];
  for (const [entity, matches] of Object.entries(entities)) {
    parts.push(`${entity} (${matches.length})`);
  }
  return parts.length ? parts.join(', ') : 'None';
}

function logPiiMasking(result: GuardrailResult, originalInput: string): void {
  const info = result.info ?? {};
  const masked = typeof info.checked_text === 'string' ? info.checked_text : originalInput;
  const detected = info.detected_entities as Record<string, string[]> | undefined;
  const stage = info.stage_name ?? 'pre_flight';

  console.log(`\n🪪  PII detected and masked (${stage} stage)`);
  console.log('Original :', originalInput);
  console.log('Sanitized:', masked);
  console.log('Entities :', formatEntitySummary(detected));
}

function logPiiInOutput(result: GuardrailResult): void {
  const info = result.info ?? {};
  const detected = info.detected_entities as Record<string, string[]> | undefined;
  const stage = info.stage_name ?? 'output';
  console.log(`\n⚠️  PII detected – response blocked (${stage} stage).`);
  console.log('Entities :', formatEntitySummary(detected));
}

function inspectGuardrailResults(
  response: GuardrailsResponse,
  originalInput: string
): void {
  const results = response.guardrail_results;

  if (results.preflight.length > 0) {
    for (const result of results.preflight) {
      const info = result.info ?? {};
      if (info.guardrail_name === 'Contains PII' && info.pii_detected) {
        logPiiMasking(result, originalInput);
      }
    }
  }

  if (results.output.length > 0) {
    for (const result of results.output) {
      const info = result.info ?? {};
      if (info.guardrail_name === 'Contains PII' && result.tripwireTriggered) {
        logPiiInOutput(result);
      }
    }
  }
}

async function processInput(
  client: GuardrailsOpenAI,
  userInput: string,
  conversation: ChatMessage[]
): Promise<void> {
  const messages = [...conversation, { role: 'user' as const, content: userInput }];

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages,
  });

  inspectGuardrailResults(response, userInput);

  const assistantMessage = response.choices[0]?.message?.content ?? '';
  console.log('\n🤖 Assistant:', assistantMessage.trim());

  conversation.push({ role: 'user', content: userInput });
  conversation.push({ role: 'assistant', content: assistantMessage });
}

async function main(): Promise<void> {
  console.log('🔐 Guardrails PII Masking Example');
  console.log(' - Pre-flight guardrail masks PII before it hits the model');
  console.log(' - Output guardrail blocks replies that contain PII');

  const client = await GuardrailsOpenAI.create(PIPELINE_CONFIG);
  const conversation: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant. Keep responses concise.',
    },
  ];

  const rl = createInterface();
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    try {
      await processInput(client, input, conversation);
    } catch (error) {
      if (error instanceof GuardrailTripwireTriggered) {
        const info = error.guardrailResult.info ?? {};
        const stage = info.stage_name ?? 'unknown';
        console.log(
          `\n🛑 Guardrail triggered in ${stage} stage: ${info.guardrail_name ?? 'Unknown guardrail'}`
        );
        console.log(JSON.stringify(error.guardrailResult, null, 2));
      } else {
        console.error('\n❌ Error processing request:', error instanceof Error ? error.message : error);
      }
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('\n👋 Exiting the program.');
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
