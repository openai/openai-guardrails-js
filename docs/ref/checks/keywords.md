# Keyword Filter

Detects and blocks text containing specified banned keywords or phrases. Uses case-insensitive matching with word boundaries to identify forbidden terms and triggers if any configured keyword is found.

## Configuration

```json
{
    "name": "Keyword Filter",
    "config": {
        "keywords": ["confidential", "secret", "internal only", "do not share"]
    }
}
```

### Parameters

- **`keywords`** (required): List of banned keywords or phrases to detect

## What It Returns

Returns a `GuardrailResult` with the following `info` dictionary:

```json
{
    "guardrail_name": "Keyword Filter",
    "matchedKeywords": ["confidential", "secret"],
    "originalKeywords": ["confidential", "secret", "internal only"],
    "sanitizedKeywords": ["confidential", "secret", "internal only"],
    "totalKeywords": 3,
    "textLength": 68
}
```

- **`matchedKeywords`**: List of keywords found in the text (case-insensitive, deduplicated)
- **`originalKeywords`**: Original keywords that were configured for detection
- **`sanitizedKeywords`**: Keywords after trimming trailing punctuation
- **`totalKeywords`**: Count of configured keywords
- **`textLength`**: Length of the scanned text
