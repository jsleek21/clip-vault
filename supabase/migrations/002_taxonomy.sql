-- Run this in the Supabase SQL editor after schema.sql

-- 1. Add subcategories column to clips
alter table clips add column if not exists subcategories text[] not null default '{}';

-- 2. Refresh FTS trigger to include subcategories
create or replace function clips_before_upsert()
returns trigger language plpgsql as $$
begin
  new.updated_at    := now();
  new.search_vector := to_tsvector(
    'english',
    coalesce(new.game, '')                                || ' ' ||
    coalesce(new.description, '')                         || ' ' ||
    coalesce(array_to_string(new.categories,    ' '), '') || ' ' ||
    coalesce(array_to_string(new.subcategories, ' '), '') || ' ' ||
    coalesce(new.notes, '')
  );
  return new;
end;
$$;

-- 3. Taxonomy table (categories + subcategories)
create table if not exists taxonomy (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  parent_id  uuid        references taxonomy(id) on delete cascade,
  sort_order int         not null default 0,
  created_at timestamptz default now()
);

create index if not exists taxonomy_parent_idx on taxonomy(parent_id);

-- 4. Seed default top-level categories (skipped if table already has rows)
do $$
begin
  if not exists (select 1 from taxonomy limit 1) then
    insert into taxonomy (name, sort_order) values
      ('Gameplay',     0),
      ('Reaction',     1),
      ('JustChatting', 2),
      ('Highlight',    3),
      ('Fail',         4),
      ('Funny',        5);
  end if;
end $$;
