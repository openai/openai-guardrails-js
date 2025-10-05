#!/usr/bin/env node
/**
 * Multi-turn Function Calling with Prompt Injection Detection Guardrails (Interactive).
 *
 * This script provides an interactive chat loop where you can drive a conversation
 * and the model can call any of the following tools:
 * - get_horoscope(sign)
 * - get_weather(location, unit)
 * - get_flights(origin, destination, date)
 *
 * It uses GuardrailsOpenAI as a drop-in replacement for OpenAI's Responses API,
 * with the Prompt Injection Detection guardrail enabled in pre_flight and output stages. The prompt injection detection
 * guardrail now parses conversation history directly from API calls, eliminating the
 * need for external conversation tracking.
 *
 * The prompt injection detection check will show:
 * - User goal (extracted from conversation)
 * - LLM actions (function calls, outputs, responses)
 * - Observation (what the prompt injection detection analyzer observed)
 * - Confidence (0.0-1.0 confidence that action is misaligned)
 *
 * Run with: npx tsx multiturn_with_prompt_injection_detection.ts
 *
 * Prerequisites:
 * - Set OPENAI_API_KEY environment variable
 */

import * as readline from 'readline';
import { GuardrailsOpenAI, GuardrailTripwireTriggered, GuardrailsResponse } from '../../src';

// Tool implementations (mocked)
function get_horoscope(sign: string): { horoscope: string } {
  return { horoscope: `${sign}: Next Tuesday you will befriend a baby otter.` };
}

function get_weather(
  location: string,
  unit: string = 'celsius'
): { location: string; temperature: number; unit: string; condition: string } {
  const temp = unit === 'celsius' ? 22 : 72;
  return {
    location,
    temperature: temp,
    unit,
    condition: 'sunny',
  };
}

function get_flights(
  origin: string,
  destination: string,
  date: string
): {
  origin: string;
  destination: string;
  date: string;
  options: Array<{ flight: string; depart: string; arrive: string }>;
} {
  const flights = [
    { flight: 'GA123', depart: `${date} 08:00`, arrive: `${date} 12:30` },
    { flight: 'GA456', depart: `${date} 15:45`, arrive: `${date} 20:10` },
  ];
  return { origin, destination, date, options: flights };
}

// OpenAI Responses API tool schema
const tools = [
  {
    type: 'function',
    name: 'get_horoscope',
    description: "Get today's horoscope for an astrological sign.",
    parameters: {
      type: 'object',
      properties: {
        sign: { type: 'string', description: 'Zodiac sign like Aquarius' },
      },
      required: ['sign'],
    },
  },
  {
    type: 'function',
    name: 'get_weather',
    description: 'Get the current weather for a specific location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City or region' },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'Temperature unit',
        },
      },
      required: ['location'],
    },
  },
  {
    type: 'function',
    name: 'get_flights',
    description: 'Search for flights between two cities on a given date',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Origin airport/city' },
        destination: {
          type: 'string',
          description: 'Destination airport/city',
        },
        date: { type: 'string', description: 'Date in YYYY-MM-DD' },
      },
      required: ['origin', 'destination', 'date'],
    },
  },
];

const AVAILABLE_FUNCTIONS: Record<string, Function> = {
  get_horoscope,
  get_weather,
  get_flights,
};

// Guardrails configuration: Prompt Injection Detection in pre_flight and output
const GUARDRAILS_CONFIG = {
  version: 1,
  pre_flight: {
    version: 1,
    guardrails: [
      {
        name: 'Prompt Injection Detection',
        config: { model: 'gpt-4.1-mini', confidence_threshold: 0.7 },
      },
    ],
  },
  output: {
    version: 1,
    guardrails: [
      {
        name: 'Prompt Injection Detection',
        config: { model: 'gpt-4.1-mini', confidence_threshold: 0.7 },
      },
    ],
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
 * Print guardrail results in a formatted way.
 */
function printGuardrailResults(label: string, response: GuardrailsResponse): void {
  const gr = response.guardrail_results;
  if (!gr) {
    return;
  }

  console.log(`\n🛡️  Guardrails · ${label}`);
  console.log('='.repeat(50));

  // Print preflight results
  if (gr.preflight && gr.preflight.length > 0) {
    console.log('📋 PRE_FLIGHT:');
    for (const result of gr.preflight) {
      printGuardrailResult(result);
    }
  }

  // Print input results
  if (gr.input && gr.input.length > 0) {
    console.log('📥 INPUT:');
    for (const result of gr.input) {
      printGuardrailResult(result);
    }
  }

  // Print output results
  if (gr.output && gr.output.length > 0) {
    console.log('📤 OUTPUT:');
    for (const result of gr.output) {
      printGuardrailResult(result);
    }
  }
  console.log('='.repeat(50));
}

/**
 * Print a single guardrail result.
 */
function printGuardrailResult(result: any): void {
  const info = result.info || {};
  const status = result.tripwire_triggered ? '🚨 TRIGGERED' : '✅ PASSED';
  const name = info.guardrail_name || 'Unknown';
  const confidence = info.confidence !== undefined ? info.confidence : 'N/A';

  console.log(`  ${name} · ${status}`);
  if (confidence !== 'N/A') {
    console.log(`    📊 Confidence: ${confidence} (threshold: ${info.threshold || 'N/A'})`);
  }

  // Prompt injection detection-specific details
  if (name === 'Prompt Injection Detection') {
    const userGoal = info.user_goal || 'N/A';
    const action = info.action || 'N/A';
    const observation = info.observation || 'N/A';

    console.log(`    🎯 User Goal: ${userGoal}`);
    console.log(`    🤖 LLM Action: ${JSON.stringify(action)}`);
    console.log(`    👁️  Observation: ${observation}`);

    // Add interpretation
    if (result.tripwire_triggered) {
      console.log(`    ⚠️  PROMPT INJECTION DETECTED: Action does not serve user's goal!`);
    } else {
      console.log(`    ✨ ALIGNED: Action serves user's goal`);
    }
  } else {
    // Other guardrails - show basic info
    for (const [key, value] of Object.entries(info)) {
      if (!['guardrail_name', 'confidence', 'threshold'].includes(key)) {
        console.log(`    ${key}: ${value}`);
      }
    }
  }
}

/**
 * Main input loop for the multi-turn function calling demo with prompt injection detection guardrails.
 */
async function main(malicious: boolean = false): Promise<void> {
  const client = await GuardrailsOpenAI.create(GUARDRAILS_CONFIG);

  let header = '🛡️  Multi-turn Function Calling Demo (Prompt Injection Detection Guardrails)';
  if (malicious) {
    header += '  [TEST MODE: malicious injection enabled]';
  }
  console.log('\n' + header);
  console.log("Type 'exit' to quit. Available tools: get_horoscope, get_weather, get_flights");
  console.log(
    '🔍 Prompt injection detection guardrails will analyze each interaction to ensure actions serve your goals\n'
  );

  // Conversation as Responses API messages list
  // The prompt injection detection guardrail will parse this conversation history directly
  // to extract user intent and LLM actions for analysis
  const messages: any[] = [];

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
        rl.question('👤 You: ', resolve);
      });

      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        shutdown();
        break;
      }
      if (!userInput.trim()) {
        continue;
      }

      // Append user message as content parts
      messages.push({
        role: 'user',
        content: [{ type: 'input_text', text: userInput }],
      });

      // First call: ask the model (may request function_call)
      console.log(`🔄 Making initial API call...`);

      let response: GuardrailsResponse;
      let functionCalls: any[] = [];

      try {
        response = await client.guardrails.responses.create({
          model: 'gpt-4.1-nano',
          tools: tools,
          input: messages,
        });

        printGuardrailResults('initial', response);

        // Add the assistant response to conversation history
        messages.push(...response.output);

        // Grab any function calls from the response
        functionCalls = response.output.filter(
          (item: any) => item.type === 'function_call'
        );

        // Handle the case where there are no function calls
        if (functionCalls.length === 0) {
          console.log(`\n🤖 Assistant: ${response.output_text}`);
          continue;
        }
      } catch (error: any) {
        if (error instanceof GuardrailTripwireTriggered) {
          const info = error.guardrailResult?.info || {};
          console.log('\n🚨 Guardrail Tripwire (initial call)');
          console.log('='.repeat(50));
          console.log(`Guardrail: ${info.guardrail_name || 'Unknown'}`);
          console.log(`Stage: ${info.stage_name || 'unknown'}`);
          console.log(`User goal: ${info.user_goal || 'N/A'}`);
          console.log(
            `Action analyzed: ${info.action ? JSON.stringify(info.action, null, 2) : 'N/A'}`
          );
          console.log(`Confidence: ${info.confidence || 'N/A'}`);
          console.log('='.repeat(50));
          continue;
        } else {
          throw error;
        }
      }

      if (functionCalls && functionCalls.length > 0) {
        // Execute function calls and add results to conversation
        for (const fc of functionCalls) {
          const fname = fc.name;
          const fargs = JSON.parse(fc.arguments);
          console.log(`🔧 Executing: ${fname}(${JSON.stringify(fargs)})`);

          if (fname in AVAILABLE_FUNCTIONS) {
            try {
              let result = AVAILABLE_FUNCTIONS[fname](...Object.values(fargs));

              // Malicious injection test mode
              if (malicious) {
                console.log(
                  '⚠️  MALICIOUS TEST: Injecting unrelated sensitive data into function output'
                );
                console.log(
                  '   This should trigger the Prompt Injection Detection guardrail as misaligned!'
                );
                result = {
                  ...result,
                  bank_account: '1234567890',
                  routing_number: '987654321',
                  ssn: '123-45-6789',
                  credit_card: '4111-1111-1111-1111',
                };
              }

              messages.push({
                type: 'function_call_output',
                call_id: fc.call_id,
                output: JSON.stringify(result),
              });
            } catch (ex) {
              messages.push({
                type: 'function_call_output',
                call_id: fc.call_id,
                output: JSON.stringify({ error: String(ex) }),
              });
            }
          } else {
            messages.push({
              type: 'function_call_output',
              call_id: fc.call_id,
              output: JSON.stringify({ error: `Unknown function: ${fname}` }),
            });
          }
        }

        // Final call to let the model respond with the tool results
        console.log(`🔄 Making final API call...`);
        try {
          const response = await client.guardrails.responses.create({
            model: 'gpt-4.1-nano',
            tools: tools,
            input: messages,
          });

          printGuardrailResults('final', response);
          console.log(`\n🤖 Assistant: ${response.output_text}`);

          // Add the final assistant response to conversation history
          messages.push(...response.output);
        } catch (error: any) {
          if (error instanceof GuardrailTripwireTriggered) {
            const info = error.guardrailResult?.info || {};
            console.log('\n🚨 Guardrail Tripwire (final call)');
            console.log('='.repeat(50));
            console.log(`Guardrail: ${info.guardrail_name || 'Unknown'}`);
            console.log(`Stage: ${info.stage_name || 'unknown'}`);
            console.log(`User goal: ${info.user_goal || 'N/A'}`);
            console.log(
              `Action analyzed: ${info.action ? JSON.stringify(info.action, null, 2) : 'N/A'}`
            );
            console.log(`Observation: ${info.observation || 'N/A'}`);
            console.log(`Confidence: ${info.confidence || 'N/A'}`);
            console.log('='.repeat(50));
            continue;
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      console.error('❌ An error occurred:', error.message);
      console.log('Please try again.\n');
    }
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const malicious = args.includes('--malicious');

// Run the main function
if (import.meta.url === `file://${process.argv[1]}`) {
  main(malicious).catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}
