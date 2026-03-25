# Data Submitter Contract (RIP_DATA_SUBMITTER_BIN)

Defines the stdin/stdout interface for the external data-plane submitter used by Electron backend `submit-job`.

## Invocation

Backend executes:

```bash
$RIP_DATA_SUBMITTER_BIN submit-job
```

- Input: JSON payload on **stdin**
- Output: JSON response on **stdout**
- Exit code: `0` for handled response (accepted or rejected)

## Request payload schema (v1)

```json
{
  "jobId": "string (8-64, [A-Za-z0-9_-])",
  "fileName": "string",
  "config": {
    "host": "string",
    "commandPort": "number",
    "eventPort": "number (optional)",
    "jobDataPort": "number (optional)",
    "protocol": "string (optional)"
  },
  "settings": {
    "copies": "number (optional)",
    "fitMode": "string (optional)",
    "offsetXmm": "number (optional)",
    "offsetYmm": "number (optional)",
    "rotationDeg": "number (optional)",
    "...": "other deterministic placement/runtime fields"
  }
}
```

## Response schema

```json
{
  "accepted": "boolean",
  "status": "submitted|rejected|not-configured|error",
  "message": "string|null",
  "jobId": "string|null",
  "timestamp": "ISO-8601",
  "code": "optional machine error code",
  "details": "optional object"
}
```

## Deterministic local harness

For offline testing, use:

```bash
export RIP_DATA_SUBMITTER_BIN=$PWD/scripts/mock-data-submitter.js
```

The harness validates payload shape and returns deterministic success/failure JSON without requiring printer access.
