create table clips (
  id            uuid        primary key default gen_random_uuid(),
  filename      text        not null,
  date          date        not null,
  game          text        not null,
  categories    text[]      not null default '{}',
  description   text        not null,
  drive_url     text        not null,
  duration      integer,
  tagged_by     text,
  notes         text,
  search_vector tsvector,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Indexes
create index clips_date_idx       on clips(date desc);
create index clips_game_idx       on clips(game);
create index clips_categories_idx on clips using gin(categories);
create index clips_fts_idx        on clips using gin(search_vector);

-- Single trigger function that maintains both updated_at and search_vector
create or replace function clips_before_upsert()
returns trigger language plpgsql as $$
begin
  new.updated_at     := now();
  new.search_vector  := to_tsvector(
    'english',
    coalesce(new.game, '')                          || ' ' ||
    coalesce(new.description, '')                   || ' ' ||
    coalesce(array_to_string(new.categories, ' '), '') || ' ' ||
    coalesce(new.notes, '')
  );
  return new;
end;
$$;

create trigger clips_before_upsert
  before insert or update on clips
  for each row execute procedure clips_before_upsert();
