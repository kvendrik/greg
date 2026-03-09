MODEL_DIR := models/modernbert-base-prompt-injection-detection
TOKENIZERS_DIR := $(HOME)/tokenizers

.PHONY: build download setup

setup:
	@echo "Installing ONNX Runtime..."
	@brew install onnxruntime
	@echo "Installing Hugging Face CLI (hf)..."
	@command -v hf >/dev/null 2>&1 || curl -LsSf https://hf.co/cli/install.sh | bash
	@if [ ! -f "$(TOKENIZERS_DIR)/libtokenizers.a" ] && [ ! -f "$(TOKENIZERS_DIR)/libtokenizers.dylib" ]; then \
		echo ""; \
		echo "daulet/tokenizers: put libtokenizers in $(TOKENIZERS_DIR)/"; \
		echo "  Download: https://github.com/daulet/tokenizers/releases"; \
		echo "  Or build from source: https://github.com/daulet/tokenizers"; \
		exit 1; \
	fi
	@echo "Setup complete."

build: download
	CGO_ENABLED=1 \
	CGO_LDFLAGS="-L$$(brew --prefix onnxruntime)/lib -L$${HOME}/tokenizers -Wl,-rpath,$$(brew --prefix onnxruntime)/lib" \
	go build -tags ORT -o classifier .

download:
	@if [ ! -f "$(MODEL_DIR)/model.onnx" ]; then \
		echo "Downloading model..."; \
		if command -v hf >/dev/null 2>&1; then \
			hf download tihilya/modernbert-base-prompt-injection-detection --local-dir $(MODEL_DIR); \
		else \
			echo "Error: install Hugging Face CLI" >&2; \
			exit 1; \
		fi; \
	else \
		echo "Model already present."; \
	fi
