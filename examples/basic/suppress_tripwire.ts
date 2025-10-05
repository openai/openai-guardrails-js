/**
 * Example: Guardrail bundle with suppressed tripwire exception using GuardrailsClient.
 */

import { GuardrailsOpenAI } from '../../src';
import * as readline from 'readline';

// Define your pipeline configuration
const PIPELINE_CONFIG: Record<string, any> = {
  version: 1,
  input: {
    version: 1,
    guardrails: [
      { name: 'Moderation', config: { categories: ['hate', 'violence'] } },
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
};

/**
 * Process user input, run guardrails (tripwire suppressed).
 */
async function processInput(
  guardrailsClient: GuardrailsOpenAI,
  userInput: string,
  responseId?: string
): Promise<string> {
  try {
    // Use GuardrailsClient with suppressTripwire=true
    const response = await guardrailsClient.guardrails.responses.create({
      input: userInput,
      model: 'gpt-4.1-nano-2025-04-14',
      previous_response_id: responseId,
      suppressTripwire: true,
    });

    // Check if any guardrails were triggered
    if (response.guardrail_results.allResults.length > 0) {
      for (const result of response.guardrail_results.allResults) {
        const guardrailName = result.info?.guardrail_name || 'Unknown Guardrail';
        if (result.tripwireTriggered) {
          console.log(`🟡 Guardrail '${guardrailName}' triggered!`);
          console.log('Guardrail Result:', result);
        } else {
          console.log(`🟢 Guardrail '${guardrailName}' passed.`);
        }
      }
    } else {
      console.log('🟢 No guardrails triggered.');
    }

    console.log(`\n🔵 Assistant output: ${response.output_text}\n`);
    return response.id;
  } catch (error) {
    console.log(`🔴 Error: ${error}`);
    return responseId || '';
  }
}

/**
 * Main async input loop for user interaction.
 */
async function main(): Promise<void> {
  console.log('🚀 Suppress Tripwire Example');
  console.log('Guardrails will run but exceptions will be suppressed.\n');

  // Initialize GuardrailsOpenAI with the pipeline configuration
  const guardrailsClient = await GuardrailsOpenAI.create(PIPELINE_CONFIG);

  let responseId: string | null = null;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const userInput = await new Promise<string>((resolve) => {
          // readline imported at top of file
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question('Enter a message: ', (answer: string) => {
            rl.close();
            resolve(answer);
          });
        });

        responseId = await processInput(guardrailsClient, userInput, responseId || undefined);
      } catch (error) {
        if (error instanceof Error && error.message.includes('SIGINT')) {
          break;
        }
        throw error;
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the main function
main().catch(console.error);
