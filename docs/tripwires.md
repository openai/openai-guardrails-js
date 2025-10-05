# Tripwires

Tripwires are the core mechanism by which Guardrails enforce safety policies. When a guardrail detects a violation, it triggers a tripwire that blocks execution by default.

## How Tripwires Work

1. **Automatic Execution**: Guardrails run on every API call
2. **Tripwire Detection**: Violations trigger tripwires
3. **Default Behavior**: Tripwires raise `GuardrailTripwireTriggered` exceptions
4. **Custom Handling**: Suppress tripwires to handle violations manually

## Default Behavior: Blocking

Tripwires raise exceptions by default:

TypeScript
```typescript
import { GuardrailsOpenAI, GuardrailTripwireTriggered } from '@openai/guardrails';

const client = await GuardrailsOpenAI.create({
  version: 1,
  output: {
    version: 1,
    guardrails: [
      { name: 'Moderation', config: { categories: ['hate', 'violence'] } }
    ]
  }
});

try {
  const response = await client.responses.create({
    model: 'gpt-5',
    input: 'Tell me a secret'
  });
  console.log(response.output_text);
} catch (err) {
  if (err instanceof GuardrailTripwireTriggered) {
    console.log(`Guardrail triggered: ${JSON.stringify(err.guardrailResult.info)}`);
  } else {
    throw err;
  }
}
```

## Suppressing Tripwires

Handle violations manually with `suppress_tripwire: true`:

TypeScript
```typescript
const response = await client.responses.create({
  model: 'gpt-5',
  input: 'Tell me a secret',
  suppress_tripwire: true
});

// Check guardrail results
for (const result of response.guardrail_results.all_results) {
  if (result.tripwire_triggered) {
    console.log(`Guardrail '${result.info.guardrail_name}' triggered!`);
  }
}
```

## Tripwire Results

The `GuardrailTripwireTriggered` exception contains:

- **`tripwire_triggered`** (bool): Always `True`
- **`info`** (dict): Guardrail-specific information

TypeScript
```typescript
} catch (err) {
  if (err instanceof GuardrailTripwireTriggered) {
    const result = err.guardrailResult;
    const guardrailName = result.info.guardrail_name;
    const stage = result.info.stage_name;
  }
}
```

## Next Steps

- Learn about [streaming considerations](./streaming_output.md)
- Explore [examples](./examples.md) for usage patterns
