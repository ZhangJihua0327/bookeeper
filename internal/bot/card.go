package bot

import (
	"encoding/json"
	"fmt"
	"strings"

	larkcard "github.com/larksuite/oapi-sdk-go/v3/card"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

// cardActionData 卡片按钮回调携带的数据
type cardActionData struct {
	Action             string `json:"action"`               // "confirm" 或 "cancel"
	Type               string `json:"type"`                 // "pump_truck" 或 "mixer_truck"
	RecordJSON         string `json:"record_json"`          // 序列化的记录
	UnknownOptionsJSON string `json:"unknown_options_json"` // 序列化的未知选项
}

// buildPumpTruckConfirmCard 构建泵车确认卡片
func buildPumpTruckConfirmCard(record *domain.PumpTruckRecord, unknownOpts []service.UnknownOption) (string, error) {
	// 序列化数据供回调使用
	recordBytes, err := json.Marshal(record)
	if err != nil {
		return "", fmt.Errorf("序列化记录失败: %w", err)
	}
	unknownBytes, err := json.Marshal(unknownOpts)
	if err != nil {
		return "", fmt.Errorf("序列化未知选项失败: %w", err)
	}

	// 构建记录详情
	var lines []string
	if !record.Date.IsZero() {
		lines = append(lines, fmt.Sprintf("**日期：** %s", record.Date.Format("2006-01-02")))
	}
	if record.TruckModel != "" {
		lines = append(lines, fmt.Sprintf("**车型：** %s", record.TruckModel))
	}
	if record.CustomerName != "" {
		lines = append(lines, fmt.Sprintf("**客户名称：** %s", record.CustomerName))
	}
	if record.Volume != 0 {
		lines = append(lines, fmt.Sprintf("**方量：** %.1f", record.Volume))
	}
	if record.Location != "" {
		lines = append(lines, fmt.Sprintf("**施工地点：** %s", record.Location))
	}

	// 未知选项警告
	if len(unknownOpts) > 0 {
		lines = append(lines, "")
		lines = append(lines, "⚠️ **以下选项不存在，确认后将自动添加：**")
		for _, opt := range unknownOpts {
			lines = append(lines, fmt.Sprintf("- %s: **%s**", opt.FieldName, opt.Value))
		}
	}

	bodyText := strings.Join(lines, "\n")

	// 确认按钮数据
	confirmData := cardActionData{
		Action:             "confirm",
		Type:               string(recordTypePumpTruck),
		RecordJSON:         string(recordBytes),
		UnknownOptionsJSON: string(unknownBytes),
	}
	confirmValue := structToMap(confirmData)

	// 取消按钮数据
	cancelValue := map[string]interface{}{
		"action": "cancel",
	}

	// 确定按钮文字
	confirmText := "确认提交"
	if len(unknownOpts) > 0 {
		confirmText = "确认并添加新选项"
	}

	card := larkcard.NewMessageCard().
		Header(larkcard.NewMessageCardHeader().
			Template(larkcard.TemplateBlue).
			Title(larkcard.NewMessageCardPlainText().Content("泵车记录确认"))).
		Elements([]larkcard.MessageCardElement{
			larkcard.NewMessageCardMarkdown().Content(bodyText),
			larkcard.NewMessageCardAction().Actions([]larkcard.MessageCardActionElement{
				larkcard.NewMessageCardEmbedButton().
					Type(larkcard.MessageCardButtonTypePrimary).
					Text(larkcard.NewMessageCardPlainText().Content(confirmText)).
					Value(confirmValue),
				larkcard.NewMessageCardEmbedButton().
					Type(larkcard.MessageCardButtonTypeDanger).
					Text(larkcard.NewMessageCardPlainText().Content("取消")).
					Value(cancelValue),
			}),
		}).
		Build()

	return card.String()
}

// buildMixerTruckConfirmCard 构建搅拌车确认卡片
func buildMixerTruckConfirmCard(record *domain.MixerTruckRecord, unknownOpts []service.UnknownOption) (string, error) {
	recordBytes, err := json.Marshal(record)
	if err != nil {
		return "", fmt.Errorf("序列化记录失败: %w", err)
	}
	unknownBytes, err := json.Marshal(unknownOpts)
	if err != nil {
		return "", fmt.Errorf("序列化未知选项失败: %w", err)
	}

	var lines []string
	if !record.Date.IsZero() {
		lines = append(lines, fmt.Sprintf("**日期：** %s", record.Date.Format("2006-01-02")))
	}
	if record.CustomerName != "" {
		lines = append(lines, fmt.Sprintf("**客户名称：** %s", record.CustomerName))
	}
	if record.Volume != 0 {
		lines = append(lines, fmt.Sprintf("**方量：** %.1f", record.Volume))
	}
	if len(record.Drivers) > 0 {
		lines = append(lines, fmt.Sprintf("**驾驶员：** %s", strings.Join(record.Drivers, "、")))
	}
	if record.Remark != "" {
		lines = append(lines, fmt.Sprintf("**备注：** %s", record.Remark))
	}

	if len(unknownOpts) > 0 {
		lines = append(lines, "")
		lines = append(lines, "⚠️ **以下选项不存在，确认后将自动添加：**")
		for _, opt := range unknownOpts {
			lines = append(lines, fmt.Sprintf("- %s: **%s**", opt.FieldName, opt.Value))
		}
	}

	bodyText := strings.Join(lines, "\n")

	confirmData := cardActionData{
		Action:             "confirm",
		Type:               string(recordTypeMixerTruck),
		RecordJSON:         string(recordBytes),
		UnknownOptionsJSON: string(unknownBytes),
	}
	confirmValue := structToMap(confirmData)

	cancelValue := map[string]interface{}{
		"action": "cancel",
	}

	confirmText := "确认提交"
	if len(unknownOpts) > 0 {
		confirmText = "确认并添加新选项"
	}

	card := larkcard.NewMessageCard().
		Header(larkcard.NewMessageCardHeader().
			Template(larkcard.TemplateBlue).
			Title(larkcard.NewMessageCardPlainText().Content("搅拌车记录确认"))).
		Elements([]larkcard.MessageCardElement{
			larkcard.NewMessageCardMarkdown().Content(bodyText),
			larkcard.NewMessageCardAction().Actions([]larkcard.MessageCardActionElement{
				larkcard.NewMessageCardEmbedButton().
					Type(larkcard.MessageCardButtonTypePrimary).
					Text(larkcard.NewMessageCardPlainText().Content(confirmText)).
					Value(confirmValue),
				larkcard.NewMessageCardEmbedButton().
					Type(larkcard.MessageCardButtonTypeDanger).
					Text(larkcard.NewMessageCardPlainText().Content("取消")).
					Value(cancelValue),
			}),
		}).
		Build()

	return card.String()
}

// buildResultCard 构建操作结果卡片（用于更新原卡片）
func buildResultCard(title, content string, success bool) (string, error) {
	template := larkcard.TemplateGreen
	if !success {
		template = larkcard.TemplateRed
	}

	card := larkcard.NewMessageCard().
		Header(larkcard.NewMessageCardHeader().
			Template(template).
			Title(larkcard.NewMessageCardPlainText().Content(title))).
		Elements([]larkcard.MessageCardElement{
			larkcard.NewMessageCardMarkdown().Content(content),
		}).
		Build()

	return card.String()
}

// structToMap 将结构体转为 map[string]interface{}
func structToMap(v interface{}) map[string]interface{} {
	data, _ := json.Marshal(v)
	var m map[string]interface{}
	json.Unmarshal(data, &m)
	return m
}

// buildCardActionResponse 构建卡片回调响应（用于 OnP2CardActionTrigger）
func buildCardActionResponse(title, content string, success bool) (*callback.CardActionTriggerResponse, error) {
	cardJSON, err := buildResultCard(title, content, success)
	if err != nil {
		return nil, err
	}

	var cardData interface{}
	if err := json.Unmarshal([]byte(cardJSON), &cardData); err != nil {
		return nil, fmt.Errorf("反序列化卡片JSON失败: %w", err)
	}

	return &callback.CardActionTriggerResponse{
		Card: &callback.Card{
			Type: "raw",
			Data: cardData,
		},
	}, nil
}
