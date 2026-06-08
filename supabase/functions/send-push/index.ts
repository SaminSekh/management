// Supabase Edge Function: send-push
// Deploy with: supabase functions deploy send-push
//
// Required env vars (set in Supabase Dashboard → Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY   — your VAPID public key (base64url)
//   VAPID_PRIVATE_KEY  — your VAPID private key (base64url)
//   VAPID_SUBJECT      — mailto:you@example.com  or  https://yourdomain.com
//   SUPABASE_URL       — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { title, body, url, company_id, target_user_id } = await req.json();

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!
    );

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch matching subscriptions
    let query = supabase.from('push_subscriptions').select('*').eq('company_id', company_id);
    if (target_user_id) {
      query = query.eq('user_id', target_user_id);
    }
    const { data: subs, error } = await query;
    if (error) throw error;

    const payload = JSON.stringify({ title, body, url: url || './staff.html', tag: 'mgmt-hub' });
    const results = await Promise.allSettled(
      (subs || []).map(sub =>
        webpush.sendNotification(sub.subscription, payload).catch(err => {
          // Remove expired/invalid subscriptions (410 Gone)
          if (err.statusCode === 410 || err.statusCode === 404) {
            return supabase.from('push_subscriptions').delete().eq('id', sub.id);
          }
          throw err;
        })
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    return new Response(JSON.stringify({ ok: true, sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
