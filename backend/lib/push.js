// Web Push helper. Initializes web-push with VAPID keys from env and exposes
// sendPushToUser(userName, payload) — looks up every subscription for that
// user (one per device) and fires a push to each. Failed endpoints with
// status 404/410 are pruned automatically (means the user unsubscribed at the
// browser level).

const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:no-reply@mayvel.local';
  if (!pub || !priv) {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push disabled');
    return;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  console.log('[push] web-push configured');
}
configure();

async function sendPushToUser(userName, payload) {
  if (!configured) return { sent: 0, pruned: 0 };
  if (!userName) return { sent: 0, pruned: 0 };

  const subs = await PushSubscription.find({ userId: userName }).lean();
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let pruned = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: s.keys,
      }, body);
      sent++;
    } catch (err) {
      // 404 / 410 → subscription gone for good, drop it
      if (err.statusCode === 404 || err.statusCode === 410) {
        await PushSubscription.deleteOne({ endpoint: s.endpoint });
        pruned++;
      } else {
        console.error('[push] send failed:', err.statusCode || err.message);
      }
    }
  }));

  return { sent, pruned };
}

module.exports = { sendPushToUser };
