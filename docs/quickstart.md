# Quickstart: TypeScript

Get started with Guardrails TypeScript in minutes. Guardrails provides drop-in replacements for OpenAI clients that automatically validate inputs and outputs using configurable safety checks.

## Install

```bash
npm install @openai/guardrails
```

## Set API Key

```bash
export OPENAI_API_KEY=sk-...
```

## Create Pipeline Configuration

The fastest way is using the [Guardrails Wizard](https://guardrails.openai.com/) - a no-code tool for creating configurations.

Or define manually:

```json
{
    "version": 1,
    "input": {
        "version": 1,
        "guardrails": [
            {"name": "URL Filter", "config": {}},
            {"name": "Moderation", "config": {"categories": ["hate", "violence"]}}
        ]
    },
    "output": {
        "version": 1,
        "guardrails": [
            {"name": "Contains PII", "config": {"entities": ["EMAIL_ADDRESS", "PHONE_NUMBER"]}}
        ]
    }
}
```

### Pipeline Stages

Guardrails use a **pipeline configuration** with 1 to 3 stages:

- **Preflight** - Runs before the LLM call (e.g., mask PII, moderation)
- **Input** - Runs in parallel with the LLM call (e.g., jailbreak detection)
- **Output** - Runs over the LLM generated content (e.g., fact checking, compliance)

**Not all stages are required** - you can use just input, just output, or any combination.

## Use as Drop-in Replacement

Replace your OpenAI client with the Guardrails version (`GuardrailsOpenAI`):

We support `chat.completions.create` and `responses.create`.

```typescript
import { GuardrailsOpenAI } from '@openai/guardrails';

async function main() {
    // Use GuardrailsOpenAI instead of OpenAI
    const client = await GuardrailsOpenAI.create('./guardrails_config.json');
    
    try {
        const response = await client.responses.create({
            model: "gpt-5",
            input: "Hello world"
        });
        
        // Access OpenAI response directly
        console.log(response.output_text);
        
    } catch (error) {
        if (error.constructor.name === 'GuardrailTripwireTriggered') {
            console.log(`Guardrail triggered: ${error.guardrailResult.info}`);
        }
    }
}

main();
```

**That's it!** Your existing OpenAI code now includes automatic guardrail validation based on your pipeline configuration. The response object works exactly like the original OpenAI response with additional `guardrail_results` property.

## Guardrail Execution Error Handling

Guardrails supports two error handling modes for guardrail execution failures:

### Fail-Safe Mode (Default)
If a guardrail fails to execute (e.g., invalid model name), the system continues passing back `tripwire_triggered=False`:

```typescript
// Default: raiseGuardrailErrors=false
const client = await GuardrailsOpenAI.create(config);
// Continues execution even if guardrails have any errors
```

### Fail-Secure Mode
Enable strict mode to raise exceptions on guardrail execution failures:

```typescript
// Strict mode: raiseGuardrailErrors=true
const client = await GuardrailsOpenAI.create(
    config,
    undefined,
    true  // raiseGuardrailErrors = true
);
// Raises exceptions if guardrails fail to execute properly
```

**Note**: This only affects guardrail execution errors. Safety violations (tripwires) are handled separately - see [Tripwires](./tripwires.md) for details.

## Agents SDK Integration

For OpenAI Agents SDK users, we provide `GuardrailAgent` as a drop-in replacement:

```typescript
import { GuardrailAgent } from '@openai/guardrails';
import { Runner } from '@openai/agents';

// Create agent with guardrails automatically configured
const agent = await GuardrailAgent.create(
    './guardrails_config.json',
    "Customer support agent",
    "You are a customer support agent. You help customers with their questions."
);

// Use exactly like a regular Agent
const result = await Runner.run(agent, "Hello, can you help me?");
```

`GuardrailAgent` automatically wires up your pipeline configuration to the agent's input and output guardrails, so you can focus on building your agent logic.

## Azure OpenAI

Use the Azure-specific client:

```typescript
import { GuardrailsAzureOpenAI } from '@openai/guardrails';

const client = await GuardrailsAzureOpenAI.create(
    './guardrails_config.json',
    {
        azure_endpoint: "https://your-resource.openai.azure.com/",
        api_key: "your-azure-key",
        api_version: "2025-01-01-preview"
    }
);
```

## Third-Party Models

Works with any OpenAI-compatible API:

```typescript
import { GuardrailsOpenAI } from '@openai/guardrails';

// Local Ollama model
const client = await GuardrailsOpenAI.create(
    './guardrails_config.json',
    {
        baseURL: "http://127.0.0.1:11434/v1/",
        apiKey: "ollama"
    }
);
```

## Next Steps

- Explore TypeScript [examples](https://github.com/openai/openai-guardrails-js/tree/main/examples) for advanced patterns
- Learn about [streaming considerations](./streaming_output.md)
