-- Worker 按删除时间扫描所有账号的到期项目；账号前缀索引不能支持此排序。
CREATE INDEX dramas_recycle_expiry_idx ON dramas(deleted_at, id)
WHERE deleted_at IS NOT NULL;
