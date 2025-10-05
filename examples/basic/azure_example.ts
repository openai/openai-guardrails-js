#!/usr/bin/env node
/**
 * Azure Hello World: Minimal Azure customer support agent with guardrails using TypeScript Guardrails.
 *
 * This example provides a simple chatbot interface with guardrails using the Azure-specific guardrails client.
 *
 * Run with: npx tsx azure_example.ts
 */

import * as readline from 'readline';
import { GuardrailsAzureOpenAI, GuardrailTripwireTriggered } from '../../src';


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
          block: true, // Use blocking mode - blocks PII instead of masking
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
          model: process.env.AZURE_DEPLOYMENT!,
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
          url_allow_list: ['microsoft.com', 'azure.com'],
        },
      },
    ],
  },
};

/**
 * Process user input using the new GuardrailsAzureOpenAI.
 *
 * @param guardrailsClient GuardrailsAzureOpenAI client instance
 * @param userInput The user's input text
 * @param responseId Optional response ID for conversation tracking
 * @returns Promise resolving to a response ID
 */
async function processInput(
  guardrailsClient: GuardrailsAzureOpenAI,
  userInput: string
): Promise<string> {
  // Use the new GuardrailsAzureOpenAI - it handles all guardrail validation automatically
  const response = await guardrailsClient.guardrails.chat.completions.create({
    model: process.env.AZURE_DEPLOYMENT!,
    messages: [{ role: 'user', content: userInput }],
  });

  console.log(`\nAssistant output: ${response.choices[0].message.content}`);

  // Show guardrail results if any were run
  if (response.guardrail_results.allResults.length > 0) {
    console.log(
      `[dim]Guardrails checked: ${response.guardrail_results.allResults.length}[/dim]`
    );
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
  console.log('🤖 Azure Hello World Chatbot with Guardrails\n');
  console.log('This chatbot uses the new GuardrailsAzureOpenAI client interface:');
  console.log('• Automatically applies guardrails to all Azure OpenAI API calls');
  console.log('• Drop-in replacement for Azure OpenAI client');
  console.log('• Input guardrails validate user messages');
  console.log('\nType your messages below. Press Ctrl+C to exit.\n');

  // Check if required environment variables are set
  const requiredVars = ['AZURE_ENDPOINT', 'AZURE_API_KEY', 'AZURE_API_VERSION', 'AZURE_DEPLOYMENT'];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.log('❌ Missing required environment variables:');
    missingVars.forEach((varName) => console.log(`   • ${varName}`));
    console.log('\nPlease set these in your .env file and try again.');
    return;
  }

  console.log('✅ All required environment variables are set\n');

  // Initialize GuardrailsAzureOpenAI with our pipeline configuration
  const guardrailsClient = await GuardrailsAzureOpenAI.create(PIPELINE_CONFIG, {
    endpoint: process.env.AZURE_ENDPOINT!,
    apiKey: process.env.AZURE_API_KEY!,
    apiVersion: process.env.AZURE_API_VERSION!,
  });

  const rl = createReadlineInterface();
  // let responseId: string | undefined;

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
        await processInput(guardrailsClient, userInput);
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
