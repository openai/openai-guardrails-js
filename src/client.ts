/**
 * High-level GuardrailsClient for easy integration with OpenAI APIs.
 *
 * This module provides GuardrailsOpenAI and GuardrailsAzureOpenAI classes that
 * subclass OpenAI's clients to provide full API compatibility while automatically
 * applying guardrails to text-based methods that could benefit from validation.
 */

import { type AzureClientOptions, AzureOpenAI, type ClientOptions, OpenAI } from 'openai';
import { GuardrailsBaseClient, type PipelineConfig } from './base-client';
import type { Chat as GuardrailsChat } from './resources/chat';
import type { Responses as GuardrailsResponses } from './resources/responses';
import type { GuardrailLLMContext } from './types';

// Re-export for backward compatibility
export { GuardrailResults, GuardrailsResponse } from './base-client';

/**
 * OpenAI subclass with automatic guardrail integration.
 *
 * This class provides full OpenAI API compatibility while automatically
 * applying guardrails to text-based methods that could benefit from validation.
 *
 * Methods with guardrails:
 * - chat.completions.create() - Input/output validation
 * - responses.create() - Input/output validation
 *
 * All other methods pass through unchanged for full API compatibility.
 */
export class GuardrailsOpenAI extends OpenAI {
  private guardrailsClient!: GuardrailsBaseClientImpl;

  // Retain OpenAI's original types for drop-in compatibility
  public override chat!: InstanceType<typeof OpenAI>['chat'];

  // Strongly-typed namespace for guardrail-aware resources
  public readonly guardrails!: {
    responses: GuardrailsResponses;
    chat: GuardrailsChat;
  };
  public override responses!: InstanceType<typeof OpenAI>['responses'];

  private constructor(
    options?: ConstructorParameters<typeof OpenAI>[0],
    guardrailsClient?: GuardrailsBaseClientImpl
  ) {
    // Initialize OpenAI client first
    super(options);

    // SDK withOptions constructs the clone before its initialized guards are attached.
    if (guardrailsClient) {
      this.guardrailsClient = guardrailsClient;
      this.overrideResources();
    }
  }

  /**
   * Create a new GuardrailsOpenAI instance.
   *
   * @param config Pipeline configuration (file path, object, or JSON string)
   * @param options Optional OpenAI client options
   * @param raiseGuardrailErrors If true, raise exceptions when guardrails fail to execute.
   *   If false (default), treat guardrail execution errors as safe and continue.
   *   Note: Tripwires (guardrail violations) are handled separately and not affected
   *   by this parameter.
   * @returns Promise resolving to configured GuardrailsOpenAI instance
   */
  static async create(
    config: string | PipelineConfig,
    options?: ConstructorParameters<typeof OpenAI>[0],
    raiseGuardrailErrors: boolean = false
  ): Promise<GuardrailsOpenAI> {
    // Create and initialize the guardrails client
    const guardrailsClient = new GuardrailsBaseClientImpl();
    await guardrailsClient.initializeClient(config, options || {}, OpenAI);

    // Store the raiseGuardrailErrors setting
    guardrailsClient.raiseGuardrailErrors = raiseGuardrailErrors;

    // Create the instance with the initialized client
    return new GuardrailsOpenAI(options, guardrailsClient);
  }

  /** Clone SDK options while retaining the initialized guardrail pipeline. */
  public override withOptions(options: Partial<ClientOptions>): this {
    const clone = super.withOptions(options);
    clone.guardrailsClient = this.guardrailsClient.withOptions(options);
    clone.overrideResources();
    return clone;
  }

  /**
   * Override chat and responses with our guardrail-enhanced versions.
   */
  private overrideResources(): void {
    const { Chat } = require('./resources/chat');
    const { Responses } = require('./resources/responses');

    // Replace the chat and responses attributes with our versions
    Object.defineProperty(this, 'chat', {
      value: new Chat(this.guardrailsClient),
      writable: false,
      configurable: false,
    });

    Object.defineProperty(this, 'responses', {
      value: new Responses(this.guardrailsClient),
      writable: false,
      configurable: false,
    });

    Object.defineProperty(this, 'guardrails', {
      value: {
        responses: new Responses(this.guardrailsClient),
        chat: new Chat(this.guardrailsClient),
      },
      writable: false,
      configurable: false,
    });
  }
}

// ---------------- Azure OpenAI Variant -----------------

/**
 * Azure OpenAI subclass with automatic guardrail integration.
 */
export class GuardrailsAzureOpenAI extends AzureOpenAI {
  private guardrailsClient!: GuardrailsBaseClientImplAzure;

  // Retain Azure OpenAI's original types for drop-in compatibility
  public override chat!: InstanceType<typeof AzureOpenAI>['chat'];
  public override responses!: InstanceType<typeof AzureOpenAI>['responses'];

  // Strongly-typed namespace for guardrail-aware resources
  public readonly guardrails!: {
    responses: GuardrailsResponses;
    chat: GuardrailsChat;
  };

  private constructor(
    azureArgs: ConstructorParameters<typeof AzureOpenAI>[0],
    guardrailsClient?: GuardrailsBaseClientImplAzure
  ) {
    // Initialize Azure OpenAI client first
    super(azureArgs);

    // SDK withOptions constructs the clone before its initialized guards are attached.
    if (guardrailsClient) {
      this.guardrailsClient = guardrailsClient;
      this.overrideResources();
    }
  }

  /**
   * Create a new GuardrailsAzureOpenAI instance.
   *
   * @param config Pipeline configuration (file path, object, or JSON string)
   * @param azureOptions Azure OpenAI client options
   * @param raiseGuardrailErrors If true, raise exceptions when guardrails fail to execute.
   *   If false (default), treat guardrail execution errors as safe and continue.
   *   Note: Tripwires (guardrail violations) are handled separately and not affected
   *   by this parameter.
   * @returns Promise resolving to configured GuardrailsAzureOpenAI instance
   */
  static async create(
    config: string | PipelineConfig,
    azureOptions: ConstructorParameters<typeof AzureOpenAI>[0],
    raiseGuardrailErrors: boolean = false
  ): Promise<GuardrailsAzureOpenAI> {
    // Create and initialize the guardrails client
    const guardrailsClient = new GuardrailsBaseClientImplAzure();
    await guardrailsClient.initializeClient(config, azureOptions, AzureOpenAI);

    // Store the raiseGuardrailErrors setting
    guardrailsClient.raiseGuardrailErrors = raiseGuardrailErrors;

    // Create the instance with the initialized client
    return new GuardrailsAzureOpenAI(azureOptions, guardrailsClient);
  }

  /** Clone SDK options while retaining Azure routing and initialized guardrails. */
  public override withOptions(options: Partial<AzureClientOptions>): this {
    const azureOptions = {
      apiVersion: this.apiVersion,
      deployment: this.deploymentName,
      ...options,
    };
    const clone = super.withOptions(azureOptions);
    clone.guardrailsClient = this.guardrailsClient.withOptions(azureOptions);
    clone.overrideResources();
    return clone;
  }

  /**
   * Override chat and responses with our guardrail-enhanced versions.
   */
  private overrideResources(): void {
    const { Chat } = require('./resources/chat');
    const { Responses } = require('./resources/responses');

    // Replace the chat and responses attributes with our versions
    Object.defineProperty(this, 'chat', {
      value: new Chat(this.guardrailsClient),
      writable: false,
      configurable: false,
    });

    Object.defineProperty(this, 'responses', {
      value: new Responses(this.guardrailsClient),
      writable: false,
      configurable: false,
    });

    Object.defineProperty(this, 'guardrails', {
      value: {
        responses: new Responses(this.guardrailsClient),
        chat: new Chat(this.guardrailsClient),
      },
      writable: false,
      configurable: false,
    });
  }
}

/**
 * Concrete implementation of GuardrailsBaseClient.
 */
class GuardrailsBaseClientImpl extends GuardrailsBaseClient {
  /**
   * Create default context with guardrail_llm client.
   */
  protected createDefaultContext(): GuardrailLLMContext {
    // Let the SDK preserve provider, workload identity, and callback credentials.
    const guardrailClient = this._resourceClient.withOptions({});

    return {
      guardrailLlm: guardrailClient,
    };
  }

  public withOptions(options: Partial<ClientOptions>): GuardrailsBaseClientImpl {
    const clone = new GuardrailsBaseClientImpl();
    clone._resourceClient = this._resourceClient.withOptions(options);
    clone.pipeline = this.pipeline;
    clone.guardrails = this.guardrails;
    clone.raiseGuardrailErrors = this.raiseGuardrailErrors;
    clone.context = clone.createDefaultContext();
    return clone;
  }

  /**
   * Override resources with guardrail-enhanced versions.
   * Not used in the concrete implementation since the main classes handle this.
   */
  protected overrideResources(): void {
    // No-op in the implementation class
  }
}

/**
 * Azure-specific implementation of GuardrailsBaseClient.
 */
class GuardrailsBaseClientImplAzure extends GuardrailsBaseClient {
  private azureArgs: ConstructorParameters<typeof AzureOpenAI>[0] = {};

  /**
   * Create default context with Azure guardrail_llm client.
   */
  protected createDefaultContext(): GuardrailLLMContext {
    // Create a separate Azure client instance for guardrails
    const guardrailClient = new AzureOpenAI(this.azureArgs);

    return {
      guardrailLlm: guardrailClient,
    };
  }

  public withOptions(options: Partial<AzureClientOptions>): GuardrailsBaseClientImplAzure {
    const clone = new GuardrailsBaseClientImplAzure();
    const resource = this._resourceClient.withOptions(options);
    clone._resourceClient = resource;
    clone.pipeline = this.pipeline;
    clone.guardrails = this.guardrails;
    clone.raiseGuardrailErrors = this.raiseGuardrailErrors;
    // Native Azure clones need the API version and deployment passed explicitly.
    clone.context = { guardrailLlm: resource.withOptions(options) };
    return clone;
  }

  /**
   * Override resources with guardrail-enhanced versions.
   * Not used in the concrete implementation since the main classes handle this.
   */
  protected overrideResources(): void {
    // No-op in the implementation class
  }

  /**
   * Store Azure args for creating guardrail client.
   */
  public override async initializeClient(
    config: string | PipelineConfig,
    openaiArgs: ConstructorParameters<typeof AzureOpenAI>[0],
    clientClass: typeof AzureOpenAI | typeof OpenAI
  ): Promise<void> {
    // Store azure arguments
    this.azureArgs = openaiArgs;

    // Call parent initialization
    return super.initializeClient(config, openaiArgs, clientClass);
  }
}
