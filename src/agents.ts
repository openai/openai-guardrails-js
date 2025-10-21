/**
 * GuardrailAgent: Drop-in replacement for Agents SDK Agent with automatic guardrails.
 *
 * This module provides the GuardrailAgent class that acts as a factory for creating
 * Agents SDK Agent instances with guardrails automatically configured from a pipeline
 * configuration file.
 */

import { GuardrailLLMContext, GuardrailResult, TextOnlyContent, ContentPart } from './types';
import { ContentUtils } from './utils/content';
import { loadPipelineBundles, instantiateGuardrails, PipelineConfig, GuardrailBundle, ConfiguredGuardrail } from './runtime';

// Import Agents SDK types for better type safety
import type { 
  InputGuardrail, 
  OutputGuardrail, 
  InputGuardrailFunctionArgs, 
  OutputGuardrailFunctionArgs
} from '@openai/agents-core';

// Type for agent output that might have different structures
interface AgentOutput {
  response?: string;
  finalOutput?: string | TextOnlyContent;
  [key: string]: string | TextOnlyContent | undefined;
}

/**
 * Drop-in replacement for Agents SDK Agent with automatic guardrails integration.
 *
 * This class acts as a factory that creates a regular Agents SDK Agent instance
 * with guardrails automatically configured from a pipeline configuration.
 *
 * Instead of manually creating guardrails and wiring them to an Agent, users can
 * simply provide a guardrails configuration file and get back a fully configured
 * Agent that works exactly like a regular Agents SDK Agent.
 *
 * @example
 * ```typescript
 * // Use GuardrailAgent directly:
 * const agent = await GuardrailAgent.create(
 *   "config.json",
 *   "Customer support agent",
 *   "You are a customer support agent..."
 * );
 * // Returns a regular Agent instance that can be used with run()
 * ```
 */
export class GuardrailAgent {
  /**
   * Create a new Agent instance with guardrails automatically configured.
   *
   * This method acts as a factory that:
   * 1. Loads the pipeline configuration
   * 2. Generates appropriate guardrail functions for Agents SDK
   * 3. Creates and returns a regular Agent instance with guardrails wired
   *
   * @param config Pipeline configuration (file path, dict, or JSON string)
   * @param name Agent name
   * @param instructions Agent instructions
   * @param agentKwargs All other arguments passed to Agent constructor
   * @param raiseGuardrailErrors If true, raise exceptions when guardrails fail to execute.
   *   If false (default), treat guardrail errors as safe and continue execution.
   * @returns A fully configured Agent instance ready for use with run()
   *
   * @throws {Error} If agents package is not available
   * @throws {Error} If configuration is invalid
   * @throws {Error} If raiseGuardrailErrors=true and a guardrail fails to execute
   */
  static async create(
    config: string | PipelineConfig,
    name: string,
    instructions: string,
    agentKwargs: Record<string, unknown> = {},
    raiseGuardrailErrors: boolean = false
  ): Promise<unknown> {
    // Returns agents.Agent
    try {
      // Dynamic import to avoid bundling issues
      const agentsModule = await import('@openai/agents');
      const { Agent } = agentsModule;

      // Load the pipeline configuration
      const pipeline = await loadPipelineBundles(config);

      // Create input guardrails from pre_flight and input stages
      const inputGuardrails: InputGuardrail[] = [];
      if ((pipeline as Record<string, unknown>).pre_flight) {
        const preFlightGuardrails = await createInputGuardrailsFromStage(
          'pre_flight',
          (pipeline as Record<string, unknown>).pre_flight as GuardrailBundle,
          undefined,
          raiseGuardrailErrors
        );
        inputGuardrails.push(...preFlightGuardrails);
      }
      if ((pipeline as Record<string, unknown>).input) {
        const inputStageGuardrails = await createInputGuardrailsFromStage(
          'input',
          (pipeline as Record<string, unknown>).input as GuardrailBundle,
          undefined,
          raiseGuardrailErrors
        );
        inputGuardrails.push(...inputStageGuardrails);
      }

      // Create output guardrails from output stage
      const outputGuardrails: OutputGuardrail[] = [];
      if ((pipeline as Record<string, unknown>).output) {
        const outputStageGuardrails = await createOutputGuardrailsFromStage(
          'output',
          (pipeline as Record<string, unknown>).output as GuardrailBundle,
          undefined,
          raiseGuardrailErrors
        );
        outputGuardrails.push(...outputStageGuardrails);
      }

      return new Agent({
        name,
        instructions,
        inputGuardrails,
        outputGuardrails,
        ...agentKwargs,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Cannot resolve module')) {
        throw new Error(
          'The @openai/agents package is required to use GuardrailAgent. ' +
            'Please install it with: npm install @openai/agents'
        );
      }
      throw error;
    }
  }
}

async function createInputGuardrailsFromStage(
  stageName: string,
  stageConfig: GuardrailBundle,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<InputGuardrail[]> {
  // Instantiate guardrails for this stage
  const guardrails: ConfiguredGuardrail[] = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: ConfiguredGuardrail) => {
    return {
      name: `${stageName}: ${guardrail.definition.name || 'Unknown Guardrail'}`,
      execute: async (args: InputGuardrailFunctionArgs) => {
        const { input, context: agentContext } = args;
        // Extract text from input - handle both string and message object formats
        let inputText = '';
        if (typeof input === 'string') {
          inputText = input;
        } else if (input && typeof input === 'object' && 'content' in input) {
          // Use ContentUtils to extract text from message content
          inputText = ContentUtils.extractTextFromMessage({
            role: 'user',
            content: input.content as string | ContentPart[]
          });
        }
        
        try {

          // Create a proper context with OpenAI client if needed
          let guardContext: GuardrailLLMContext = (context as unknown as GuardrailLLMContext) || (agentContext as unknown as GuardrailLLMContext) || {} as GuardrailLLMContext;
          if (!guardContext.guardrailLlm) {
            const { OpenAI } = require('openai');
            guardContext = {
              ...guardContext,
              guardrailLlm: new OpenAI(),
            };
          }

          const result: GuardrailResult = await guardrail.run(guardContext, inputText);

          // Check for execution failures when raiseGuardrailErrors=true
          if (raiseGuardrailErrors && result.executionFailed) {
            throw result.originalException;
          }

          return {
            outputInfo: {
              ...(result.info || {}),
              input: inputText,
            },
            tripwireTriggered: result.tripwireTriggered || false,
          };
        } catch (error) {
          if (raiseGuardrailErrors) {
            // Re-raise the exception to stop execution
            throw error;
          } else {
            // When raiseGuardrailErrors=false, treat errors as safe and continue execution
            // Return tripwireTriggered=false to allow execution to continue
            return {
              outputInfo: {
                error: error instanceof Error ? error.message : String(error),
                guardrail_name: guardrail.definition.name || 'unknown',
                input: inputText,
              },
              tripwireTriggered: false,
            };
          }
        }
      }
    };
  });
}

async function createOutputGuardrailsFromStage(
  stageName: string,
  stageConfig: GuardrailBundle,
  context?: GuardrailLLMContext,
  raiseGuardrailErrors: boolean = false
): Promise<OutputGuardrail[]> {
  // Instantiate guardrails for this stage
  const guardrails: ConfiguredGuardrail[] = await instantiateGuardrails(stageConfig);

  return guardrails.map((guardrail: ConfiguredGuardrail) => {
    return {
      name: `${stageName}: ${guardrail.definition.name || 'Unknown Guardrail'}`,
      execute: async (args: OutputGuardrailFunctionArgs) => {
        const { agentOutput, context: agentContext } = args;
        // Extract the output text - could be in different formats
        let outputText = '';
        if (typeof agentOutput === 'string') {
          outputText = agentOutput;
        } else if (agentOutput && typeof agentOutput === 'object' && 'response' in agentOutput) {
          outputText = (agentOutput as AgentOutput).response || '';
        } else if (agentOutput && typeof agentOutput === 'object' && 'finalOutput' in agentOutput) {
          const finalOutput = (agentOutput as AgentOutput).finalOutput;
          outputText =
            typeof finalOutput === 'string'
              ? finalOutput
              : JSON.stringify(finalOutput);
        } else {
          // Try to extract any string content
          outputText = JSON.stringify(agentOutput);
        }
        
        try {

          // Create a proper context with OpenAI client if needed
          let guardContext: GuardrailLLMContext = (context as unknown as GuardrailLLMContext) || (agentContext as unknown as GuardrailLLMContext) || {} as GuardrailLLMContext;
          if (!guardContext.guardrailLlm) {
            const { OpenAI } = require('openai');
            guardContext = {
              ...guardContext,
              guardrailLlm: new OpenAI(),
            };
          }

          const result: GuardrailResult = await guardrail.run(guardContext, outputText);

          // Check for execution failures when raiseGuardrailErrors=true
          if (raiseGuardrailErrors && result.executionFailed) {
            throw result.originalException;
          }

          return {
            outputInfo: {
              ...(result.info || {}),
              input: outputText,
            },
            tripwireTriggered: result.tripwireTriggered || false,
          };
        } catch (error) {
          if (raiseGuardrailErrors) {
            // Re-raise the exception to stop execution
            throw error;
          } else {
            // When raiseGuardrailErrors=false, treat errors as safe and continue execution
            // Return tripwireTriggered=false to allow execution to continue
            return {
              outputInfo: {
                error: error instanceof Error ? error.message : String(error),
                guardrail_name: guardrail.definition.name || 'unknown',
                input: outputText,
              },
              tripwireTriggered: false,
            };
          }
        }
      }
    };
  });
}
