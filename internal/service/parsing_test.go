package service

import (
	"context"
	"testing"
	"time"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/ai"
)

// mockAIClient 模拟 AI 客户端
type mockAIClient struct {
	response string
	err      error
}

func (m *mockAIClient) ChatCompletion(_ context.Context, _ ai.ChatRequest) (string, error) {
	return m.response, m.err
}

// mockFieldOptionManager 模拟字段选项管理器
type mockFieldOptionManager struct {
	options map[string][]string // key: "tableID:fieldName"
}

func (m *mockFieldOptionManager) GetFieldOptions(_ context.Context, tableID string, fieldName string) ([]string, error) {
	key := tableID + ":" + fieldName
	if opts, ok := m.options[key]; ok {
		return opts, nil
	}
	return []string{}, nil
}

func (m *mockFieldOptionManager) AddFieldOption(_ context.Context, _ string, _ string, _ string) error {
	return nil
}

func newTestService(aiResp string, aiErr error, options map[string][]string) *ParsingService {
	return NewParsingService(
		&mockAIClient{response: aiResp, err: aiErr},
		&mockFieldOptionManager{options: options},
		config.BitableConfig{
			AppToken:          "test_token",
			PumpTruckTableID:  "pump_table",
			MixerTruckTableID: "mixer_table",
		},
		"test-model",
	)
}

func TestParsePumpTruck_Success_AllOptionsExist(t *testing.T) {
	aiResponse := `{"date":"2026-03-07","truck_model":"33米","customer_name":"XX建设","volume":15.0,"location":"XX工地"}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"pump_table:车型":   {"33米", "37米", "47米"},
		"pump_table:客户名称": {"XX建设", "YY公司"},
	})

	result, err := svc.ParsePumpTruck(context.Background(), ParseInput{Text: "33米 XX建设 15方 XX工地"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Record.TruckModel != "33米" {
		t.Errorf("expected TruckModel=33米, got %s", result.Record.TruckModel)
	}
	if result.Record.CustomerName != "XX建设" {
		t.Errorf("expected CustomerName=XX建设, got %s", result.Record.CustomerName)
	}
	if result.Record.Volume != 15.0 {
		t.Errorf("expected Volume=15.0, got %f", result.Record.Volume)
	}
	if result.Record.Location != "XX工地" {
		t.Errorf("expected Location=XX工地, got %s", result.Record.Location)
	}
	expectedDate, _ := time.Parse("2006-01-02", "2026-03-07")
	if !result.Record.Date.Equal(expectedDate) {
		t.Errorf("expected Date=2026-03-07, got %v", result.Record.Date)
	}
	if result.HasUnknownOptions() {
		t.Errorf("expected no unknown options, got %v", result.UnknownOptions)
	}
	if result.HasMissingFields() {
		t.Errorf("expected no missing fields, got %v", result.MissingFields)
	}
	if !result.IsComplete() {
		t.Error("expected result to be complete")
	}
}

func TestParsePumpTruck_MissingRequiredFields(t *testing.T) {
	// AI 只解析出部分字段，缺失 truck_model、volume
	aiResponse := `{"date":"2026-03-07","truck_model":null,"customer_name":"XX建设","volume":null,"location":"XX工地"}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"pump_table:客户名称": {"XX建设"},
	})

	result, err := svc.ParsePumpTruck(context.Background(), ParseInput{Text: "XX工地 XX建设"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.HasMissingFields() {
		t.Fatal("expected missing fields")
	}

	missingSet := make(map[string]bool)
	for _, f := range result.MissingFields {
		missingSet[f] = true
	}
	for _, expected := range []string{"车型", "方量"} {
		if !missingSet[expected] {
			t.Errorf("expected missing field %q", expected)
		}
	}
	if result.IsComplete() {
		t.Error("expected result to not be complete")
	}
}

func TestParsePumpTruck_WithUnknownOptions(t *testing.T) {
	aiResponse := `{"date":"2026-03-07","truck_model":"56米","customer_name":"新客户","volume":20.0,"location":"新工地"}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"pump_table:车型":   {"33米", "37米", "47米"},
		"pump_table:客户名称": {"XX建设"},
	})

	result, err := svc.ParsePumpTruck(context.Background(), ParseInput{Text: "56米 新客户 新工地"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.HasUnknownOptions() {
		t.Fatal("expected unknown options")
	}

	unknownMap := make(map[string]string)
	for _, u := range result.UnknownOptions {
		unknownMap[u.FieldName] = u.Value
	}
	if unknownMap["车型"] != "56米" {
		t.Errorf("expected unknown 车型=56米, got %v", unknownMap["车型"])
	}
	if unknownMap["客户名称"] != "新客户" {
		t.Errorf("expected unknown 客户名称=新客户, got %v", unknownMap["客户名称"])
	}
}

func TestParsePumpTruck_MarkdownCodeBlock(t *testing.T) {
	aiResponse := "```json\n{\"date\":\"2026-03-07\",\"truck_model\":\"33米\",\"customer_name\":\"XX建设\",\"volume\":10.0,\"location\":\"工地\"}\n```"

	svc := newTestService(aiResponse, nil, map[string][]string{
		"pump_table:车型":   {"33米"},
		"pump_table:客户名称": {"XX建设"},
	})

	result, err := svc.ParsePumpTruck(context.Background(), ParseInput{Text: "测试"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Record.TruckModel != "33米" {
		t.Errorf("expected TruckModel=33米, got %s", result.Record.TruckModel)
	}
}

func TestParsePumpTruck_InvalidJSON(t *testing.T) {
	svc := newTestService("这不是有效的JSON", nil, nil)

	_, err := svc.ParsePumpTruck(context.Background(), ParseInput{Text: "测试"})
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParsePumpTruck_EmptyInput(t *testing.T) {
	svc := newTestService("", nil, nil)

	_, err := svc.ParsePumpTruck(context.Background(), ParseInput{})
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestParseMixerTruck_Success(t *testing.T) {
	aiResponse := `{"date":"2026-03-07","customer_name":"YY公司","volume":31.0,"drivers":["张三","李四"],"remark":"张三：8+7+6，李四：5+5"}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"mixer_table:客户名称": {"YY公司", "XX建设"},
		"mixer_table:驾驶员":  {"张三", "李四", "王五"},
	})

	result, err := svc.ParseMixerTruck(context.Background(), ParseInput{Text: "YY公司 张三8+7+6 李四5+5"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.Record.CustomerName != "YY公司" {
		t.Errorf("expected CustomerName=YY公司, got %s", result.Record.CustomerName)
	}
	if result.Record.Volume != 31.0 {
		t.Errorf("expected Volume=31.0, got %f", result.Record.Volume)
	}
	if len(result.Record.Drivers) != 2 {
		t.Errorf("expected 2 drivers, got %d", len(result.Record.Drivers))
	}
	if result.Record.Remark != "张三：8+7+6，李四：5+5" {
		t.Errorf("expected Remark='张三：8+7+6，李四：5+5', got %s", result.Record.Remark)
	}
	if result.HasUnknownOptions() {
		t.Errorf("expected no unknown options, got %v", result.UnknownOptions)
	}
	if result.HasMissingFields() {
		t.Errorf("expected no missing fields, got %v", result.MissingFields)
	}
	if !result.IsComplete() {
		t.Error("expected result to be complete")
	}
}

func TestParseMixerTruck_MissingRequiredFields(t *testing.T) {
	aiResponse := `{"date":"2026-03-07","customer_name":"YY公司","volume":null,"drivers":[],"remark":null}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"mixer_table:客户名称": {"YY公司"},
	})

	result, err := svc.ParseMixerTruck(context.Background(), ParseInput{Text: "YY公司"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.HasMissingFields() {
		t.Fatal("expected missing fields")
	}

	missingSet := make(map[string]bool)
	for _, f := range result.MissingFields {
		missingSet[f] = true
	}
	for _, expected := range []string{"方量", "驾驶员"} {
		if !missingSet[expected] {
			t.Errorf("expected missing field %q", expected)
		}
	}
	if result.IsComplete() {
		t.Error("expected result to not be complete")
	}
}

func TestParseMixerTruck_UnknownDrivers(t *testing.T) {
	aiResponse := `{"date":"2026-03-07","customer_name":"YY公司","volume":13.0,"drivers":["张三","新司机"],"remark":"张三：8，新司机：5"}`

	svc := newTestService(aiResponse, nil, map[string][]string{
		"mixer_table:客户名称": {"YY公司"},
		"mixer_table:驾驶员":  {"张三", "李四"},
	})

	result, err := svc.ParseMixerTruck(context.Background(), ParseInput{Text: "测试"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !result.HasUnknownOptions() {
		t.Fatal("expected unknown options")
	}

	found := false
	for _, u := range result.UnknownOptions {
		if u.FieldName == "驾驶员" && u.Value == "新司机" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected unknown 驾驶员=新司机, got %v", result.UnknownOptions)
	}
}

func TestParseMixerTruck_EmptyInput(t *testing.T) {
	svc := newTestService("", nil, nil)

	_, err := svc.ParseMixerTruck(context.Background(), ParseInput{})
	if err == nil {
		t.Fatal("expected error for empty input")
	}
}

func TestExtractJSON(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "plain JSON",
			input:    `{"key":"value"}`,
			expected: `{"key":"value"}`,
		},
		{
			name:     "markdown json code block",
			input:    "```json\n{\"key\":\"value\"}\n```",
			expected: `{"key":"value"}`,
		},
		{
			name:     "markdown code block without lang",
			input:    "```\n{\"key\":\"value\"}\n```",
			expected: `{"key":"value"}`,
		},
		{
			name:     "with whitespace",
			input:    "  \n```json\n  {\"key\":\"value\"}  \n```\n  ",
			expected: `{"key":"value"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractJSON(tt.input)
			if result != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, result)
			}
		})
	}
}

func TestParseDateString(t *testing.T) {
	t.Run("valid date", func(t *testing.T) {
		result, err := parseDateString("2026-03-07")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result.Year() != 2026 || result.Month() != 3 || result.Day() != 7 {
			t.Errorf("unexpected date: %v", result)
		}
	})

	t.Run("invalid date", func(t *testing.T) {
		_, err := parseDateString("not-a-date")
		if err == nil {
			t.Fatal("expected error for invalid date")
		}
	})
}
