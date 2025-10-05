/**
 * Example: Async customer support agent with multiple guardrail bundles using GuardrailsClient.
 * Streams output using console logging.
 */

import { GuardrailsOpenAI, GuardrailTripwireTriggered } from '../../src';
import * as readline from 'readline';

// Define your pipeline configuration
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
          block: false, // Use masking mode (default) - masks PII without blocking
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
      {
        name: 'Contains PII',
        config: {
          entities: ['US_SSN', 'PHONE_NUMBER', 'EMAIL_ADDRESS'],
          block: true, // Use blocking mode on output
        },
      },
    ],
  },
};

/**
 * Process user input with streaming output and guardrails using GuardrailsClient.
 */
async function processInput(
  guardrailsClient: GuardrailsOpenAI,
  userInput: string,
  responseId?: string
): Promise<string | null> {
  try {
    // Use the new GuardrailsClient - it handles all guardrail validation automatically
    // including pre-flight, input, and output stages, plus the LLM call
    const stream = await guardrailsClient.guardrails.responses.create({
      input: userInput,
      model: 'gpt-4.1-nano',
      previous_response_id: responseId,
      stream: true,
    });

    // Stream the assistant's output
    let outputText = 'Assistant output: ';
    console.log(outputText);

    let responseIdToReturn: string | null = null;

    for await (const chunk of stream) {
      // Access streaming response exactly like native OpenAI API
      if ('delta' in chunk && chunk.delta && typeof chunk.delta === 'string') {
        outputText += chunk.delta;
        process.stdout.write(chunk.delta);
      }

      // Get the response ID from the final chunk
      if (
        typeof chunk === 'object' &&
        'response' in chunk &&
        chunk.response &&
        typeof chunk.response === 'object' &&
        'id' in chunk.response
      ) {
        responseIdToReturn = (chunk.response).id as string;
      }
    }

    console.log(); // New line after streaming
    return responseIdToReturn;
  } catch (error) {
    if (error instanceof GuardrailTripwireTriggered) {
      console.clear();
      throw error;
    }
    throw error;
  }
}

/**
 * Simple REPL loop: read from stdin, process, and stream results.
 */
async function main(): Promise<void> {
  // Initialize GuardrailsOpenAI with the pipeline configuration
  const guardrailsClient = await GuardrailsOpenAI.create(PIPELINE_CONFIG);

  let responseId: string | null = null;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const prompt = await new Promise<string>((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl.question('Enter a message: ', (answer: string) => {
            rl.close();
            resolve(answer.trim());
          });
        });

        responseId = await processInput(guardrailsClient, prompt, responseId || undefined);
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          const stageName = error.guardrailResult.info?.stage_name || 'unknown';
          const guardrailName = error.guardrailResult.info?.guardrail_name || 'unknown';

          console.log(`🛑 Guardrail '${guardrailName}' triggered in stage '${stageName}'!`);
          console.log('Guardrail Result:', error.guardrailResult);
          // On guardrail trip, just continue to next prompt
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('SIGINT')) {
      console.log('👋 Goodbye!');
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

// Run the main function
main().catch(console.error);
