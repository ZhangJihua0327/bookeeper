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
var _ repository.MixerTruckRepository = (*mixerTruckRepo)(nil)

type mixerTruckRepo struct {
	client   *lark.Client
	appToken string
	tableID  string
}

// NewMixerTruckRepository 创建搅拌车 Repository
func NewMixerTruckRepository(client *lark.Client, appToken, tableID string) repository.MixerTruckRepository {
	return &mixerTruckRepo{
		client:   client,
		appToken: appToken,
		tableID:  tableID,
	}
}

func (r *mixerTruckRepo) Create(ctx context.Context, record *domain.MixerTruckRecord) (string, error) {
	log.Printf("[Repo] 创建搅拌车记录 table=%s customer=%s drivers=%v volume=%.1f", r.tableID, record.CustomerName, record.Drivers, record.Volume)
	fields := MixerTruckToFieldMap(record)

	req := larkbitable.NewCreateAppTableRecordReqBuilder().
		AppToken(r.appToken).
		TableId(r.tableID).
		AppTableRecord(larkbitable.NewAppTableRecordBuilder().
			Fields(fields).
			Build()).
		Build()

	resp, err := r.client.Bitable.AppTableRecord.Create(ctx, req)
	if err != nil {
		log.Printf("[Repo] 创建搅拌车记录失败: table=%s err=%v", r.tableID, err)
		return "", fmt.Errorf("创建搅拌车记录失败: %w", err)
	}
	if !resp.Success() {
		log.Printf("[Repo] 创建搅拌车记录API失败: table=%s code=%d msg=%s requestId=%s", r.tableID, resp.Code, resp.Msg, resp.RequestId())
		return "", biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
	}

	log.Printf("[Repo] 搅拌车记录创建成功 recordId=%s", *resp.Data.Record.RecordId)
	return *resp.Data.Record.RecordId, nil
}
