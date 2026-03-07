package bitable

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
)

// TestGetAllSelectFieldOptions 集成测试：获取泵车表和搅拌车表中所有单选/多选字段的选项列表
func TestGetAllSelectFieldOptions(t *testing.T) {
	cfg, err := config.Load("../../../config.yaml")
	if err != nil {
		t.Skipf("加载配置失败，跳过集成测试: %v", err)
	}

	client := NewLarkClient(cfg)
	mgr := NewFieldOptionManager(client, cfg.Bitable.AppToken)
	ctx := context.Background()

	// 泵车表的单选字段
	pumpSelectFields := []string{"车型", "客户名称", "驾驶员"}
	// 搅拌车表的单选/多选字段
	mixerSelectFields := []string{"客户名称", "驾驶员"}

	fmt.Println("=== 泵车表 ===")
	for _, fieldName := range pumpSelectFields {
		options, err := mgr.GetFieldOptions(ctx, cfg.Bitable.PumpTruckTableID, fieldName)
		if err != nil {
			t.Errorf("泵车表-获取 %q 选项失败: %v", fieldName, err)
			continue
		}
		fmt.Printf("  %s: %v\n", fieldName, options)
	}

	fmt.Println("=== 搅拌车表 ===")
	for _, fieldName := range mixerSelectFields {
		options, err := mgr.GetFieldOptions(ctx, cfg.Bitable.MixerTruckTableID, fieldName)
		if err != nil {
			t.Errorf("搅拌车表-获取 %q 选项失败: %v", fieldName, err)
			continue
		}
		fmt.Printf("  %s: %v\n", fieldName, options)
	}
}

// TestCreatePumpTruckRecord 集成测试：向泵车表插入一条记录
func TestCreatePumpTruckRecord(t *testing.T) {
	cfg, err := config.Load("../../../config.yaml")
	if err != nil {
		t.Skipf("加载配置失败，跳过集成测试: %v", err)
	}

	client := NewLarkClient(cfg)
	repo := NewPumpTruckRepository(client, cfg.Bitable.AppToken, cfg.Bitable.PumpTruckTableID)
	ctx := context.Background()

	record := &domain.PumpTruckRecord{
		Date:         time.Date(2026, 3, 7, 0, 0, 0, 0, time.Local),
		TruckModel:   "33米",
		CustomerName: "顾青松",
		Volume:       13.0,
		Location:     "李世华",
		Driver:       "姜",
	}

	recordID, err := repo.Create(ctx, record)
	if err != nil {
		t.Fatalf("创建泵车记录失败: %v", err)
	}
	fmt.Printf("创建成功，record_id: %s\n", recordID)
}
