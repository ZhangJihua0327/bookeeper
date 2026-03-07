package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	"github.com/zhangjihua0327/bookeeper/internal/repository/bitable"
)

func main() {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	client := bitable.NewLarkClient(cfg)
	ctx := context.Background()

	// 初始化 Repository
	pumpTruckRepo := bitable.NewPumpTruckRepository(client, cfg.BitableAppToken, cfg.PumpTruckTableID)
	mixerTruckRepo := bitable.NewMixerTruckRepository(client, cfg.BitableAppToken, cfg.MixerTruckTableID)
	fieldOptionMgr := bitable.NewFieldOptionManager(client, cfg.BitableAppToken)

	// 验证：创建一条泵车记录
	fmt.Println("=== 创建泵车记录 ===")
	pumpRecordID, err := pumpTruckRepo.Create(ctx, &domain.PumpTruckRecord{
		Date:         time.Now(),
		TruckModel:   "测试车型",
		CustomerName: "测试客户",
		Volume:       100,
		Location:     "测试地点",
		Driver:       "测试驾驶员",
	})
	if err != nil {
		log.Fatalf("创建泵车记录失败: %v", err)
	}
	fmt.Printf("创建成功，record_id: %s\n", pumpRecordID)

	// 验证：创建一条搅拌车记录
	fmt.Println("\n=== 创建搅拌车记录 ===")
	mixerRecordID, err := mixerTruckRepo.Create(ctx, &domain.MixerTruckRecord{
		Date:         time.Now(),
		CustomerName: "测试客户",
		Volume:       50,
		Location:     "测试地点",
		Drivers:      []string{"驾驶员A", "驾驶员B"},
	})
	if err != nil {
		log.Fatalf("创建搅拌车记录失败: %v", err)
	}
	fmt.Printf("创建成功，record_id: %s\n", mixerRecordID)

	// 验证：查询泵车表"车型"字段的可选值
	fmt.Println("\n=== 泵车表-车型选项 ===")
	truckModels, err := fieldOptionMgr.GetFieldOptions(ctx, cfg.PumpTruckTableID, "车型")
	if err != nil {
		log.Fatalf("查询车型选项失败: %v", err)
	}
	fmt.Printf("车型选项: %v\n", truckModels)

	fmt.Println("\n验证完成!")
}
