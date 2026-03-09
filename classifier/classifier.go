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
	"strconv"
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
	HTTP      bool
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
	defaultPort := 7234
	if s := os.Getenv("PORT"); s != "" {
		if p, err := strconv.Atoi(s); err == nil {
			defaultPort = p
		}
	}
	flag.BoolVar(&cfg.HTTP, "http", false, "Start HTTP server; otherwise classify the positional argument string")
	flag.IntVar(&cfg.Port, "port", defaultPort, "Port to listen on (with -http)")
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

const classifyChunkSize = 4096

// chunkString splits s into chunks of at most size bytes, never splitting a UTF-8 rune.
func chunkString(s string, size int) []string {
	if size <= 0 || len(s) == 0 {
		if s == "" {
			return nil
		}
		return []string{s}
	}
	var chunks []string
	for len(s) > 0 {
		if len(s) <= size {
			chunks = append(chunks, s)
			break
		}
		cut := size
		for cut > 0 && (s[cut]&0xC0) == 0x80 {
			cut--
		}
		if cut == 0 {
			cut = size
		}
		chunks = append(chunks, s[:cut])
		s = s[cut:]
	}
	return chunks
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

// Classify runs the model on text (chunked as needed) and returns the aggregated result.
func (s *Server) Classify(text string) (ClassifyResponse, error) {
	start := time.Now()
	if strings.TrimSpace(text) == "" {
		return ClassifyResponse{
			Injection: false,
			Score:     0,
			Label:     "LEGITIMATE",
			LatencyMs: 0,
		}, nil
	}
	chunks := chunkString(text, classifyChunkSize)
	results, err := s.pipeline.RunPipeline(chunks)
	if err != nil {
		return ClassifyResponse{}, err
	}
	numOutputs := len(results.ClassificationOutputs)
	if numOutputs == 0 {
		return ClassifyResponse{}, fmt.Errorf("no output from model")
	}
	if numOutputs != len(chunks) {
		return ClassifyResponse{}, fmt.Errorf("model result count does not match chunk count")
	}
	var maxScore float64
	var anyInjection bool
	for chunkIdx := range results.ClassificationOutputs {
		if len(results.ClassificationOutputs[chunkIdx]) == 0 {
			continue
		}
		result := results.ClassificationOutputs[chunkIdx][0]
		score := injectionScore(result)
		if score > maxScore {
			maxScore = score
		}
		if score >= s.threshold {
			anyInjection = true
		}
	}
	label := "LEGITIMATE"
	if anyInjection {
		label = "INJECTION"
	}
	return ClassifyResponse{
		Injection: anyInjection,
		Score:     maxScore,
		Label:     label,
		LatencyMs: float64(time.Since(start).Microseconds()) / 1000.0,
	}, nil
}

func (s *Server) handleClassify(w http.ResponseWriter, r *http.Request) {
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

	resp, err := s.Classify(req.Text)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
		return
	}
	json.NewEncoder(w).Encode(resp)
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

	if cfg.HTTP {
		runHTTP(srv, cfg.Port)
		return
	}

	args := flag.Args()
	if len(args) == 0 {
		log.Fatal("Usage: classifier <string> to classify, or classifier -http to start the server")
	}
	text := strings.Join(args, " ")

	resp, err := srv.Classify(text)
	if err != nil {
		log.Fatalf("Classify: %v", err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(resp); err != nil {
		log.Fatalf("Output: %v", err)
	}
}

func runHTTP(srv *Server, port int) {
	mux := http.NewServeMux()
	mux.HandleFunc("/classify", srv.handleClassify)
	mux.HandleFunc("/health", srv.handleHealth)

	addr := fmt.Sprintf("127.0.0.1:%d", port)
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
