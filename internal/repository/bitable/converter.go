package bitable

import (
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
	if record.Remark != "" {
		fields[FieldRemark] = record.Remark
	}
	if record.Driver != "" {
		fields[FieldDriver] = record.Driver
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
	if record.Location != "" {
		fields[FieldLocation] = record.Location
	}
	if record.Remark != "" {
		fields[FieldRemark] = record.Remark
	}
	if len(record.Drivers) > 0 {
		fields[FieldDriver] = record.Drivers
	}

	return fields
}
