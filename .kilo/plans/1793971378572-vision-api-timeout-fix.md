# Vision API Multimodal Transmission Fix Plan

## Problem Summary
Food photo analysis requests (`ai_vision.py`) fail with `ReadError`/timeout on ALL models (Gemini + OpenRouter), while text-only requests complete in ~3.7 seconds via the same Cloudflare Worker proxy.

**Key Observation**: Both text and vision requests route through `https://inspectorgpt.classname1984.workers.dev` (Cloudflare Worker). Text succeeds; images fail systematically. This isolates the issue to the **worker proxy handling of image payloads**, not the client timeout or model availability.

## Root Cause Analysis

### Payload Structure Verification

**Gemini Vision (line 377-389)** - Correct format for Gemini REST API:
```python
payload = {
    "contents": [{
        "parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/jpeg", "data": base64_img}}  # Pure base64 - CORRECT
        ]
    }],
    "generationConfig": {...}
}
```

**OpenRouter Vision (line 411-422)** - Correct format for OpenAI-compatible API:
```python
payload = {
    "model": model_name,
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}}  # data: prefix - CORRECT
        ]
    }],
    ...
}
```

**Image Generation (nutrition.py:956)** - Pure base64, no prefix:
```python
base64_img = base64.b64encode(buffer.read()).decode("utf-8")  # CORRECT
```

### Why Images Fail But Text Works
| Factor | Text Request | Image Request |
|--------|-------------|---------------|
| Payload size | ~2-5 KB | ~200-300 KB (base64) |
| Worker processing | Pass-through | May decode/transform |
| Upstream API | Gemini text endpoint | Gemini vision endpoint |
| **Worker CPU time** | < 10ms | **Likely exceeds limit** |

**Hypothesis**: The Cloudflare Worker free tier has a **10ms CPU time limit**. Decoding/forwarding a 300 KB base64 payload to Gemini's vision endpoint exceeds this, causing the worker to terminate the subrequest → `ReadError` on client side.

## Implementation Plan

### Phase 1: Diagnostic Logging (Immediate)

**File: `app/services/ai_vision.py`**

Add detailed request/response logging to `_call_gemini` and `_call_openrouter`:
- Log exact payload size, URL, headers
- Log worker response status and timing
- Capture raw error response body

```python
logger.debug(f"[AI Vision] Request: url={url}, payload_bytes={len(json.dumps(payload))}")
start = time.perf_counter()
response = await client.post(url, json=payload, headers=headers)
elapsed = time.perf_counter() - start
logger.debug(f"[AI Vision] Response: status={response.status_code}, elapsed={elapsed:.2f}s, body={response.text[:500]}")
```

### Phase 2: Test Direct API Bypass (Validation)

Create a test script to call Gemini API directly (bypassing worker):
- Use `GEMINI_API_KEY` directly against `generativelanguage.googleapis.com`
- Compare latency and success rate
- If direct works → worker is the bottleneck

### Phase 3: Reduce Image Payload Size

**File: `app/services/nutrition.py` (line 948-956)**

Reduce compression aggressively for faster worker processing:
```python
max_dim = 512  # Was 1024 - smaller image = smaller base64 = faster worker
quality = 60   # Was 80 - lower quality = smaller payload
```

Target: base64 < 50 KB (raw image ~35 KB) to stay within worker CPU budget.

### Phase 4: Increase Client Timeouts (From Previous Plan)

**File: `app/services/ai_vision.py` (lines 16-17)**
```python
MODEL_REQUEST_TIMEOUT = 90.0   # Was 20.0
MODEL_CONNECT_TIMEOUT = 30.0   # Was 10.0
```

Remove redundant `timeout=` from individual `client.post()` calls.

### Phase 5: Worker Configuration Check (External)

Contact worker owner / check worker code for:
- CPU time limits
- Request body size limits
- Upstream timeout settings
- Whether vision requests route differently than text

## Configuration Constants

| Constant | Current | Proposed | Location |
|----------|---------|----------|----------|
| `MODEL_REQUEST_TIMEOUT` | 20.0 | 90.0 | `ai_vision.py:16` |
| `MODEL_CONNECT_TIMEOUT` | 10.0 | 30.0 | `ai_vision.py:17` |
| Image `max_dim` | 1024 | 512 | `nutrition.py:948` |
| Image `quality` | 80 | 60 | `nutrition.py:954` |

## Testing Strategy

### Diagnostic Test (Run First)
```python
# Test script to isolate worker vs direct API
import httpx, base64, asyncio

async def test_direct_gemini():
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"
    # ... direct call with API key
```

### Integration Test
1. Upload food photo → check logs for payload size and worker response time
2. Verify base64 < 50 KB after compression changes
3. Confirm first model succeeds without cascade fallback

### Load Test
- 5 sequential uploads with reduced image size
- Target: < 15s total, all on first model

## Expected Outcome

| Metric | Current | After Fix |
|--------|---------|-----------|
| Image payload (base64) | 200-300 KB | < 50 KB |
| Worker CPU time | > 10ms (timeout) | < 10ms |
| First model success rate | 0% | > 90% |
| Total analysis time | 90s (cascade) | 10-20s |

## Rollback Plan

1. Revert image compression to 1024/80 if quality unacceptable
2. Revert timeouts to 20s/10s if worker fixes deployed
3. Implement direct API fallback if worker remains unreliable

## Open Questions

1. **Worker access**: Can we view/modify the Cloudflare Worker code?
2. **Direct API costs**: Does bypassing worker violate any quota/cost agreements?
3. **Image quality floor**: Is 512px/quality 60 sufficient for nutrition analysis accuracy?
4. **Alternative workers**: Are there other proxy endpoints with higher limits?