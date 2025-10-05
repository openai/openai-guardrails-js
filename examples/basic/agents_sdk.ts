#!/usr/bin/env node
/**
 * Example: Basic async guardrail bundle using Agents SDK with GuardrailAgent.
 *
 * Run with: npx tsx agents_sdk.ts
 *
 * Prerequisites:
 * - Install @openai/agents: npm install @openai/agents
 * - Set OPENAI_API_KEY environment variable
 */

import * as readline from 'readline';
import { GuardrailAgent } from '../../src';
import { InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered } from '@openai/agents';

// Define your pipeline configuration
const PIPELINE_CONFIG = {
  version: 1,
  pre_flight: {
    version: 1,
    guardrails: [
      {
        name: 'Moderation',
        config: {
          categories: ['hate', 'violence', 'self-harm'],
        },
      },
    ],
  },
  input: {
    version: 1,
    guardrails: [
      {
        name: 'Custom Prompt Check',
        config: {
          model: 'gpt-4.1-nano-2025-04-14',
          confidence_threshold: 0.7,
          system_prompt_details: 'Check if the text contains any math problems.',
        },
      },
    ],
  },
  output: {
    version: 1,
    guardrails: [{ name: 'URL Filter', config: { url_allow_list: ['example.com'] } }],
  },
};

/**
 * Create a readline interface for user input.
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Main input loop for the customer support agent with input/output guardrails.
 */
async function main(): Promise<void> {
  console.log('🤖 Customer Support Agent with Guardrails');
  console.log('==========================================');
  console.log('This agent has the following guardrails configured:');
  console.log('• Pre-flight: Moderation (hate, violence, self-harm)');
  console.log('• Input: Custom Prompt Check (math problems)');
  console.log('• Output: URL Filter (only example.com allowed)');
  console.log('==========================================\n');

  try {
    // Create agent with guardrails automatically configured from pipeline configuration
    // Set raiseGuardrailErrors to true for strict error handling
    const agent = await GuardrailAgent.create(
      PIPELINE_CONFIG,
      'Customer support agent',
      'You are a customer support agent. You help customers with their questions.',
      {},
      true // raiseGuardrailErrors = true
    );

    // Dynamic import to avoid bundling issues
    const { run } = await import('@openai/agents');

    const rl = createReadlineInterface();

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n👋 Exiting the program.');
      rl.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const userInput = await new Promise<string>((resolve) => {
          rl.question('Enter a message: ', resolve);
        });

        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
          shutdown();
          break;
        }

        console.log('🤔 Processing...\n');

        const result = await run(agent, userInput);
        console.log(`Assistant: ${result.finalOutput}\n`);
      } catch (error: any) {
        // Handle guardrail tripwire exceptions
        if (error instanceof InputGuardrailTripwireTriggered) {
          console.log('🛑 Input guardrail triggered! Please try a different message.\n');
          continue;
        } else if (error instanceof OutputGuardrailTripwireTriggered) {
          console.log('🛑 Output guardrail triggered! The response was blocked.\n');
          continue;
        } else {
          console.error('❌ An error occurred:', error.message);
          console.log('Please try again.\n');
        }
      }
    }
  } catch (error: any) {
    if (error.message.includes('@openai/agents')) {
      console.error('❌ Error: The @openai/agents package is required.');
      console.error('Please install it with: npm install @openai/agents');
    } else if (error.message.includes('OPENAI_API_KEY')) {
      console.error('❌ Error: OPENAI_API_KEY environment variable is required.');
      console.error('Please set it with: export OPENAI_API_KEY=sk-...');
    } else {
      console.error('❌ Unexpected error:', error.message);
    }
    process.exit(1);
  }
}

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
