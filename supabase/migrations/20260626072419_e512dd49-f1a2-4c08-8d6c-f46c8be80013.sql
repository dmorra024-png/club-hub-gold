
ALTER TABLE public.members
  ALTER COLUMN member_number SET DEFAULT lpad(nextval('public.member_number_seq')::text, 7, '0');
