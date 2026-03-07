package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/ai"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	biterrors "github.com/zhangjihua0327/bookeeper/internal/errors"
	"github.com/zhangjihua0327/bookeeper/internal/repository"
)

const classifySystemPrompt = `你是施工记录类型分类助手。请判断用户输入的内容属于哪种施工记录类型。

类型说明：
- pump_truck: 泵车记账。关键词包括泵车、臂架、泵送等
- mixer_truck: 搅拌车记账。关键词包括搅拌车、搅拌、混凝土运输等

只返回 JSON，不要返回任何其他内容。格式如下：
{"type": "pump_truck"} 或 {"type": "mixer_truck"}

如果无法判断，返回 {"type": "unknown"}`

const pumpTruckSystemPrompt = `你是泵车施工记录的数据提取助手。请从用户提供的文字或图片中提取以下字段，严格只返回 JSON，不要返回任何其他内容。

字段说明（除备注外全部必填）：
- date: 【必填】日期，格式 "YYYY-MM-DD"
- truck_model: 【必填】车型，如 "红泵车" "蓝泵车"等
- customer_name: 【必填】客户名称
- volume: 【必填】方量，数字类型（单位：立方米）
- location: 【必填】施工地点
- driver: 【必填】驾驶员姓名
- remark: 【选填】备注信息

如果某必填字段无法从输入中提取，仍设为 null，但请尽量从上下文中推断。选填字段无内容时设为 null。

输出示例：
{"date":"2026-03-07","truck_model":"红泵车","customer_name":"XX建设","volume":15.0,"location":"XX工地","driver":"李四","remark":null}`

const mixerTruckSystemPrompt = `你是搅拌车施工记录的数据提取助手。请从用户提供的文字或图片中提取以下字段，严格只返回 JSON，不要返回任何其他内容。

字段说明（除备注外全部必填）：
- date: 【必填】日期，格式 "YYYY-MM-DD"
- customer_name: 【必填】客户名称
- volume: 【必填】方量，数字类型（单位：立方米）
- location: 【必填】施工地点
- drivers: 【必填】驾驶员姓名列表，数组类型
- remark: 【选填】备注信息

如果某必填字段无法从输入中提取，仍设为 null（drivers 设为空数组 []），但请尽量从上下文中推断。选填字段无内容时设为 null。

输出示例：
{"date":"2026-03-07","customer_name":"XX建设","volume":50.0,"location":"XX工地","drivers":["张三","李四"],"remark":null}`

// ParsingService 数据解析服务
type ParsingService struct {
	aiClient       ai.AIClient
	fieldOptionMgr repository.FieldOptionManager
	bitableCfg     config.BitableConfig
	model          string
}

// NewParsingService 创建解析服务
func NewParsingService(aiClient ai.AIClient, fieldOptionMgr repository.FieldOptionManager, bitableCfg config.BitableConfig, model string) *ParsingService {
	return &ParsingService{
		aiClient:       aiClient,
		fieldOptionMgr: fieldOptionMgr,
		bitableCfg:     bitableCfg,
		model:          model,
	}
}

// fetchFieldOptionsHint 获取指定表的字段选项并格式化为提示词片段
func (s *ParsingService) fetchFieldOptionsHint(ctx context.Context, tableID string, fields []string) string {
	var parts []string
	for _, fieldName := range fields {
		options, err := s.fieldOptionMgr.GetFieldOptions(ctx, tableID, fieldName)
		if err != nil {
			log.Printf("[Parsing] 获取字段 %q 选项失败，跳过: %v", fieldName, err)
			continue
		}
		if len(options) > 0 {
			parts = append(parts, fmt.Sprintf("- %s的可选值: %s", fieldName, strings.Join(options, "、")))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "\n\n以下是系统中已有的选项值，请优先匹配这些选项（允许模糊匹配，如用户输入的简称或别名应匹配到最接近的选项）：\n" + strings.Join(parts, "\n")
}

// ParsePumpTruck 解析用户输入为泵车记录
func (s *ParsingService) ParsePumpTruck(ctx context.Context, input ParseInput) (*PumpTruckParseResult, error) {
	log.Printf("[Parsing] 开始解析泵车记录 text=%q hasImage=%v model=%s", input.Text, input.ImageURL != "", s.model)
	if input.Text == "" && input.ImageURL == "" {
		return nil, fmt.Errorf("输入不能为空：文本和图片至少提供一个")
	}

	// 拉取泵车表字段选项，增强提示词
	optionsHint := s.fetchFieldOptionsHint(ctx, s.bitableCfg.PumpTruckTableID, []string{"车型", "客户名称", "驾驶员"})
	enhancedPrompt := pumpTruckSystemPrompt + optionsHint

	messages := buildMessages(enhancedPrompt, input)
	log.Printf("[Parsing] 调用AI模型解析泵车记录 messageCount=%d", len(messages))

	content, err := s.aiClient.ChatCompletion(ctx, ai.ChatRequest{
		Model:    s.model,
		Messages: messages,
	})
	if err != nil {
		log.Printf("[Parsing] AI模型调用失败(泵车): err=%v", err)
		return nil, fmt.Errorf("调用 AI 模型失败: %w", err)
	}

	log.Printf("[Parsing] AI模型响应(泵车): content=%q", content)
	jsonStr := extractJSON(content)

	var parsed pumpTruckJSON
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, &biterrors.ErrAIParsingFailure{
			Reason:      fmt.Sprintf("JSON 反序列化失败: %v", err),
			RawResponse: content,
		}
	}

	record, err := convertPumpTruckJSON(&parsed)
	if err != nil {
		return nil, &biterrors.ErrAIParsingFailure{
			Reason:      err.Error(),
			RawResponse: content,
		}
	}

	log.Printf("[Parsing] 泵车记录解析成功: date=%v model=%s customer=%s volume=%.1f location=%s driver=%s",
		record.Date.Format("2006-01-02"), record.TruckModel, record.CustomerName, record.Volume, record.Location, record.Driver)

	unknownOpts := s.validatePumpTruckOptions(ctx, record)
	missingFields := validatePumpTruckRequired(record)

	log.Printf("[Parsing] 泵车校验完成: missingFields=%v unknownOptions=%d", missingFields, len(unknownOpts))

	return &PumpTruckParseResult{
		Record:         record,
		MissingFields:  missingFields,
		UnknownOptions: unknownOpts,
	}, nil
}

// ParseMixerTruck 解析用户输入为搅拌车记录
func (s *ParsingService) ParseMixerTruck(ctx context.Context, input ParseInput) (*MixerTruckParseResult, error) {
	log.Printf("[Parsing] 开始解析搅拌车记录 text=%q hasImage=%v model=%s", input.Text, input.ImageURL != "", s.model)
	if input.Text == "" && input.ImageURL == "" {
		return nil, fmt.Errorf("输入不能为空：文本和图片至少提供一个")
	}

	// 拉取搅拌车表字段选项，增强提示词
	optionsHint := s.fetchFieldOptionsHint(ctx, s.bitableCfg.MixerTruckTableID, []string{"客户名称", "驾驶员"})
	enhancedPrompt := mixerTruckSystemPrompt + optionsHint

	messages := buildMessages(enhancedPrompt, input)
	log.Printf("[Parsing] 调用AI模型解析搅拌车记录 messageCount=%d", len(messages))

	content, err := s.aiClient.ChatCompletion(ctx, ai.ChatRequest{
		Model:    s.model,
		Messages: messages,
	})
	if err != nil {
		log.Printf("[Parsing] AI模型调用失败(搅拌车): err=%v", err)
		return nil, fmt.Errorf("调用 AI 模型失败: %w", err)
	}

	log.Printf("[Parsing] AI模型响应(搅拌车): content=%q", content)
	jsonStr := extractJSON(content)

	var parsed mixerTruckJSON
	if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
		return nil, &biterrors.ErrAIParsingFailure{
			Reason:      fmt.Sprintf("JSON 反序列化失败: %v", err),
			RawResponse: content,
		}
	}

	record, err := convertMixerTruckJSON(&parsed)
	if err != nil {
		return nil, &biterrors.ErrAIParsingFailure{
			Reason:      err.Error(),
			RawResponse: content,
		}
	}

	log.Printf("[Parsing] 搅拌车记录解析成功: date=%v customer=%s volume=%.1f location=%s drivers=%v",
		record.Date.Format("2006-01-02"), record.CustomerName, record.Volume, record.Location, record.Drivers)

	unknownOpts := s.validateMixerTruckOptions(ctx, record)
	missingFields := validateMixerTruckRequired(record)

	log.Printf("[Parsing] 搅拌车校验完成: missingFields=%v unknownOptions=%d", missingFields, len(unknownOpts))

	return &MixerTruckParseResult{
		Record:         record,
		MissingFields:  missingFields,
		UnknownOptions: unknownOpts,
	}, nil
}

// buildMessages 根据输入构建消息列表
func buildMessages(systemPrompt string, input ParseInput) []ai.Message {
	messages := []ai.Message{
		{Role: "system", TextContent: systemPrompt},
	}

	today := time.Now().Format("2006-01-02")
	datePrefix := fmt.Sprintf("今天是 %s。\n", today)

	if input.ImageURL != "" {
		// 多模态消息：文本 + 图片
		parts := []ai.ContentPart{
			{Type: "image_url", ImageURL: &ai.ImageURL{URL: input.ImageURL}},
		}
		textPart := datePrefix
		if input.Text != "" {
			textPart += "用户描述：" + input.Text + "\n"
		}
		textPart += "请从以上图片中提取记录信息。"
		parts = append([]ai.ContentPart{{Type: "text", Text: textPart}}, parts...)
		messages = append(messages, ai.Message{
			Role:         "user",
			MultiContent: parts,
		})
	} else {
		// 纯文本消息
		messages = append(messages, ai.Message{
			Role:        "user",
			TextContent: datePrefix + "用户输入：" + input.Text,
		})
	}

	return messages
}

// extractJSON 从模型响应中提取纯 JSON，去除 markdown code block 包裹
func extractJSON(raw string) string {
	raw = strings.TrimSpace(raw)

	// 匹配 ```json ... ``` 或 ``` ... ```
	re := regexp.MustCompile("(?s)```(?:json)?\\s*\n?(.*?)\n?\\s*```")
	matches := re.FindStringSubmatch(raw)
	if len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}

	return raw
}

// convertPumpTruckJSON 将 AI JSON 中间结构体转换为领域模型
func convertPumpTruckJSON(parsed *pumpTruckJSON) (*domain.PumpTruckRecord, error) {
	record := &domain.PumpTruckRecord{}

	if parsed.Date != nil && *parsed.Date != "" {
		t, err := parseDateString(*parsed.Date)
		if err != nil {
			return nil, fmt.Errorf("日期解析失败: %w", err)
		}
		record.Date = t
	}
	if parsed.TruckModel != nil {
		record.TruckModel = *parsed.TruckModel
	}
	if parsed.CustomerName != nil {
		record.CustomerName = *parsed.CustomerName
	}
	if parsed.Volume != nil {
		record.Volume = *parsed.Volume
	}
	if parsed.Location != nil {
		record.Location = *parsed.Location
	}
	if parsed.Remark != nil {
		record.Remark = *parsed.Remark
	}
	if parsed.Driver != nil {
		record.Driver = *parsed.Driver
	}

	return record, nil
}

// convertMixerTruckJSON 将 AI JSON 中间结构体转换为领域模型
func convertMixerTruckJSON(parsed *mixerTruckJSON) (*domain.MixerTruckRecord, error) {
	record := &domain.MixerTruckRecord{}

	if parsed.Date != nil && *parsed.Date != "" {
		t, err := parseDateString(*parsed.Date)
		if err != nil {
			return nil, fmt.Errorf("日期解析失败: %w", err)
		}
		record.Date = t
	}
	if parsed.CustomerName != nil {
		record.CustomerName = *parsed.CustomerName
	}
	if parsed.Volume != nil {
		record.Volume = *parsed.Volume
	}
	if parsed.Location != nil {
		record.Location = *parsed.Location
	}
	if parsed.Remark != nil {
		record.Remark = *parsed.Remark
	}
	if len(parsed.Drivers) > 0 {
		record.Drivers = parsed.Drivers
	}

	return record, nil
}

// parseDateString 解析 YYYY-MM-DD 格式的日期字符串
func parseDateString(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}

// validatePumpTruckOptions 校验泵车记录的单选字段值是否在选项列表中
func (s *ParsingService) validatePumpTruckOptions(ctx context.Context, record *domain.PumpTruckRecord) []UnknownOption {
	var unknowns []UnknownOption
	tableID := s.bitableCfg.PumpTruckTableID

	// 校验车型
	if record.TruckModel != "" {
		if unknown := s.checkOption(ctx, tableID, "车型", record.TruckModel); unknown != nil {
			unknowns = append(unknowns, *unknown)
		}
	}

	// 校验客户名称
	if record.CustomerName != "" {
		if unknown := s.checkOption(ctx, tableID, "客户名称", record.CustomerName); unknown != nil {
			unknowns = append(unknowns, *unknown)
		}
	}

	// 校验驾驶员
	if record.Driver != "" {
		if unknown := s.checkOption(ctx, tableID, "驾驶员", record.Driver); unknown != nil {
			unknowns = append(unknowns, *unknown)
		}
	}

	return unknowns
}

// validateMixerTruckOptions 校验搅拌车记录的单选/多选字段值是否在选项列表中
func (s *ParsingService) validateMixerTruckOptions(ctx context.Context, record *domain.MixerTruckRecord) []UnknownOption {
	var unknowns []UnknownOption
	tableID := s.bitableCfg.MixerTruckTableID

	// 校验客户名称
	if record.CustomerName != "" {
		if unknown := s.checkOption(ctx, tableID, "客户名称", record.CustomerName); unknown != nil {
			unknowns = append(unknowns, *unknown)
		}
	}

	// 校验驾驶员（多选，逐个校验）
	for _, driver := range record.Drivers {
		if unknown := s.checkOption(ctx, tableID, "驾驶员", driver); unknown != nil {
			unknowns = append(unknowns, *unknown)
		}
	}

	return unknowns
}

// validatePumpTruckRequired 校验泵车记录的必填字段
func validatePumpTruckRequired(record *domain.PumpTruckRecord) []string {
	var missing []string
	if record.Date.IsZero() {
		missing = append(missing, "日期")
	}
	if record.TruckModel == "" {
		missing = append(missing, "车型")
	}
	if record.CustomerName == "" {
		missing = append(missing, "客户名称")
	}
	if record.Volume == 0 {
		missing = append(missing, "方量")
	}
	if record.Location == "" {
		missing = append(missing, "施工地点")
	}
	if record.Driver == "" {
		missing = append(missing, "驾驶员")
	}
	return missing
}

// validateMixerTruckRequired 校验搅拌车记录的必填字段
func validateMixerTruckRequired(record *domain.MixerTruckRecord) []string {
	var missing []string
	if record.Date.IsZero() {
		missing = append(missing, "日期")
	}
	if record.CustomerName == "" {
		missing = append(missing, "客户名称")
	}
	if record.Volume == 0 {
		missing = append(missing, "方量")
	}
	if record.Location == "" {
		missing = append(missing, "施工地点")
	}
	if len(record.Drivers) == 0 {
		missing = append(missing, "驾驶员")
	}
	return missing
}

// checkOption 检查单个字段值是否在选项列表中
// 如果 GetFieldOptions 出错，跳过校验（记录日志），不阻断流程
func (s *ParsingService) checkOption(ctx context.Context, tableID, fieldName, value string) *UnknownOption {
	log.Printf("[Parsing] 校验字段选项 table=%s field=%s value=%s", tableID, fieldName, value)
	options, err := s.fieldOptionMgr.GetFieldOptions(ctx, tableID, fieldName)
	if err != nil {
		log.Printf("[Parsing] 警告: 获取字段 %q 选项列表失败，跳过校验: %v", fieldName, err)
		return nil
	}

	for _, opt := range options {
		if opt == value {
			log.Printf("[Parsing] 字段选项匹配成功 field=%s value=%s", fieldName, value)
			return nil
		}
	}

	log.Printf("[Parsing] 发现未知选项 field=%s value=%s", fieldName, value)
	return &UnknownOption{
		FieldName: fieldName,
		Value:     value,
	}
}

// classifyJSON AI 分类响应的 JSON 结构
type classifyJSON struct {
	Type string `json:"type"`
}

// ClassifyRecordType 使用 AI 判断用户输入属于泵车记录还是搅拌车记录
// 返回值: "pump_truck"、"mixer_truck" 或 "unknown"
func (s *ParsingService) ClassifyRecordType(ctx context.Context, input ParseInput) (string, error) {
	log.Printf("[Parsing] 开始分类记录类型 text=%q hasImage=%v", input.Text, input.ImageURL != "")
	if input.Text == "" && input.ImageURL == "" {
		return "unknown", nil
	}

	messages := buildMessages(classifySystemPrompt, input)

	content, err := s.aiClient.ChatCompletion(ctx, ai.ChatRequest{
		Model:    s.model,
		Messages: messages,
	})
	if err != nil {
		log.Printf("[Parsing] AI分类调用失败: err=%v", err)
		return "", fmt.Errorf("调用 AI 模型分类失败: %w", err)
	}

	log.Printf("[Parsing] AI分类响应: content=%q", content)
	jsonStr := extractJSON(content)

	var result classifyJSON
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("[Parsing] 分类结果JSON解析失败: err=%v raw=%q", err, content)
		return "unknown", nil
	}

	log.Printf("[Parsing] 分类结果: type=%s", result.Type)
	return result.Type, nil
}
