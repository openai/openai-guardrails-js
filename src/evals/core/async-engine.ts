/**
 * Async run engine for guardrail evaluation.
 *
 * This module provides an asynchronous engine for running guardrail checks on evaluation samples.
 * It supports batch processing, error handling, and progress reporting for large-scale evaluation workflows.
 */

import { Context, RunEngine, Sample, SampleResult } from './types';
import { ConfiguredGuardrail } from '../../runtime';
import { GuardrailLLMContextWithHistory, GuardrailResult, GuardrailLLMContext } from '../../types';
import { parseConversationInput, normalizeConversation, NormalizedConversationEntry } from '../../utils/conversation';

/**
 * Runs guardrail evaluations asynchronously.
 */
export class AsyncRunEngine implements RunEngine {
  private readonly guardrailNames: string[];
  private readonly guardrails: ConfiguredGuardrail[];
  private readonly multiTurn: boolean;

  constructor(guardrails: ConfiguredGuardrail[], multiTurn: boolean = false) {
    this.guardrailNames = guardrails.map((g) => g.definition.name);
    this.guardrails = guardrails;
    this.multiTurn = multiTurn;
  }

  /**
   * Run evaluations on samples in batches.
   *
   * @param context - Evaluation context
   * @param samples - List of samples to evaluate
   * @param batchSize - Number of samples to process in parallel
   * @param desc - Description for the progress reporting
   * @returns List of evaluation results
   *
   * @throws {Error} If batchSize is less than 1
   */
  async run(
    context: Context,
    samples: Sample[],
    batchSize: number,
    desc: string = 'Evaluating samples'
  ): Promise<SampleResult[]> {
    if (batchSize < 1) {
      throw new Error('batchSize must be at least 1');
    }

    const results: SampleResult[] = [];
    const totalSamples = samples.length;

    console.log(`${desc}: ${totalSamples} samples, batch size: ${batchSize}`);

    for (let i = 0; i < samples.length; i += batchSize) {
      const batch = samples.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((sample) => this.evaluateSample(context, sample))
      );
      results.push(...batchResults);
      console.log(`Processed ${results.length}/${totalSamples} samples`);
    }

    return results;
  }

  /**
   * Evaluate a single sample against all guardrails.
   *
   * @param context - Evaluation context
   * @param sample - Sample to evaluate
   * @returns Evaluation result for the sample
   */
  private async evaluateSample(context: Context, sample: Sample): Promise<SampleResult> {
    const triggered: Record<string, boolean> = {};
    const details: Record<string, GuardrailResult['info']> = {};

    for (const name of this.guardrailNames) {
      triggered[name] = false;
    }

    try {
      for (let i = 0; i < this.guardrails.length; i += 1) {
        const guardrail = this.guardrails[i];
        const name = this.guardrailNames[i] || guardrail.definition.name || 'unknown';

        try {
          const result = await this.runGuardrailWithIncrementalSupport(
            context,
            guardrail,
            sample.data
          );

          triggered[name] = result.tripwireTriggered;
          if (result.info) {
            details[name] = result.info;
          }
        } catch (guardrailError) {
          console.error(`Error running guardrail ${name} on sample ${sample.id}:`, guardrailError);
          triggered[name] = false;
          details[name] = {
            input_text: sample.data,
            error: guardrailError instanceof Error ? guardrailError.message : String(guardrailError),
          };
        }
      }
    } catch (error) {
      console.error(`Error evaluating sample ${sample.id}:`, error);
      return {
        id: sample.id,
        expectedTriggers: sample.expectedTriggers,
        triggered,
        details: {
          ...details,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }

    return {
      id: sample.id,
      expectedTriggers: sample.expectedTriggers,
      triggered,
      details,
    };
  }

  private async runGuardrailWithIncrementalSupport(
    context: Context,
    guardrail: ConfiguredGuardrail,
    sampleData: string
  ): Promise<GuardrailResult> {
    const usesConversationHistory = this.guardrailUsesConversationHistory(guardrail);
    const shouldRunIncremental =
      this.isPromptInjectionGuardrail(guardrail) || (usesConversationHistory && this.multiTurn);

    if (shouldRunIncremental) {
      return await this.runIncrementalConversationGuardrail(context, guardrail, sampleData);
    }

    if (usesConversationHistory) {
      return await this.runConversationGuardrailSinglePass(context, guardrail, sampleData);
    }

    return await guardrail.run(context as GuardrailLLMContext, sampleData);
  }

  private isPromptInjectionGuardrail(guardrail: ConfiguredGuardrail): boolean {
    const normalized = (guardrail.definition.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return normalized === 'prompt injection detection';
  }

  private guardrailUsesConversationHistory(guardrail: ConfiguredGuardrail): boolean {
    return Boolean(guardrail.definition.metadata?.usesConversationHistory);
  }

  private async runConversationGuardrailSinglePass(
    context: Context,
    guardrail: ConfiguredGuardrail,
    sampleData: string
  ): Promise<GuardrailResult> {
    const conversation = normalizeConversation(parseConversationInput(sampleData));
    const guardrailContext = this.createConversationContext(context, conversation);
    return await guardrail.run(
      guardrailContext as GuardrailLLMContextWithHistory,
      sampleData
    );
  }

  private async runIncrementalConversationGuardrail(
    context: Context,
    guardrail: ConfiguredGuardrail,
    sampleData: string
  ): Promise<GuardrailResult> {
    const conversation = normalizeConversation(parseConversationInput(sampleData));

    if (conversation.length === 0) {
      const guardrailContext = this.createConversationContext(context, []);
      return await guardrail.run(
        guardrailContext as GuardrailLLMContextWithHistory,
        sampleData
      );
    }

    let finalResult: GuardrailResult | null = null;

    for (let turnIndex = 0; turnIndex < conversation.length; turnIndex += 1) {
      const historySlice = conversation.slice(0, turnIndex + 1);
      const guardrailContext = this.createConversationContext(context, historySlice);
      const serializedHistory = safeStringify(historySlice, sampleData);
      const latestMessage = historySlice[historySlice.length - 1];

      const payload = this.isPromptInjectionGuardrail(guardrail)
        ? serializedHistory
        : this.extractLatestInput(latestMessage, serializedHistory);

      const result = await guardrail.run(guardrailContext as GuardrailLLMContextWithHistory, payload);

      finalResult = result;
      this.annotateIncrementalResult(result, turnIndex, latestMessage);

      if (result.tripwireTriggered) {
        break;
      }
    }

    if (!finalResult) {
      return {
        tripwireTriggered: false,
        info: {
          guardrail_name: guardrail.definition.name,
          observation: 'No conversation turns evaluated',
          flagged: false,
          confidence: 0.0,
          input_text: sampleData,
        },
      };
    }

    return finalResult;
  }

  private extractLatestInput(
    message: NormalizedConversationEntry | undefined,
    fallback: string
  ): string {
    if (!message) {
      return fallback;
    }

    const content = typeof message.content === 'string' ? message.content : null;
    if (content && content.trim().length > 0) {
      return content.trim();
    }

    const args = typeof message.arguments === 'string' ? message.arguments : null;
    if (args && args.trim().length > 0) {
      return args.trim();
    }

    const output = typeof message.output === 'string' ? message.output : null;
    if (output && output.trim().length > 0) {
      return output.trim();
    }

    return fallback;
  }

  private annotateIncrementalResult(
    result: GuardrailResult,
    turnIndex: number,
    message: NormalizedConversationEntry | undefined
  ): void {
    if (!result.info) {
      result.info = {};
    }

    result.info.turn_index = turnIndex;

    if (message && typeof message === 'object') {
      if (message.role && result.info.trigger_role === undefined) {
        result.info.trigger_role = message.role;
      }
      if (result.info.trigger_message === undefined) {
        result.info.trigger_message = message;
      }
    }
  }

  private createConversationContext(
    context: Context,
    conversationHistory: NormalizedConversationEntry[]
  ): GuardrailLLMContextWithHistory {
    return {
      guardrailLlm: context.guardrailLlm,
      getConversationHistory: () => conversationHistory,
    };
  }
}

function safeStringify(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}
