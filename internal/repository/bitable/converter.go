package bitable

import (
	"fmt"
	"time"

	"github.com/zhangjihua0327/bookeeper/internal/domain"
)

// Bitable 字段名常量
const (
	FieldDate         = "日期"
	FieldTruckModel   = "车型"
	FieldCustomerName = "客户名称"
	FieldVolume       = "方量"
	FieldLocation     = "施工地点"
	FieldRemark       = "备注"
	FieldDriver       = "驾驶员"
)

// PumpTruckToFieldMap 将泵车领域模型转换为 Bitable 字段 map
func PumpTruckToFieldMap(record *domain.PumpTruckRecord) map[string]interface{} {
	fields := make(map[string]interface{})

	if !record.Date.IsZero() {
		fields[FieldDate] = record.Date.UnixMilli()
	}
	if record.TruckModel != "" {
		fields[FieldTruckModel] = record.TruckModel
	}
	if record.CustomerName != "" {
		fields[FieldCustomerName] = record.CustomerName
	}
	if record.Volume != 0 {
		fields[FieldVolume] = record.Volume
	}
	if record.Location != "" {
		fields[FieldLocation] = record.Location
	}

	return fields
}

// MixerTruckToFieldMap 将搅拌车领域模型转换为 Bitable 字段 map
func MixerTruckToFieldMap(record *domain.MixerTruckRecord) map[string]interface{} {
	fields := make(map[string]interface{})

	if !record.Date.IsZero() {
		fields[FieldDate] = record.Date.UnixMilli()
	}
	if record.CustomerName != "" {
		fields[FieldCustomerName] = record.CustomerName
	}
	if record.Volume != 0 {
		fields[FieldVolume] = record.Volume
	}
	if record.Remark != "" {
		fields[FieldRemark] = record.Remark
	}
	if len(record.Drivers) > 0 {
		fields[FieldDriver] = record.Drivers
	}

	return fields
}

// FieldMapToPumpTruck 将 Bitable 字段 map 转换为泵车领域模型
func FieldMapToPumpTruck(fields map[string]interface{}, recordID string) *domain.PumpTruckRecord {
	record := &domain.PumpTruckRecord{RecordID: recordID}

	if v, ok := fields[FieldDate]; ok {
		record.Date = parseTimestampField(v)
	}
	if v, ok := fields[FieldTruckModel]; ok {
		record.TruckModel = parseStringField(v)
	}
	if v, ok := fields[FieldCustomerName]; ok {
		record.CustomerName = parseStringField(v)
	}
	if v, ok := fields[FieldVolume]; ok {
		record.Volume = parseFloatField(v)
	}
	if v, ok := fields[FieldLocation]; ok {
		record.Location = parseStringField(v)
	}

	return record
}

// FieldMapToMixerTruck 将 Bitable 字段 map 转换为搅拌车领域模型
func FieldMapToMixerTruck(fields map[string]interface{}, recordID string) *domain.MixerTruckRecord {
	record := &domain.MixerTruckRecord{RecordID: recordID}

	if v, ok := fields[FieldDate]; ok {
		record.Date = parseTimestampField(v)
	}
	if v, ok := fields[FieldCustomerName]; ok {
		record.CustomerName = parseStringField(v)
	}
	if v, ok := fields[FieldVolume]; ok {
		record.Volume = parseFloatField(v)
	}
	if v, ok := fields[FieldRemark]; ok {
		record.Remark = parseStringField(v)
	}
	if v, ok := fields[FieldDriver]; ok {
		record.Drivers = parseStringSliceField(v)
	}

	return record
}

// parseStringField 从字段值中提取字符串
func parseStringField(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	default:
		return fmt.Sprintf("%v", val)
	}
}

// parseFloatField 从字段值中提取浮点数
func parseFloatField(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	case int64:
		return float64(val)
	default:
		return 0
	}
}

// parseTimestampField 从字段值中解析时间戳（毫秒）
func parseTimestampField(v interface{}) time.Time {
	switch val := v.(type) {
	case float64:
		return time.UnixMilli(int64(val))
	case int64:
		return time.UnixMilli(val)
	default:
		return time.Time{}
	}
}

// parseStringSliceField 从字段值中提取字符串切片（多选字段）
func parseStringSliceField(v interface{}) []string {
	switch val := v.(type) {
	case []interface{}:
		result := make([]string, 0, len(val))
		for _, item := range val {
			if s, ok := item.(string); ok {
				result = append(result, s)
			}
		}
		return result
	case string:
		return []string{val}
	default:
		return nil
	}
}
