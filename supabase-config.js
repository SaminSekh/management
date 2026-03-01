// ============================================================
// Supabase Client Configuration
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your own values
// from: Supabase Dashboard → Settings → API
// ============================================================

const SUPABASE_URL = 'https://cmckglkuelmbbvotjnpv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNtY2tnbGt1ZWxtYmJ2b3RqbnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxOTAxNDksImV4cCI6MjA4Nzc2NjE0OX0.pCOF86mA2ov0m09onqTMYpbMOPOMnqrwH24RwiOscfY';

const SUPABASE_SERVICE_ROLE_KEY = 'YOUR_SERVICE_ROLE_KEY_HERE';

// Use 'sb' to avoid conflict with the library itself
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
