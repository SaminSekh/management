/**
 * push-helper.js
 * ─────────────────────────────────────────────────────────────────
 * Handles Web Push subscription (staff/admin/superadmin) and push
 * delivery (admin side) via Supabase Edge Function.
 *
 * HOW TO GET VAPID KEYS (one-time setup):
 *   1. Run in terminal:  npx web-push generate-vapid-keys
 *   2. Paste the Public Key into PUSH_PUBLIC_VAPID_KEY below.
 *   3. Store the Private Key in Supabase Dashboard →
 *      Edge Functions → Secrets → VAPID_PRIVATE_KEY
 *   4. Also set VAPID_PUBLIC_KEY and VAPID_SUBJECT there.
 * ─────────────────────────────────────────────────────────────────
 */

// ── Replace with your real VAPID public key ──────────────────────
const PUSH_PUBLIC_VAPID_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa40Hd8YP_GCrOHJOzk5VKgJwlnDdvXQxJBZwNsK9XblQimlHRs2aX-0J5VgA';
// ────────────────────────────────────────────────────────────────

// Supabase Edge Function URL (update SUPABASE_URL after deploy)
function getPushFunctionUrl() {
  return (window.SUPABASE_URL || 'https://cmckglkuelmbbvotjnpv.supabase.co') +
    '/functions/v1/send-push';
}

/**
 * Convert a base64url string to a Uint8Array (needed for PushManager.subscribe)
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Request notification permission and subscribe to push.
 * Stores the subscription in Supabase push_subscriptions table.
 * Call this once the user is logged in.
 *
 * @param {object} sbClient - Supabase client (window.sb)
 * @param {string} userId
 * @param {string} companyId
 */
async function subscribeToPush(sbClient, userId, companyId) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const reg = await navigator.serviceWorker.ready;

    // Ask for permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Subscribe (or reuse existing)
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_VAPID_KEY)
    });

    const subJson = sub.toJSON();

    // Upsert into Supabase
    await sbClient.from('push_subscriptions').upsert(
      {
        user_id: userId,
        company_id: companyId,
        subscription: subJson,
        user_agent: navigator.userAgent.slice(0, 200)
      },
      { onConflict: 'user_id,subscription', ignoreDuplicates: true }
    );
  } catch (err) {
    // Silent — push is a progressive enhancement
    console.warn('[push-helper] Subscribe failed:', err);
  }
}

/**
 * Send a push notification to staff via the Edge Function.
 * Call this from admin/superadmin after inserting a notification/post.
 *
 * @param {string} title
 * @param {string} body
 * @param {string} companyId
 * @param {string|null} targetUserId - null = broadcast to all company staff
 * @param {string} [url] - deep-link URL opened when notification is clicked
 */
async function sendPushNotification(title, body, companyId, targetUserId = null, url = './staff.html') {
  try {
    const anonKey = window.SUPABASE_ANON_KEY || '';
    const resp = await fetch(getPushFunctionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
        'apikey': anonKey
      },
      body: JSON.stringify({ title, body, url, company_id: companyId, target_user_id: targetUserId })
    });
    const result = await resp.json();
    if (!result.ok) console.warn('[push-helper] Edge Function error:', result.error);
  } catch (err) {
    console.warn('[push-helper] sendPushNotification failed:', err);
  }
}

// ── Notification gating UI & helper ───────────────────────────────────
// Blocks site access until Notification.permission === 'granted'.
window.notificationsAllowed = (typeof Notification !== 'undefined' && Notification.permission === 'granted');

window.ensureNotificationsGate = async function ensureNotificationsGate() {
  try {
    if (!('Notification' in window)) {
      createGateOverlay('Notifications are not supported by this browser. Some features may not work.');
      return;
    }
    if (Notification.permission === 'granted') {
      window.notificationsAllowed = true;
      removeGateOverlay();
      return;
    }
    // Show blocking overlay
    createGateOverlay();
    // If default, request immediately
    if (Notification.permission === 'default') {
      try {
        const p = await Notification.requestPermission();
        if (p === 'granted') { unlockGate(); return; }
        else { updateGateForDenied(); }
      } catch (e) {
        console.warn('[push-helper] requestPermission error', e);
      }
    } else if (Notification.permission === 'denied') {
      updateGateForDenied();
    }
    // Poll for permission change
    const poll = setInterval(() => {
      if (Notification.permission === 'granted') { clearInterval(poll); unlockGate(); }
    }, 1500);
  } catch (err) {
    console.warn('[push-helper] ensureNotificationsGate error', err);
  }
};

function removeGateOverlay() {
  const o = document.getElementById('notif-gate-overlay');
  if (o) o.remove();
}

function injectGateStyles() {
  if (document.getElementById('notif-gate-styles')) return;
  const s = document.createElement('style');
  s.id = 'notif-gate-styles';
  s.textContent = `
    #notif-gate-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(7,9,20,0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      padding: 16px;
      box-sizing: border-box;
      overflow-y: auto;
    }
    #notif-gate-box {
      position: relative;
      width: 100%;
      max-width: 360px;
      background: linear-gradient(160deg,#13131f 0%,#0f0f1e 100%);
      border: 1px solid rgba(255,255,255,0.1);
      color: #e6eef8;
      padding: 24px 20px 20px;
      border-radius: 18px;
      text-align: center;
      font-family: Inter, system-ui, Arial, sans-serif;
      box-shadow: 0 24px 60px rgba(0,0,0,0.6);
      box-sizing: border-box;
    }
    #notif-gate-box .ng-close {
      position: absolute;
      top: 10px; right: 10px;
      width: 28px; height: 28px;
      border-radius: 8px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.45);
      font-size: 14px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    #notif-gate-box .ng-icon {
      width: 48px; height: 48px;
      border-radius: 12px;
      background: rgba(108,99,255,0.18);
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px;
    }
    #notif-gate-box .ng-title {
      font-size: 17px;
      font-weight: 700;
      margin: 0 0 6px;
      color: #fff;
      letter-spacing: -0.3px;
    }
    #notif-gate-msg {
      color: #94a3b8;
      margin: 0 0 16px;
      font-size: 12px;
      line-height: 1.5;
    }
    #notif-gate-enable-btn {
      width: 100%;
      padding: 12px 16px;
      background: linear-gradient(135deg,#6c63ff,#4f46e5);
      color: #fff;
      border: none;
      border-radius: 11px;
      cursor: pointer;
      font-weight: 700;
      font-size: 13px;
      box-shadow: 0 4px 16px rgba(108,99,255,0.35);
      margin-bottom: 8px;
      display: block;
      min-height: 44px;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
      transition: opacity 0.2s;
    }
    #notif-gate-skip-btn {
      width: 100%;
      padding: 9px;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 9px;
      color: rgba(255,255,255,0.35);
      font-size: 11px;
      cursor: pointer;
      min-height: 38px;
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    /* Compact further on very small phones */
    @media (max-width: 380px) {
      #notif-gate-box {
        padding: 20px 14px 16px;
        border-radius: 16px;
      }
      #notif-gate-box .ng-icon { width: 40px; height: 40px; margin-bottom: 10px; }
      #notif-gate-box .ng-title { font-size: 15px; }
      #notif-gate-msg { font-size: 11px; margin-bottom: 12px; }
    }
  `;
  document.head.appendChild(s);
}

function createGateOverlay(msg) {
  if (document.getElementById('notif-gate-overlay')) return;
  injectGateStyles();

  const overlay = document.createElement('div');
  overlay.id = 'notif-gate-overlay';

  const box = document.createElement('div');
  box.id = 'notif-gate-box';

  // ── Close button (top-right) ──
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ng-close';
  closeBtn.title = 'Close and continue without notifications';
  closeBtn.innerHTML = '✕';
  closeBtn.onclick = () => {
    removeGateOverlay();
    window.notificationsAllowed = false;
  };

  // ── Bell icon ──
  const icon = document.createElement('div');
  icon.className = 'ng-icon';
  icon.innerHTML = '<svg width="28" height="28" fill="none" stroke="#a78bfa" stroke-width="1.8" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>';

  // ── Title ──
  const title = document.createElement('h2');
  title.className = 'ng-title';
  title.textContent = 'Enable Notifications';

  // ── Description ──
  const desc = document.createElement('p');
  desc.id = 'notif-gate-msg';
  desc.textContent = msg || 'Allow browser notifications to receive real-time alerts, clock-in reminders, and important updates from your admin.';

  // ── Primary enable button ──
  const enableBtn = document.createElement('button');
  enableBtn.id = 'notif-gate-enable-btn';
  enableBtn.textContent = '🔔 Enable Notifications';
  enableBtn.onclick = async () => {
    enableBtn.textContent = 'Requesting…';
    enableBtn.disabled = true;
    try {
      if (typeof window.enableNotifications === 'function') {
        await window.enableNotifications();
      } else {
        const result = await Notification.requestPermission();
        if (result === 'granted') { unlockGate(); }
        else { enableBtn.textContent = '🔔 Enable Notifications'; enableBtn.disabled = false; updateGateForDenied(); }
      }
    } catch(e) {
      enableBtn.textContent = '🔔 Enable Notifications';
      enableBtn.disabled = false;
    }
  };

  // ── "Skip for now" link ──
  const skipBtn = document.createElement('button');
  skipBtn.id = 'notif-gate-skip-btn';
  skipBtn.textContent = 'Skip for now — continue without notifications';
  skipBtn.onclick = () => {
    removeGateOverlay();
    window.notificationsAllowed = false;
  };

  box.appendChild(closeBtn);
  box.appendChild(icon);
  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(enableBtn);
  box.appendChild(skipBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function updateGateForDenied() {
  const msgEl = document.getElementById('notif-gate-msg');
  const btnEl = document.getElementById('notif-gate-enable-btn');
  const helpEl = document.getElementById('notif-gate-help');
  if (msgEl) msgEl.textContent = 'Notifications are blocked in your browser. Follow the tutorial below to enable them, or close this popup to continue without notifications.';
  if (btnEl) {
    btnEl.textContent = '⚙️ How to Enable — See Tutorial Below';
    btnEl.disabled = false;
    btnEl.style.background = 'rgba(245,158,11,0.18)';
    btnEl.style.boxShadow = 'none';
    btnEl.style.border = '1px solid rgba(245,158,11,0.35)';
    btnEl.style.color = '#fbbf24';
    btnEl.onclick = () => showTutorialModal();
  }
  if (helpEl) helpEl.textContent = 'Click the 🔒 lock icon in your browser\'s address bar → Site settings → Notifications → Allow, then reload the page.';
}

function showTutorialModal() {
  try {
    const src = 'images/notification.jpg';
    // don't proceed if image not available
    const probe = new Image();
    probe.onload = () => {
      openImageModal(src);
    };
    probe.onerror = () => { console.warn('Tutorial image not found:', src); };
    probe.src = src;
    return;
  } catch (e) { console.warn(e); }
}

function openImageModal(src) {
  const mid = 'notif-tutorial-modal';
  let m = document.getElementById(mid);
  if (m) m.remove();
  m = document.createElement('div');
  m.id = mid;
  m.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);z-index:100000;padding:20px';
  const box = document.createElement('div');
  box.style.cssText = 'max-width:900px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;background:#0f1724;padding:12px;border:1px solid rgba(255,255,255,0.06)';
  const large = document.createElement('img');
  large.src = src;
  large.style.cssText = 'width:100%;height:auto;display:block;border-radius:8px';
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'margin-top:10px;padding:8px 12px;border-radius:8px;background:transparent;border:1px solid rgba(255,255,255,0.08);color:#e6eef8;cursor:pointer';
  close.onclick = () => { m.remove(); };
  box.appendChild(large);
  box.appendChild(close);
  m.appendChild(box);
  document.body.appendChild(m);
}
// Public helper: show the non-blocking notification prompt (call before specific actions)
window.showNotificationPrompt = function showNotificationPrompt(msg) {
  try {
    createGateOverlay(msg);
  } catch (e) { console.warn(e); }
};

// Auto-show prompt when user performs actions that require notifications.
// Add `data-requires-notif` attribute to buttons/links to trigger the prompt when permission not granted.
document.addEventListener('click', function (e) {
  try {
    if (Notification.permission === 'granted') return;
    let el = e.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-requires-notif') != null) {
        createGateOverlay();
        return;
      }
      el = el.parentElement;
    }
  } catch (err) { /* ignore */ }
});

function showDeniedMessage(container) {
  container.querySelector('p').textContent = 'Notifications are blocked. Open browser site settings to allow notifications for this site.';
}

function showInstructions(container) {
  container.querySelector('p').textContent = 'Open your browser settings (lock icon near address bar) → Site settings → Notifications → Allow. Then reload the page.';
}

function unlockGate() {
  const o = document.getElementById('notif-gate-overlay');
  if (o) o.remove();
  window.notificationsAllowed = true;
  window.dispatchEvent(new CustomEvent('notifications:granted'));
}

/**
 * Public helper to trigger permission request, register service worker
 * and subscribe the current user to push (if logged in).
 */
window.enableNotifications = async function enableNotifications() {
  try {
    if (!('Notification' in window)) {
      alert('Notifications are not supported by this browser.');
      return;
    }

    // Register service worker if available
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('sw.js');
      } catch (e) {
        // ignore registration error — we'll try when needed
      }
    }

    const p = await Notification.requestPermission();
    if (p === 'granted') {
      unlockGate();

      // Try to subscribe using Supabase client and stored profile
      try {
        const user = JSON.parse(localStorage.getItem('office_hub_user') || '{}');
        if (user && user.id && typeof subscribeToPush === 'function' && window.sb) {
          const companyId = user.company_id || user.companies?.id || user.companies?.company_id || null;
          subscribeToPush(window.sb, user.id, companyId);
        }
      } catch (e) {
        console.warn('[push-helper] auto-subscribe failed', e);
      }
      // notify listeners
      window.dispatchEvent(new CustomEvent('notifications:granted'));
    } else if (p === 'denied') {
      alert('Notifications are blocked. Please enable them in your browser site settings.');
    }
  } catch (err) {
    console.warn('[push-helper] enableNotifications error', err);
  }
};

