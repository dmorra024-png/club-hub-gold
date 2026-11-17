
CREATE SEQUENCE IF NOT EXISTS public.member_number_seq START 1 MINVALUE 1;

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS member_number text;

UPDATE public.members
SET member_number = lpad(nextval('public.member_number_seq')::text, 7, '0')
WHERE member_number IS NULL;

CREATE OR REPLACE FUNCTION public.tg_assign_member_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.member_number IS NULL OR NEW.member_number = '' THEN
    NEW.member_number := lpad(nextval('public.member_number_seq')::text, 7, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assign_member_number ON public.members;
CREATE TRIGGER assign_member_number
BEFORE INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.tg_assign_member_number();

ALTER TABLE public.members ALTER COLUMN member_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_member_number_key ON public.members(member_number);

-- Keep sequence ahead of any pre-existing values
SELECT setval('public.member_number_seq', GREATEST((SELECT COALESCE(MAX(member_number::int), 0) FROM public.members), 1));
