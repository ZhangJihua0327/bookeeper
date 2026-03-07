package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher/callback"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

// CardCallbackHandler 卡片按钮回调处理器
type CardCallbackHandler struct {
	session *SessionManager
}

// NewCardCallbackHandler 创建卡片回调处理器
func NewCardCallbackHandler(session *SessionManager) *CardCallbackHandler {
	return &CardCallbackHandler{session: session}
}

// Handle 处理卡片按钮点击回调（适配 OnP2CardActionTrigger 签名）
func (h *CardCallbackHandler) Handle(ctx context.Context, event *callback.CardActionTriggerEvent) (*callback.CardActionTriggerResponse, error) {
	if event.Event == nil || event.Event.Action == nil || event.Event.Action.Value == nil {
		log.Printf("[CardHandler] 收到无效卡片回调（event/action/value为空）")
		return nil, nil
	}

	value := event.Event.Action.Value
	actionStr, _ := value["action"].(string)
	log.Printf("[CardHandler] 收到卡片回调 action=%s", actionStr)

	switch actionStr {
	case "confirm":
		return h.handleConfirm(ctx, value)
	case "cancel":
		log.Printf("[CardHandler] 用户取消操作")
		return h.handleCancel()
	default:
		log.Printf("[CardHandler] 未知的卡片 action: %s", actionStr)
		return nil, nil
	}
}

// handleConfirm 处理确认操作
func (h *CardCallbackHandler) handleConfirm(ctx context.Context, value map[string]interface{}) (*callback.CardActionTriggerResponse, error) {
	typeStr, _ := value["type"].(string)
	recordJSON, _ := value["record_json"].(string)
	unknownOptsJSON, _ := value["unknown_options_json"].(string)

	log.Printf("[CardHandler] 确认提交 type=%s recordLen=%d unknownOptsLen=%d", typeStr, len(recordJSON), len(unknownOptsJSON))

	var unknownOpts []service.UnknownOption
	if unknownOptsJSON != "" {
		if err := json.Unmarshal([]byte(unknownOptsJSON), &unknownOpts); err != nil {
			log.Printf("[CardHandler] 反序列化未知选项失败: err=%v", err)
		}
	}

	switch typeStr {
	case string(recordTypePumpTruck):
		return h.confirmPumpTruck(ctx, recordJSON, unknownOpts)
	case string(recordTypeMixerTruck):
		return h.confirmMixerTruck(ctx, recordJSON, unknownOpts)
	default:
		return buildCardActionResponse("错误", "未知的记录类型", false)
	}
}

// confirmPumpTruck 确认泵车记录
func (h *CardCallbackHandler) confirmPumpTruck(ctx context.Context, recordJSON string, unknownOpts []service.UnknownOption) (*callback.CardActionTriggerResponse, error) {
	var record domain.PumpTruckRecord
	if err := json.Unmarshal([]byte(recordJSON), &record); err != nil {
		log.Printf("[CardHandler] 反序列化泵车记录失败: err=%v", err)
		return buildCardActionResponse("提交失败", fmt.Sprintf("数据解析错误: %v", err), false)
	}

	log.Printf("[CardHandler] 提交泵车记录 customer=%s driver=%s volume=%.1f", record.CustomerName, record.Driver, record.Volume)
	written, err := h.session.ConfirmPumpTruck(ctx, &record, unknownOpts)
	if err != nil {
		log.Printf("[CardHandler] 提交泵车记录失败: err=%v", err)
		return buildCardActionResponse("提交失败", fmt.Sprintf("写入多维表格失败: %v", err), false)
	}

	log.Printf("[CardHandler] 泵车记录提交成功 recordId=%s", written.RecordID)
	content := formatPumpTruckWrittenData(written)
	return buildCardActionResponse("提交成功", content, true)
}

// confirmMixerTruck 确认搅拌车记录
func (h *CardCallbackHandler) confirmMixerTruck(ctx context.Context, recordJSON string, unknownOpts []service.UnknownOption) (*callback.CardActionTriggerResponse, error) {
	var record domain.MixerTruckRecord
	if err := json.Unmarshal([]byte(recordJSON), &record); err != nil {
		log.Printf("[CardHandler] 反序列化搅拌车记录失败: err=%v", err)
		return buildCardActionResponse("提交失败", fmt.Sprintf("数据解析错误: %v", err), false)
	}

	log.Printf("[CardHandler] 提交搅拌车记录 customer=%s drivers=%v volume=%.1f", record.CustomerName, record.Drivers, record.Volume)
	written, err := h.session.ConfirmMixerTruck(ctx, &record, unknownOpts)
	if err != nil {
		log.Printf("[CardHandler] 提交搅拌车记录失败: err=%v", err)
		return buildCardActionResponse("提交失败", fmt.Sprintf("写入多维表格失败: %v", err), false)
	}

	log.Printf("[CardHandler] 搅拌车记录提交成功 recordId=%s", written.RecordID)
	content := formatMixerTruckWrittenData(written)
	return buildCardActionResponse("提交成功", content, true)
}

// formatPumpTruckWrittenData 格式化泵车回读数据为 Markdown
func formatPumpTruckWrittenData(record *domain.PumpTruckRecord) string {
	var lines []string
	lines = append(lines, "泵车记录已成功写入多维表格\n")
	lines = append(lines, fmt.Sprintf("**记录 ID：** %s", record.RecordID))
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
	if record.Driver != "" {
		lines = append(lines, fmt.Sprintf("**驾驶员：** %s", record.Driver))
	}
	if record.Remark != "" {
		lines = append(lines, fmt.Sprintf("**备注：** %s", record.Remark))
	}
	return strings.Join(lines, "\n")
}

// formatMixerTruckWrittenData 格式化搅拌车回读数据为 Markdown
func formatMixerTruckWrittenData(record *domain.MixerTruckRecord) string {
	var lines []string
	lines = append(lines, "搅拌车记录已成功写入多维表格\n")
	lines = append(lines, fmt.Sprintf("**记录 ID：** %s", record.RecordID))
	if !record.Date.IsZero() {
		lines = append(lines, fmt.Sprintf("**日期：** %s", record.Date.Format("2006-01-02")))
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
	if len(record.Drivers) > 0 {
		lines = append(lines, fmt.Sprintf("**驾驶员：** %s", strings.Join(record.Drivers, "、")))
	}
	if record.Remark != "" {
		lines = append(lines, fmt.Sprintf("**备注：** %s", record.Remark))
	}
	return strings.Join(lines, "\n")
}

// handleCancel 处理取消操作
func (h *CardCallbackHandler) handleCancel() (*callback.CardActionTriggerResponse, error) {
	return buildCardActionResponse("已取消", "本次记录已取消", false)
}
