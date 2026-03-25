package bitable

import (
	"context"
	"fmt"
	"log"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkbitable "github.com/larksuite/oapi-sdk-go/v3/service/bitable/v1"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	biterrors "github.com/zhangjihua0327/bookeeper/internal/errors"
	"github.com/zhangjihua0327/bookeeper/internal/repository"
)

// 编译期接口一致性断言
var _ repository.PumpTruckRepository = (*pumpTruckRepo)(nil)

type pumpTruckRepo struct {
	client   *lark.Client
	appToken string
	tableID  string
}

// NewPumpTruckRepository 创建泵车 Repository
func NewPumpTruckRepository(client *lark.Client, appToken, tableID string) repository.PumpTruckRepository {
	return &pumpTruckRepo{
		client:   client,
		appToken: appToken,
		tableID:  tableID,
	}
}

func (r *pumpTruckRepo) Create(ctx context.Context, record *domain.PumpTruckRecord) (string, error) {
	log.Printf("[Repo] 创建泵车记录 table=%s customer=%s volume=%.1f", r.tableID, record.CustomerName, record.Volume)
	fields := PumpTruckToFieldMap(record)

	req := larkbitable.NewCreateAppTableRecordReqBuilder().
		AppToken(r.appToken).
		TableId(r.tableID).
		AppTableRecord(larkbitable.NewAppTableRecordBuilder().
			Fields(fields).
			Build()).
		Build()

	resp, err := r.client.Bitable.AppTableRecord.Create(ctx, req)
	if err != nil {
		log.Printf("[Repo] 创建泵车记录失败: table=%s err=%v", r.tableID, err)
		return "", fmt.Errorf("创建泵车记录失败: %w", err)
	}
	if !resp.Success() {
		log.Printf("[Repo] 创建泵车记录API失败: table=%s code=%d msg=%s requestId=%s", r.tableID, resp.Code, resp.Msg, resp.RequestId())
		return "", biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
	}

	log.Printf("[Repo] 泵车记录创建成功 recordId=%s", *resp.Data.Record.RecordId)
	return *resp.Data.Record.RecordId, nil
}

func (r *pumpTruckRepo) GetByID(ctx context.Context, recordID string) (*domain.PumpTruckRecord, error) {
	log.Printf("[Repo] 读取泵车记录 table=%s recordId=%s", r.tableID, recordID)
	req := larkbitable.NewGetAppTableRecordReqBuilder().
		AppToken(r.appToken).
		TableId(r.tableID).
		RecordId(recordID).
		Build()

	resp, err := r.client.Bitable.AppTableRecord.Get(ctx, req)
	if err != nil {
		return nil, fmt.Errorf("读取泵车记录失败: %w", err)
	}
	if !resp.Success() {
		return nil, biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
	}

	record := FieldMapToPumpTruck(resp.Data.Record.Fields, recordID)
	log.Printf("[Repo] 泵车记录读取成功 recordId=%s", recordID)
	return record, nil
}
