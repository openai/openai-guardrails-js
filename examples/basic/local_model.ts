/**
 * Example: Guardrail bundle using Ollama's Gemma3 model with GuardrailsClient.
 */

import { GuardrailsOpenAI, GuardrailTripwireTriggered } from '../../src';
import * as readline from 'readline';
import { OpenAI } from 'openai';

// Define your pipeline configuration for Gemma3
const GEMMA3_PIPELINE_CONFIG = {
  version: 1,
  input: {
    version: 1,
    guardrails: [
      { name: 'Moderation', config: { categories: ['hate', 'violence'] } },
      {
        name: 'URL Filter',
        config: { url_allow_list: ['example.com', 'baz.com'] },
      },
      {
        name: 'Jailbreak',
        config: {
          model: 'gemma3',
          confidence_threshold: 0.7,
        },
      },
    ],
  },
};

/**
 * Process user input through Gemma3 guardrails using GuardrailsClient.
 */
async function processInput(
  guardrailsClient: GuardrailsOpenAI,
  userInput: string,
  inputData: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<void> {
  try {
    // Use GuardrailsClient for chat completions with guardrails
    const response = await guardrailsClient.guardrails.chat.completions.create({
      messages: [...inputData, { role: 'user', content: userInput }],
      model: 'gemma3',
    });

    // Access response content using standard OpenAI API
    const responseContent = response.choices[0].message.content;
    console.log(`\nAssistant output: ${responseContent}\n`);

    // Add to conversation history
    inputData.push({ role: 'user', content: userInput });
    inputData.push({ role: 'assistant', content: responseContent || '' });
  } catch (error) {
    if (error instanceof GuardrailTripwireTriggered) {
      // Handle guardrail violations
      throw error;
    }
    throw error;
  }
}

/**
 * Main async input loop for user interaction.
 */
async function main(): Promise<void> {
  // Initialize GuardrailsOpenAI with Ollama configuration
  const guardrailsClient = await GuardrailsOpenAI.create(GEMMA3_PIPELINE_CONFIG, {
    baseURL: 'http://127.0.0.1:11434/v1/',
    apiKey: 'ollama',
  });

  const inputData: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

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

        await processInput(guardrailsClient, userInput, inputData);
      } catch (error) {
        if (error instanceof GuardrailTripwireTriggered) {
          const stageName = error.guardrailResult.info?.stage_name || 'unknown';
          const guardrailName = error.guardrailResult.info?.guardrail_name || 'unknown';

          console.log(`\n🛑 Guardrail '${guardrailName}' triggered in stage '${stageName}'!`);
          console.log('Guardrail Result:', error.guardrailResult);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('SIGINT')) {
      console.log('\nExiting the program.');
    } else {
      console.error('Unexpected error:', error);
    }
  }
}

// Run the main function
main().catch(console.error);
