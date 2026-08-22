-- StudioScrubz OS Backlog V2: remove temporary public table access.
-- REVIEW ONLY. Run manually in the Supabase SQL editor after review.

drop policy if exists "Temporary client create access" on public.clients;
drop policy if exists "Temporary client read access" on public.clients;
drop policy if exists "Temporary client update access" on public.clients;

drop policy if exists "Temporary property create access" on public.properties;
drop policy if exists "Temporary property read access" on public.properties;
drop policy if exists "Temporary property update access" on public.properties;

drop policy if exists "Temporary estimate create access" on public.estimates;
drop policy if exists "Temporary estimate read access" on public.estimates;
drop policy if exists "Temporary estimate update access" on public.estimates;
