package errors

import "fmt"

// ErrNotFound 记录不存在
type ErrNotFound struct {
	RecordID string
}

func (e *ErrNotFound) Error() string {
	return fmt.Sprintf("记录不存在: %s", e.RecordID)
}

// ErrInvalidField 字段转换失败
type ErrInvalidField struct {
	FieldName string
	Reason    string
}

func (e *ErrInvalidField) Error() string {
	return fmt.Sprintf("字段 %q 转换失败: %s", e.FieldName, e.Reason)
}

// ErrAPIFailure 飞书 API 调用失败
type ErrAPIFailure struct {
	Code  int
	Msg   string
	LogID string
}

func (e *ErrAPIFailure) Error() string {
	return fmt.Sprintf("飞书 API 调用失败: code=%d, msg=%s, log_id=%s", e.Code, e.Msg, e.LogID)
}

// NewAPIError 从飞书 API 响应创建错误
func NewAPIError(code int, msg string, logID string) *ErrAPIFailure {
	return &ErrAPIFailure{
		Code:  code,
		Msg:   msg,
		LogID: logID,
	}
}

// ErrConfigMissing 配置缺失
type ErrConfigMissing struct {
	Name string
}

func (e *ErrConfigMissing) Error() string {
	return fmt.Sprintf("缺少必要的配置: %s", e.Name)
}
