# Contains PII

Detects personally identifiable information (PII) such as SSNs, phone numbers, credit card numbers, and email addresses using Guardrails' built-in TypeScript regex engine. The check can automatically mask detected spans or block the request based on configuration.

**Advanced Security Features:**

- **Unicode normalization**: Prevents bypasses using fullwidth characters (＠) or zero-width spaces
- **Encoded PII detection**: Optionally detects PII hidden in Base64, URL-encoded, or hex strings
- **URL context awareness**: Detects emails in query parameters (e.g., `GET /api?user=john@example.com`)
- **Custom patterns**: Extends the default entity list with CVV/CVC codes, BIC/SWIFT identifiers, and other global formats

## Configuration

```json
{
    "name": "Contains PII",
    "config": {
        "entities": ["EMAIL_ADDRESS", "US_SSN", "CREDIT_CARD", "PHONE_NUMBER", "CVV", "BIC_SWIFT"],
        "block": false,
        "detect_encoded_pii": false
    }
}
```

### Parameters

- **`entities`** (required): List of PII entity types to detect. See the `PIIEntity` enum in `src/checks/pii.ts` for the full list, including custom entities such as `CVV` (credit card security codes) and `BIC_SWIFT` (bank identification codes).
- **`block`** (optional): Whether to block content or just mask PII (default: `false`)
- **`detect_encoded_pii`** (optional): If `true`, detects PII in Base64/URL-encoded/hex strings (default: `false`)

## Implementation Notes

Under the hood the TypeScript guardrail normalizes text (Unicode NFKC), strips zero-width characters, and runs curated regex patterns for each configured entity. When `detect_encoded_pii` is enabled the check also decodes Base64, URL-encoded, and hexadecimal substrings before rescanning them for matches, remapping any findings back to the original encoded content.

**Stage-specific behavior is critical:**

- **Pre-flight stage**: Use `block=false` (default) for automatic PII masking of user input
- **Output stage**: Use `block=true` to prevent PII exposure in LLM responses
- **Masking in output stage is not supported** and will not work as expected

**PII masking mode** (default, `block=false`):

- Automatically replaces detected PII with placeholder tokens like `<EMAIL_ADDRESS>`, `<US_SSN>`
- Does not trigger tripwire - allows content through with PII masked

**Blocking mode** (`block=true`):

- Triggers tripwire when PII is detected
- Prevents content from being delivered to users

## What It Returns

Returns a `GuardrailResult` with the following `info` dictionary:

### Basic Example (Plain PII)

```json
{
    "guardrail_name": "Contains PII",
    "detected_entities": {
        "EMAIL_ADDRESS": ["user@email.com"],
        "US_SSN": ["123-45-6789"]
    },
    "entity_types_checked": ["EMAIL_ADDRESS", "US_SSN", "CREDIT_CARD"],
    "checked_text": "Contact me at <EMAIL_ADDRESS>, SSN: <US_SSN>",
    "block_mode": false,
    "pii_detected": true
}
```

### With Encoded PII Detection Enabled

When `detect_encoded_pii: true`, the guardrail also detects and masks encoded PII:

```json
{
    "guardrail_name": "Contains PII",
    "detected_entities": {
        "EMAIL_ADDRESS": [
            "user@email.com",
            "am9obkBleGFtcGxlLmNvbQ==",
            "%6a%6f%65%40domain.com",
            "6a6f686e406578616d706c652e636f6d"
        ]
    },
    "entity_types_checked": ["EMAIL_ADDRESS"],
    "checked_text": "Contact <EMAIL_ADDRESS> or <EMAIL_ADDRESS_ENCODED> or <EMAIL_ADDRESS_ENCODED>",
    "block_mode": false,
    "pii_detected": true
}
```

Note: Encoded PII is masked with `<ENTITY_TYPE_ENCODED>` to distinguish it from plain text PII.

### Field Descriptions

- **`detected_entities`**: Detected entities and their values (includes both plain and encoded forms when `detect_encoded_pii` is enabled)
- **`entity_types_checked`**: List of entity types that were configured for detection
- **`checked_text`**: Text with PII masked. Plain PII uses `<ENTITY_TYPE>`, encoded PII uses `<ENTITY_TYPE_ENCODED>`
- **`block_mode`**: Whether the check was configured to block or mask
- **`pii_detected`**: Boolean indicating if any PII was found (plain or encoded)
