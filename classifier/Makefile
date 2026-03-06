MODEL_DIR := models/modernbert-base-prompt-injection-detection

.PHONY: build download

build: download
	CGO_ENABLED=1 \
	CGO_LDFLAGS="-L$$(brew --prefix onnxruntime)/lib -L$${HOME}/tokenizers -Wl,-rpath,$$(brew --prefix onnxruntime)/lib" \
	go build -tags ORT -o classifier .

download:
	@if [ ! -f "$(MODEL_DIR)/model.onnx" ]; then \
		echo "Downloading model..."; \
		if command -v hf >/dev/null 2>&1; then \
			hf download tihilya/modernbert-base-prompt-injection-detection --local-dir $(MODEL_DIR); \
		elif command -v huggingface-cli >/dev/null 2>&1; then \
			huggingface-cli download tihilya/modernbert-base-prompt-injection-detection --local-dir $(MODEL_DIR); \
		else \
			echo "Error: install Hugging Face CLI (pip install huggingface_hub[cli])" >&2; \
			exit 1; \
		fi; \
	else \
		echo "Model already present."; \
	fi
