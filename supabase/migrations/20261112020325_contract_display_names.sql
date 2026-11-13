-- Optional alias. Existing clients and assignment UUIDs continue to work.
alter table public.contracts add column display_name text;

alter table public.contracts add constraint contracts_display_name_length
  check (display_name is null or char_length(btrim(display_name)) between 1 and 100);
