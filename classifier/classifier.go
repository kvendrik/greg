package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/knights-analytics/hugot"
	"github.com/knights-analytics/hugot/options"
	"github.com/knights-analytics/hugot/pipelines"
)

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type Config struct {
	Port      int
	ModelPath string
	Threshold float64
}

func parseConfig() Config {
	cfg := Config{}
	defaultModel := "models/modernbert-base-prompt-injection-detection"
	if exe, err := os.Executable(); err == nil {
		defaultModel = filepath.Join(filepath.Dir(exe), "models", "modernbert-base-prompt-injection-detection")
	}
	flag.IntVar(&cfg.Port, "port", 7234, "Port to listen on")
	flag.StringVar(&cfg.ModelPath, "model", defaultModel, "Path to ONNX model directory")
	flag.Float64Var(&cfg.Threshold, "threshold", 0.85, "Injection score threshold (0-1)")
	flag.Parse()
	return cfg
}

// ---------------------------------------------------------------------------
// Brew path detection
// ---------------------------------------------------------------------------

// onnxLibPath finds libonnxruntime via brew at runtime.
// Falls back to known hardcoded paths so no env vars are needed.
func onnxLibPath() string {
	out, err := exec.Command("brew", "--prefix", "onnxruntime").Output()
	if err == nil {
		prefix := strings.TrimSpace(string(out))
		path := prefix + "/lib/libonnxruntime.dylib"
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}

	candidates := []string{
		"/opt/homebrew/opt/onnxruntime/lib/libonnxruntime.dylib", // ARM Mac
		"/usr/local/opt/onnxruntime/lib/libonnxruntime.dylib",    // Intel Mac
		"/usr/lib/onnxruntime.so",                                 // Linux
		"/usr/local/lib/onnxruntime.so",
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}

	return "" // hugot will attempt auto-detection
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

type ClassifyRequest struct {
	Text string `json:"text"`
}

type ClassifyResponse struct {
	Injection bool    `json:"injection"`
	Score     float64 `json:"score"`
	Label     string  `json:"label"`
	LatencyMs float64 `json:"latency_ms"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

type Server struct {
	pipeline  *pipelines.TextClassificationPipeline
	threshold float64
}

func NewServer(modelPath string, threshold float64) (*Server, error) {
	libPath := onnxLibPath()
	if libPath != "" {
		log.Printf("ONNX Runtime: %s", libPath)
	} else {
		log.Printf("ONNX Runtime: auto-detect")
	}
	log.Printf("Loading model from %s ...", modelPath)

	var opts []options.WithOption
	if libPath != "" {
		opts = append(opts, options.WithOnnxLibraryPath(filepath.Dir(libPath)))
	}

	session, err := hugot.NewORTSession(opts...)
	if err != nil {
		return nil, fmt.Errorf("hugot session: %w", err)
	}

	config := hugot.TextClassificationConfig{
		ModelPath: modelPath,
		Name:      "prompt-injection",
	}

	pipeline, err := hugot.NewPipeline(session, config)
	if err != nil {
		return nil, fmt.Errorf("pipeline: %w", err)
	}

	log.Printf("Ready (threshold=%.2f)", threshold)
	return &Server{pipeline: pipeline, threshold: threshold}, nil
}

func (s *Server) handleClassify(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "POST only"})
		return
	}

	var req ClassifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "invalid JSON"})
		return
	}
	if req.Text == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "text is required"})
		return
	}

	text := req.Text
	if len(text) > 4096 {
		text = text[:4096]
	}

	results, err := s.pipeline.RunPipeline([]string{text})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
		return
	}

	if len(results.ClassificationOutputs) == 0 || len(results.ClassificationOutputs[0]) == 0 {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: "no output from model"})
		return
	}

	result := results.ClassificationOutputs[0][0]
	score := injectionScore(result)

	json.NewEncoder(w).Encode(ClassifyResponse{
		Injection: score >= s.threshold,
		Score:     score,
		Label:     result.Label,
		LatencyMs: float64(time.Since(start).Microseconds()) / 1000.0,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// injectionScore normalises model output to a 0-1 injection probability.
// The tihilya model outputs labels "INJECTION" and "BENIGN".
func injectionScore(result pipelines.ClassificationOutput) float64 {
	if result.Label == "INJECTION" {
		return float64(result.Score)
	}
	s := float64(result.Score)
	if s >= 0 && s <= 1 {
		return 1.0 - s // BENIGN probability → invert
	}
	// Raw logit fallback
	e0, e1 := math.Exp(s), math.Exp(-s)
	return e1 / (e0 + e1)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	cfg := parseConfig()

	srv, err := NewServer(cfg.ModelPath, cfg.Threshold)
	if err != nil {
		log.Fatalf("Failed to start: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/classify", srv.handleClassify)
	mux.HandleFunc("/health", srv.handleHealth)

	addr := fmt.Sprintf("127.0.0.1:%d", cfg.Port)
	httpSrv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("Listening on http://%s", addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Listen error: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpSrv.Shutdown(ctx)
}
