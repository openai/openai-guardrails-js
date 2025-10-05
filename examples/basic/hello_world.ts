#!/usr/bin/env node
/**
 * Hello World: Minimal async customer support agent with guardrails using TypeScript Guardrails.
 *
 * This example provides a simple chatbot interface with guardrails using the drop-in client interface.
 *
 * Run with: npx tsx hello_world.ts
 */

import * as readline from 'readline';
import { GuardrailsOpenAI, GuardrailTripwireTriggered } from '../../src';

// Pipeline configuration with preflight PII masking and input guardrails
const PIPELINE_CONFIG = {
  version: 1,
  pre_flight: {
    version: 1,
    guardrails: [
      {
        name: 'Contains PII',
        config: {
          entities: ['US_SSN', 'PHONE_NUMBER', 'EMAIL_ADDRESS'],
          block: true, // Use masking mode (default) - masks PII without blocking
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
          model: 'gpt-4.1-nano',
          confidence_threshold: 0.7,
          system_prompt_details: 'Check if the text contains any math problems.',
        },
      },
    ],
  },
  output: {
    version: 1,
    guardrails: [
      {
        name: 'URL Filter',
        config: {
          url_allow_list: [],
        },
      },
    ],
  },
};

/**
 * Process user input using the new GuardrailsOpenAI.
 *
 * @param guardrailsClient GuardrailsOpenAI client instance
 * @param userInput The user's input text
 * @param responseId Optional response ID for conversation tracking
 * @returns Promise resolving to a response ID
 */
async function processInput(
  guardrailsClient: GuardrailsOpenAI,
  userInput: string,
  responseId?: string
): Promise<string> {
  // Use the new GuardrailsOpenAI - it handles all guardrail validation automatically
  const response = await guardrailsClient.guardrails.responses.create({
    input: userInput,
    model: 'gpt-4.1-nano',
    previous_response_id: responseId,
  });

  console.log(`\nAssistant output: ${response.output_text}`);

  // Show guardrail results if any were run
  if (response.guardrail_results.allResults.length > 0) {
    console.log(`[dim]Guardrails checked: ${response.guardrail_results.allResults.length}[/dim]`);
  }

  return response.id;
}

/**
 * Create a readline interface for user input.
 */
function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'Enter a message: ',
  });
}

/**
 * Main async function that runs the chatbot loop.
 */
async function main(): Promise<void> {
  console.log('🤖 Hello World Chatbot with Guardrails\n');
  console.log('This chatbot uses the new GuardrailsOpenAI client interface:');
  console.log('• Automatically applies guardrails to all OpenAI API calls');
  console.log('• Drop-in replacement for OpenAI client');
  console.log('• Input guardrails validate user messages');
  console.log('\nType your messages below. Press Ctrl+C to exit.\n');

  // Initialize GuardrailsOpenAI with our pipeline configuration
  const guardrailsClient = await GuardrailsOpenAI.create(PIPELINE_CONFIG);

  const rl = createReadlineInterface();
  let responseId: string | undefined;

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\n\nExiting the program.');
    rl.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const userInput = await new Promise<string>((resolve) => {
        rl.question('Enter a message: ', resolve);
      });

      if (!userInput.trim()) {
        continue;
      }

      try {
        responseId = await processInput(guardrailsClient, userInput, responseId);
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          const stageName = error.guardrailResult.info?.stage_name || 'unknown';
          console.log(`\n🛑 Guardrail triggered in stage '${stageName}'!`);
          console.log('\n📋 Guardrail Result:');
          console.log(JSON.stringify(error.guardrailResult, null, 2));
          console.log('\nPlease rephrase your message to avoid triggering security checks.\n');
        } else {
          console.error(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('readline')) {
      // Handle readline errors gracefully
      shutdown();
    } else {
      console.error('Unexpected error:', error);
      shutdown();
    }
  }
}

// Run the main function if this file is executed directly
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
