# Prompt injection classifier

HTTP service that classifies text for prompt injection using the ModernBERT model.

## Prerequisites

- Go 1.25+
- [ONNX Runtime](https://onnxruntime.ai/) (`brew install onnxruntime`)
- [daulet/tokenizers](https://github.com/daulet/tokenizers) libtokenizers.a in `$HOME/tokenizers` (or [download prebuilt](https://github.com/daulet/tokenizers/releases))
- Hugging Face CLI (`pip install huggingface_hub[cli]`)

## Build

```bash
cd classifier
make build
```

This downloads the model (if needed) and builds the binary.

## Run

From the repo root:

```bash
./classifier/classifier
```

Or from the classifier directory:

```bash
cd classifier
./classifier
```
