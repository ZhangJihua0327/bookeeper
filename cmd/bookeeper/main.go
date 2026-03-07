package main

import (
	"context"
	"fmt"
	"log"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/ai"
	"github.com/zhangjihua0327/bookeeper/internal/repository/bitable"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

func main() {
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	client := bitable.NewLarkClient(cfg)
	ctx := context.Background()

	// 初始化依赖
	fieldOptionMgr := bitable.NewFieldOptionManager(client, cfg.Bitable.AppToken)
	aiClient := ai.NewDashScopeClient(cfg.Aliyun.APIKey)
	parsingSvc := service.NewParsingService(aiClient, fieldOptionMgr, cfg.Bitable, cfg.Aliyun.Model)

	// 验证：解析泵车记录
	fmt.Println("=== 解析泵车记录 ===")
	pumpResult, err := parsingSvc.ParsePumpTruck(ctx, service.ParseInput{
		Text: "今天33米泵车去阳光城工地，客户恒大地产，打了15方，李师傅开的",
	})
	if err != nil {
		log.Fatalf("解析泵车记录失败: %v", err)
	}
	fmt.Printf("解析结果: 日期=%v, 车型=%s, 客户=%s, 方量=%.1f, 地点=%s, 驾驶员=%s\n",
		pumpResult.Record.Date.Format("2006-01-02"),
		pumpResult.Record.TruckModel,
		pumpResult.Record.CustomerName,
		pumpResult.Record.Volume,
		pumpResult.Record.Location,
		pumpResult.Record.Driver,
	)
	if pumpResult.HasUnknownOptions() {
		fmt.Println("以下字段值不在选项列表中:")
		for _, u := range pumpResult.UnknownOptions {
			fmt.Printf("  - %s: %s\n", u.FieldName, u.Value)
		}
	} else {
		fmt.Println("所有字段值都在选项列表中")
	}

	// 验证：解析搅拌车记录
	fmt.Println("\n=== 解析搅拌车记录 ===")
	mixerResult, err := parsingSvc.ParseMixerTruck(ctx, service.ParseInput{
		Text: "搅拌车送50方到万科工地，客户万科地产，张三和李四开的",
	})
	if err != nil {
		log.Fatalf("解析搅拌车记录失败: %v", err)
	}
	fmt.Printf("解析结果: 日期=%v, 客户=%s, 方量=%.1f, 地点=%s, 驾驶员=%v\n",
		mixerResult.Record.Date.Format("2006-01-02"),
		mixerResult.Record.CustomerName,
		mixerResult.Record.Volume,
		mixerResult.Record.Location,
		mixerResult.Record.Drivers,
	)
	if mixerResult.HasUnknownOptions() {
		fmt.Println("以下字段值不在选项列表中:")
		for _, u := range mixerResult.UnknownOptions {
			fmt.Printf("  - %s: %s\n", u.FieldName, u.Value)
		}
	} else {
		fmt.Println("所有字段值都在选项列表中")
	}

	fmt.Println("\n验证完成!")
}
