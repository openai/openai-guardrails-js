# LLM Base

Base configuration for LLM-based guardrails. Provides common configuration options used by other LLM-powered checks.

## Configuration

```json
// This is a base configuration class, not a standalone guardrail
// Use one of the LLM-based guardrails instead:
{
    "name": "NSFW Text",  // or "Jailbreak", "Hallucination Detection", etc.
    "config": {
        "model": "gpt-5",
        "confidence_threshold": 0.7,
        "include_reasoning": false,
        "max_turns": 10
    }
}
```

### Parameters

- **`model`** (required): OpenAI model to use for the check (e.g., "gpt-5")
- **`confidence_threshold`** (required): Minimum confidence score to trigger tripwire (0.0 to 1.0)
- **`include_reasoning`** (optional): Whether to include reasoning/explanation fields in the guardrail output (default: `false`)
    - When `false`: The LLM only generates the essential fields (`flagged` and `confidence`), reducing token generation costs
    - When `true`: Additionally, returns detailed reasoning for its decisions
    - **Use Case**: Keep disabled for production to minimize costs; enable for development and debugging
    - **Performance**: In our evaluations, disabling reasoning reduces median latency by 40% on average (ranging from 18% to 67% depending on model) while maintaining detection performance
- **`max_turns`** (optional): Maximum number of conversation turns to include for multi-turn analysis (default: `10`)
    - Controls how much conversation history is passed to the guardrail
    - Higher values provide more context but increase token usage
    - Set to `1` for single-turn mode (no conversation history)

## What It Does

- Provides base configuration for LLM-based guardrails
- Defines common parameters used across multiple LLM checks
- Automatically extracts and includes conversation history for multi-turn analysis
- Not typically used directly - serves as foundation for other checks

## Multi-Turn Support

All LLM-based guardrails automatically support multi-turn conversation analysis:

1. **Automatic History Extraction**: When conversation history is available in the context, it's automatically included in the analysis
2. **Configurable Turn Limit**: Use `max_turns` to control how many recent conversation turns are analyzed
3. **Token Cost Balance**: Adjust `max_turns` to balance between context richness and token costs

## Special Considerations

- **Base Class**: This is a configuration base class, not a standalone guardrail
- **Inheritance**: Other LLM-based checks extend this configuration
- **Common Parameters**: Standardizes model and confidence settings across checks
- **Conversation History**: When available, conversation history is automatically used for more robust detection

## What It Returns

This is a base configuration class and does not return results directly. It provides the foundation for other LLM-based guardrails that return `GuardrailResult` objects.

## Usage

This configuration is typically used by other guardrails like:
- Hallucination Detection
- Jailbreak Detection
- NSFW Detection
- Off Topic Prompts
- Custom Prompt Check
