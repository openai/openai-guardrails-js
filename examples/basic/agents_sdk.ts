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

import * as readline from 'node:readline';
import type { AgentInputItem } from '@openai/agents';
import { InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered } from '@openai/agents';
import { GuardrailAgent } from '../../src';

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
          model: 'gpt-4.1-mini-2025-04-14',
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

    // Maintain conversation history locally (TypeScript Agents SDK doesn't support Sessions yet)
    let thread: AgentInputItem[] = [];

    const rl = createReadlineInterface();

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n👋 Exiting the program.');
      rl.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

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

        // Pass conversation history with the new user message (without mutating thread yet)
        const conversationWithUser = thread.concat({ role: 'user', content: userInput });

        const result = await run(agent, conversationWithUser);

        // Guardrails passed - now safe to update thread with complete history
        thread = result.history;

        console.log(`Assistant: ${result.finalOutput}\n`);
      } catch (error) {
        // Handle guardrail tripwire exceptions
        const errorType = error?.constructor?.name;

        if (
          errorType === 'InputGuardrailTripwireTriggered' ||
          error instanceof InputGuardrailTripwireTriggered
        ) {
          console.log('🛑 Input guardrail triggered! Please try a different message.\n');
        } else if (
          errorType === 'OutputGuardrailTripwireTriggered' ||
          error instanceof OutputGuardrailTripwireTriggered
        ) {
          console.log('🛑 Output guardrail triggered! The response was blocked.\n');
        } else {
          console.error(
            '❌ An error occurred:',
            error instanceof Error ? error.message : String(error)
          );
          console.log('Please try again.\n');
        }
      }
    }
  } catch (error) {
    if ((error instanceof Error ? error.message : String(error)).includes('@openai/agents')) {
      console.error('❌ Error: The @openai/agents package is required.');
      console.error('Please install it with: npm install @openai/agents');
    } else if (
      (error instanceof Error ? error.message : String(error)).includes('OPENAI_API_KEY')
    ) {
      console.error('❌ Error: OPENAI_API_KEY environment variable is required.');
      console.error('Please set it with: export OPENAI_API_KEY=sk-...');
    } else {
      console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error));
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
