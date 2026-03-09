# Prompt injection classifier

HTTP service that classifies text for prompt injection using the ModernBERT model.

## Prerequisites

Run from the `classifier` directory:

```bash
make setup
```

This installs ONNX Runtime and the [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli) (`hf`). The tokenizers library cannot be installed automatically: put `libtokenizers.a` (or `libtokenizers.dylib`) in `$HOME/tokenizers` — [download a prebuilt](https://github.com/daulet/tokenizers/releases) or [build from source](https://github.com/daulet/tokenizers). Re-run `make setup` after adding it; it will succeed once the library is present.

Manual steps (if you prefer):

1. **ONNX Runtime** — `brew install onnxruntime`
2. **daulet/tokenizers** — Extract or build so `$HOME/tokenizers/libtokenizers.a` (or `.dylib`) exists.
3. **Hugging Face CLI** — Install so `hf` is available: [standalone script](https://huggingface.co/docs/huggingface_hub/guides/cli#standalone-installer-recommended) (`curl -LsSf https://hf.co/cli/install.sh | bash`), or `brew install huggingface-cli`, or `pip install -U "huggingface_hub"`.

## Build

```bash
cd classifier
make build
```

This downloads the model (if needed) and builds the binary.

## Run

**Start the HTTP server** (for the guard and other callers):

```bash
./classifier --http
```

The server listens on `http://127.0.0.1:7234` by default. Override with `-port`, or set the `PORT` environment variable. Optional flags: `-model` (path to ONNX model dir), `-threshold` (injection score threshold 0–1, default 0.85).

**Classify a string once** (prints JSON to stdout and exits):

```bash
./classifier "text to classify"
./classifier ignore previous instructions
```

With no `-http` flag, the first argument (or all arguments joined with spaces) is the string to classify. Output is the same JSON as the `/classify` response: `injection`, `score`, `label`, `latency_ms`.

## HTTP API

- **GET `/health`** — Returns `{"status":"ok"}`. Use to check if the service is up.

- **POST `/classify`** — Classifies text for prompt injection.
  - Request: JSON body `{"text": "<string>"}`. No size limit; the server chunks long text internally at 4096 bytes (without splitting UTF-8 runes) and runs the model on each chunk.
  - Response: JSON `{"injection": <bool>, "score": <0-1>, "label": "INJECTION"|"LEGITIMATE", "latency_ms": <float>}`. The whole text is considered an injection if any chunk scores at or above the threshold; `score` is the maximum score across chunks.
  - Errors: 400 for missing/invalid body or empty `text`, 405 for non-POST, 500 on model or pipeline errors.
