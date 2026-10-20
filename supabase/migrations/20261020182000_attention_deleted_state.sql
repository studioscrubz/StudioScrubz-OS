-- Preserve deletion of generated notifications without deleting business records.
alter table public.attention_item_states
  drop constraint if exists attention_item_states_state_check;
alter table public.attention_item_states
  add constraint attention_item_states_state_check
  check (state in ('Snoozed', 'Dismissed', 'Deleted'));
alter table public.attention_item_states
  drop constraint if exists attention_item_states_shape;
alter table public.attention_item_states
  add constraint attention_item_states_shape check (
    (state = 'Snoozed' and snoozed_until is not null and dismissed_at is null)
    or (state in ('Dismissed', 'Deleted') and snoozed_until is null and dismissed_at is not null)
  );
