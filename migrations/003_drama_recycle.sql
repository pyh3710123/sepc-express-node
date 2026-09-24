CREATE INDEX dramas_recycle_account_idx ON dramas(account_id, deleted_at DESC, id DESC)
WHERE deleted_at IS NOT NULL;
CREATE INDEX dramas_parent_account_idx ON dramas(account_id, parent_id, id);

ALTER TABLE dramas ADD COLUMN cover_image text;

-- 永久删除项目时保留任务和账本审计记录，仅解除已删除画布和节点的引用。
ALTER TABLE generation_tasks DROP CONSTRAINT generation_tasks_canvas_id_fkey;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_canvas_id_fkey
  FOREIGN KEY (canvas_id) REFERENCES canvases(id) ON DELETE SET NULL;
ALTER TABLE generation_tasks DROP CONSTRAINT generation_tasks_node_id_fkey;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_node_id_fkey
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL;
