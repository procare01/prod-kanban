-- ============================================================
-- GRANTS FOR ADMIN EVENT/HISTORY RPCS
-- ============================================================

grant execute on function admin_delete_history_entry(uuid) to anon, authenticated;
grant execute on function admin_clear_line_history(uuid) to anon, authenticated;
grant execute on function admin_delete_event(uuid) to anon, authenticated;
grant execute on function admin_clear_all_events() to anon, authenticated;
