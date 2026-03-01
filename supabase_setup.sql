-- ============================================================
-- Multi-Tenant Office Management Hub — Supabase Setup Script
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ─── EXTENSIONS ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── COMPANIES ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  staff_limit  INTEGER DEFAULT NULL, -- NULL = unlimited; set by Super Admin
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── MIGRATION: Add staff_limit column if it doesn't exist (run if table already exists) ──
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS staff_limit INTEGER DEFAULT NULL;

-- ─── PROFILES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  username    TEXT UNIQUE,
  password    TEXT, -- SAVED AS PLAIN TEXT PER USER REQUEST
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin','admin','staff')),
  avatar_url  TEXT,
  is_suspended BOOLEAN DEFAULT FALSE,
  salary      TEXT,
  duty_time   TEXT,
  custom_note TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── ATTENDANCE ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('in','break','break_in','out')),
  ip_address  TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── POSTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.posts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content     TEXT,
  image_url   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── POST LIKES ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_likes (
  id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id  UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  UNIQUE(post_id, user_id)
);

-- ─── POST COMMENTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_comments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id     UUID REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── NOTIFICATIONS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  target_user_id   UUID CONSTRAINT notifications_target_user_id_fkey REFERENCES public.profiles(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  body             TEXT,
  attachment_url   TEXT,
  attachment_type  TEXT CHECK (attachment_type IN ('image', 'link', 'file')),
  created_by       UUID CONSTRAINT notifications_created_by_fkey REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── COMPANY MESSAGES (Admin → Super Admin) ──────────────────────
CREATE TABLE IF NOT EXISTS public.company_messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  admin_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  is_read      BOOLEAN DEFAULT FALSE,
  reply        TEXT,
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── MIGRATION: Add company_messages if it doesn't exist ──
-- (safe if already run)

-- ─── NOTIFICATION READS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_reads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_id  UUID CONSTRAINT notification_reads_notification_id_fkey REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id          UUID CONSTRAINT notification_reads_user_id_fkey REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(notification_id, user_id)
);

-- ═══════════════════════════════════════════════════════════
-- DISABLE ROW LEVEL SECURITY (Supporting custom session)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.companies           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_messages    DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════
-- HELPER FUNCTION — get caller's role & company_id
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.get_my_company()
RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — COMPANIES
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super_admin_companies_all" ON public.companies;
CREATE POLICY "super_admin_companies_all" ON public.companies
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin')
  WITH CHECK (public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "admin_staff_view_own_company" ON public.companies;
CREATE POLICY "admin_staff_view_own_company" ON public.companies
  FOR SELECT TO authenticated
  USING (id = public.get_my_company());

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — PROFILES
-- ═══════════════════════════════════════════════════════════
-- Allow public SELECT for login check
DROP POLICY IF EXISTS "public_login_check" ON public.profiles;
CREATE POLICY "public_login_check" ON public.profiles
  FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "super_admin_profiles_all" ON public.profiles;
CREATE POLICY "super_admin_profiles_all" ON public.profiles
  FOR ALL TO public
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — ATTENDANCE
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super_admin_attendance_all" ON public.attendance;
CREATE POLICY "super_admin_attendance_all" ON public.attendance
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "admin_view_company_attendance" ON public.attendance;
CREATE POLICY "admin_view_company_attendance" ON public.attendance
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'admin'
    AND company_id = public.get_my_company()
  );

DROP POLICY IF EXISTS "staff_insert_own_attendance" ON public.attendance;
CREATE POLICY "staff_insert_own_attendance" ON public.attendance
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND company_id = public.get_my_company());

DROP POLICY IF EXISTS "staff_update_own_attendance" ON public.attendance;
CREATE POLICY "staff_update_own_attendance" ON public.attendance
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "staff_view_own_attendance" ON public.attendance;
CREATE POLICY "staff_view_own_attendance" ON public.attendance
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — POSTS
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super_admin_posts_all" ON public.posts;
CREATE POLICY "super_admin_posts_all" ON public.posts
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "company_members_view_posts" ON public.posts;
CREATE POLICY "company_members_view_posts" ON public.posts
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company());

DROP POLICY IF EXISTS "staff_insert_post" ON public.posts;
CREATE POLICY "staff_insert_post" ON public.posts
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND company_id = public.get_my_company());

DROP POLICY IF EXISTS "admin_delete_company_post" ON public.posts;
CREATE POLICY "admin_delete_company_post" ON public.posts
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() IN ('admin','super_admin')
    AND company_id = public.get_my_company()
  );

DROP POLICY IF EXISTS "author_delete_own_post" ON public.posts;
CREATE POLICY "author_delete_own_post" ON public.posts
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — POST LIKES
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "company_members_view_likes" ON public.post_likes;
CREATE POLICY "company_members_view_likes" ON public.post_likes
  FOR SELECT TO authenticated
  USING (
    post_id IN (
      SELECT id FROM public.posts WHERE company_id = public.get_my_company()
    )
  );

DROP POLICY IF EXISTS "staff_toggle_like" ON public.post_likes;
CREATE POLICY "staff_toggle_like" ON public.post_likes
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — POST COMMENTS
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "company_members_view_comments" ON public.post_comments;
CREATE POLICY "company_members_view_comments" ON public.post_comments
  FOR SELECT TO authenticated
  USING (
    post_id IN (
      SELECT id FROM public.posts WHERE company_id = public.get_my_company()
    )
  );

DROP POLICY IF EXISTS "staff_insert_comment" ON public.post_comments;
CREATE POLICY "staff_insert_comment" ON public.post_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "author_delete_own_comment" ON public.post_comments;
CREATE POLICY "author_delete_own_comment" ON public.post_comments
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());

DROP POLICY IF EXISTS "admin_delete_company_comment" ON public.post_comments;
CREATE POLICY "admin_delete_company_comment" ON public.post_comments
  FOR DELETE TO authenticated
  USING (
    public.get_my_role() IN ('admin','super_admin')
    AND post_id IN (
      SELECT id FROM public.posts WHERE company_id = public.get_my_company()
    )
  );

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super_admin_notifications_all" ON public.notifications;
CREATE POLICY "super_admin_notifications_all" ON public.notifications
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "admin_manage_notifications" ON public.notifications;
CREATE POLICY "admin_manage_notifications" ON public.notifications
  FOR ALL TO authenticated
  USING (
    public.get_my_role() = 'admin'
    AND company_id = public.get_my_company()
  )
  WITH CHECK (
    public.get_my_role() = 'admin'
    AND company_id = public.get_my_company()
  );

DROP POLICY IF EXISTS "staff_view_notifications" ON public.notifications;
CREATE POLICY "staff_view_notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company());

-- ═══════════════════════════════════════════════════════════
-- RLS POLICIES — NOTIFICATION READS
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "super_admin_reads_all" ON public.notification_reads;
CREATE POLICY "super_admin_reads_all" ON public.notification_reads
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'super_admin');

DROP POLICY IF EXISTS "admin_view_company_reads" ON public.notification_reads;
CREATE POLICY "admin_view_company_reads" ON public.notification_reads
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin','super_admin')
    AND notification_id IN (
      SELECT id FROM public.notifications WHERE company_id = public.get_my_company()
    )
  );

DROP POLICY IF EXISTS "user_insert_own_read" ON public.notification_reads;
CREATE POLICY "user_insert_own_read" ON public.notification_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_view_own_reads" ON public.notification_reads;
CREATE POLICY "user_view_own_reads" ON public.notification_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ═══════════════════════════════════════════════════════════
-- AUTO-CREATE PROFILE ON SIGNUP
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, company_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    (NEW.raw_user_meta_data->>'company_id')::UUID
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- REALTIME — enable for live subscriptions
-- Using SET TABLE ensures the publication has exactly these tables without erroring if they already exist
ALTER PUBLICATION supabase_realtime SET TABLE 
  public.posts, 
  public.post_likes, 
  public.post_comments, 
  public.attendance, 
  public.notifications, 
  public.profiles;

-- ═══════════════════════════════════════════════════════════
-- STORAGE SETUP (Create Buckets & Policies)
-- ═══════════════════════════════════════════════════════════

-- 1. Create buckets if they don't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('post-images', 'post-images', true), 
  ('avatars', 'avatars', true), 
  ('notif-attachments', 'notif-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Enable public access (SELECT) for all three buckets
DROP POLICY IF EXISTS "Public Access - post-images" ON storage.objects;
CREATE POLICY "Public Access - post-images" ON storage.objects FOR SELECT USING (bucket_id = 'post-images');

DROP POLICY IF EXISTS "Public Access - avatars" ON storage.objects;
CREATE POLICY "Public Access - avatars" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Public Access - notif-attachments" ON storage.objects;
CREATE POLICY "Public Access - notif-attachments" ON storage.objects FOR SELECT USING (bucket_id = 'notif-attachments');

-- 3. Allow anonymous/authenticated UPLOADS (INSERT)
-- Note: We allow 'public' here because our app uses a custom login system 
-- where the client often acts as 'anon' to Supabase Storage.
DROP POLICY IF EXISTS "Allow Uploads - post-images" ON storage.objects;
CREATE POLICY "Allow Uploads - post-images" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'post-images');

DROP POLICY IF EXISTS "Allow Uploads - avatars" ON storage.objects;
CREATE POLICY "Allow Uploads - avatars" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Allow Uploads - notif-attachments" ON storage.objects;
CREATE POLICY "Allow Uploads - notif-attachments" ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'notif-attachments');

-- ═══════════════════════════════════════════════════════════
-- SAMPLE DATA (optional — uncomment to seed)
-- ═══════════════════════════════════════════════════════════
-- INSERT INTO public.companies (name) VALUES ('Acme Corp');
