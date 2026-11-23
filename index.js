const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Init Firebase Admin
// On Render we will put the service account key in env var FIREBASE_SERVICE_ACCOUNT
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  // For local test, uses file serviceAccountKey.json if it exists
  try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.log('No service account yet, waiting for env var');
    admin.initializeApp();
  }
}

const db = admin.firestore();

// Health check - to test if Render is alive
app.get('/', (req, res) => {
  res.send('Fapshi webhook is running!');
});

// Fapshi webhook
app.post('/fapshi-webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body));
    const data = req.body;

    // Fapshi sends different field names, check them all
    const status = (data.status || data.transactionStatus || data.paymentStatus || '').toString().toLowerCase();
    const transId = data.transId || data.transactionId || data.trans_id || data.id;
    
    // User ID - Fapshi lets you send it as externalId / userId / metadata
    const userId = data.externalId || data.userId || data.user_id || data.metadata?.userId || data.metadata?.uid || data.customData?.userId;

    console.log('Status:', status, 'TransId:', transId, 'UserId:', userId);

    if (!userId) {
      console.log('No userId found, cannot mark as paid');
      return res.status(200).send('OK - no userId');
    }

    // Only mark as paid if successful
    if (status === 'successful' || status === 'success' || status === 'completed' || status === 'paid') {
      // 1. Set custom claim - this is what your app checks
      await admin.auth().setCustomUserClaims(userId, { has_paid_fee: true });
      console.log('Custom claim set for', userId);

      // 2. Update Firestore user doc
      await db.collection('users').doc(userId).set({
        has_paid_fee: true,
        paymentStatus: 'paid',
        lastPaymentTransId: transId || null,
        lastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log('Firestore updated for', userId);
    } else {
      console.log('Payment not successful, ignoring:', status);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('OK'); // Always return 200 so Fapshi does not retry forever
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
