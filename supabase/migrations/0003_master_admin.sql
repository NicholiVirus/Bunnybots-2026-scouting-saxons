-- ═══════════════════════════════════════════════════════════════════════════
--  Master admin: the top-level admin, protected from the other admins.
--  With the admin passcode anyone can become an admin, so the master admin is
--  the one account they cannot remove:
--    • the master admin is always an admin and cannot be demoted or removed
--      through the app;
--    • only the master admin can demote another admin (an admin may still
--      step down themselves);
--    • who is master can only be changed in the SQL Editor:
--        update public.profiles set is_master = true, role = 'admin'
--         where email = 'someone@example.com';
--  Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles add column if not exists is_master boolean not null default false;
grant select (is_master) on public.profiles to authenticated;

create or replace function public.is_master() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_master from public.profiles where id = auth.uid() and deleted_at is null), false)
$$;
revoke execute on function public.is_master() from public;
revoke execute on function public.is_master() from anon;
grant execute on function public.is_master() to authenticated;

-- Replaces the 0001 guard: same rules plus the master-admin rules above.
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- SQL Editor / migrations / service role / security-definer RPCs are trusted.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.is_master is distinct from old.is_master then
    raise exception 'the master admin can only be changed in the SQL Editor' using errcode = '42501';
  end if;
  if old.is_master and (new.role <> 'admin' or new.deleted_at is not null) then
    raise exception 'the master admin cannot be demoted or removed' using errcode = '42501';
  end if;
  if new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'only an admin can change roles' using errcode = '42501';
    end if;
    if old.role = 'admin' and new.role <> 'admin' then
      if old.id <> auth.uid() and not public.is_master() then
        raise exception 'only the master admin can demote another admin' using errcode = '42501';
      end if;
      if (select count(*) from public.profiles where role = 'admin' and deleted_at is null) <= 1 then
        raise exception 'cannot remove the last admin' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.id is distinct from old.id or new.email is distinct from old.email then
    raise exception 'id/email are read-only' using errcode = '42501';
  end if;
  return new;
end $$;

-- Admin user list now says who the master admin is (return type changes → drop first).
drop function if exists public.admin_list_profiles();
create function public.admin_list_profiles()
returns table (id uuid, display_name text, email text, role public.app_role, is_master boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query select p.id, p.display_name, p.email, p.role, p.is_master, p.created_at
               from public.profiles p where p.deleted_at is null order by p.is_master desc, p.created_at;
end $$;
revoke execute on function public.admin_list_profiles() from public;
revoke execute on function public.admin_list_profiles() from anon;
grant execute on function public.admin_list_profiles() to authenticated;
