const express = require('express');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(
    '/etc/secrets/firebase-service-account.json'
  ),
});

const app = express();
app.use(express.json());

// ============================================================
// 1. EXISTING: SEND MAGIC LINK (unchanged)
// ============================================================
app.post('/send-magic-link', async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string' || email.trim() === '') {
    return res.status(400).send('Email is required');
  }

  const cleanEmail = email.trim().toLowerCase();

  // 1. Generate the Firebase sign-in link
  let link;
  try {
    link = await admin.auth().generateSignInWithEmailLink(cleanEmail, {
      url: `https://vowceapp.com/magic-login?email=${encodeURIComponent(cleanEmail)}`,
      handleCodeInApp: true,
      iOS: {
        bundleId: 'com.example.mixture3_app',
      },
      android: {
        packageName: 'com.example.mixture3_app',
        installApp: true,
        minimumVersion: '21',
      },
    });
  } catch (err) {
    console.error('❌ Failed to generate sign-in link:', err);
    return res.status(500).send('Failed to generate sign-in link: ' + err.message);
  }

  // 2. Read Resend API key
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).send('Resend API key not configured in environment');
  }

  // 3. Build the HTML email
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); overflow: hidden;">
    
    <!-- Black Banner -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #000000; height: 70px;">
      <tr>
        <td style="padding-left: 30px; vertical-align: middle;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align: middle; padding-right: 12px;">
                <img src="https://raw.githubusercontent.com/jeremiahsanya-bit/vowce-mail-server-pure/main/vowce_icon.svg" 
                     alt="VowceApp" 
                     width="32" 
                     height="32" 
                     style="display: block; width: 32px; height: 32px; object-fit: contain;">
              </td>
              <td style="vertical-align: middle;">
                <span style="color: #ffffff; font-size: 16px; font-weight: 500; letter-spacing: 0.3px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1;">
                  Vowce
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    
    <div style="padding: 40px;">
      <h2 style="color: #222222; font-size: 22px; margin-bottom: 16px; text-align: center;">Welcome back to VowceApp! 👋</h2>
      
      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin-bottom: 24px; text-align: center;">
        You're one click away from accessing your account. Click the button below to log in securely:
      </p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${link}" 
           style="background-color: #000000; color: #ffffff; padding: 14px 40px; 
                  border-radius: 50px; text-decoration: none; font-weight: 600; 
                  font-size: 16px; display: inline-block; border: 1px solid #ffffff;">
          🔐 Log in to VowceApp
        </a>
      </div>
      
      <p style="color: #888888; font-size: 12px; text-align: center; margin-top: 10px;">
        ⚠️ If the app doesn't open, make sure VowceApp is installed on your device.
      </p>
      
      <p style="color: #888888; font-size: 13px; line-height: 1.5; margin-top: 20px; text-align: center;">
        This link is secure and will expire after one use.<br>
        If you didn't request this email, you can safely ignore it.
      </p>
      
      <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px; text-align: center; color: #aaaaaa; font-size: 12px;">
        &copy; 2026 VowceApp Network &bull; Built with ❤️
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  // 4. Send via Resend
  try {
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'VowceApp <noreply@vowceapp.com>',
        to: [cleanEmail],
        subject: 'Your magic link to log in to Vowce',
        html: html,
      }),
    });

    if (resendResponse.status === 200) {
      return res.status(200).send('Magic link sent successfully');
    } else {
      const body = await resendResponse.text();
      console.error('❌ Resend error:', body);
      return res.status(500).send('Resend API error: ' + body);
    }
  } catch (err) {
    console.error('❌ Resend request failed:', err);
    return res.status(500).send('Resend request failed: ' + err.message);
  }
});

// ============================================================
// 2. NEW: ACCOUNT RECOVERY — SIGN IN WITH CODE
// ============================================================
// Rate limiting (in-memory; resets on server restart)
const rateLimitMap = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(identifier) {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true };
}

app.post('/recover', async (req, res) => {
  try {
    const { identifier, codeHash } = req.body || {};

    if (!identifier || !codeHash) {
      return res.status(400).json({
        error: 'Missing identifier or codeHash',
      });
    }

    const cleanIdentifier = String(identifier).trim().toLowerCase();
    const cleanHash = String(codeHash).trim().toLowerCase();

    // ---- Rate limit ----
    const rl = checkRateLimit(cleanIdentifier);
    if (!rl.allowed) {
      const minutes = Math.ceil(rl.retryAfterMs / 60000);
      return res.status(429).json({
        error: `Too many attempts. Try again in ${minutes} minute(s).`,
      });
    }

    const db = admin.firestore();

    // ---- Find user by email OR username ----
    let userDoc = null;

    const byEmail = await db
      .collection('users')
      .where('email', '==', cleanIdentifier)
      .limit(1)
      .get();

    if (!byEmail.empty) {
      userDoc = byEmail.docs[0];
    } else {
      const byUsername = await db
        .collection('users')
        .where('username', '==', cleanIdentifier)
        .limit(1)
        .get();
      if (!byUsername.empty) userDoc = byUsername.docs[0];
    }

    if (!userDoc) {
      return res.status(404).json({
        error: 'No account found with that username or email.',
      });
    }

    const uid = userDoc.id;

    // ---- Atomic: verify + mark used ----
    let remaining = 0;
    let failedReason = null;

    await db.runTransaction(async (tx) => {
      const freshDoc = await tx.get(userDoc.ref);
      if (!freshDoc.exists) {
        failedReason = 'User no longer exists.';
        return;
      }

      const data = freshDoc.data() || {};
      const codes = Array.isArray(data.recoveryCodes)
        ? data.recoveryCodes
        : [];

      if (codes.length === 0) {
        failedReason = 'No recovery codes set up for this account.';
        return;
      }

      let matchIndex = -1;
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i] || {};
        if (
          c.used !== true &&
          String(c.hash || '').toLowerCase() === cleanHash
        ) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex === -1) {
        let wasUsed = false;
        for (const c of codes) {
          if (
            String(c.hash || '').toLowerCase() === cleanHash &&
            c.used === true
          ) {
            wasUsed = true;
            break;
          }
        }
        failedReason = wasUsed
          ? 'This code has already been used.'
          : 'Invalid recovery code.';
        return;
      }

      codes[matchIndex] = {
        ...codes[matchIndex],
        used: true,
        usedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      remaining = codes.filter((c) => c.used !== true).length;

      tx.update(userDoc.ref, {
        recoveryCodes: codes,
        recoveryCodesRemaining: remaining,
        lastRecoveryCodeUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    if (failedReason) {
      return res.status(401).json({ error: failedReason });
    }

    // ---- Create custom token ----
    const customToken = await admin.auth().createCustomToken(uid);

    return res.json({
      token: customToken,
      remaining,
      uid,
    });
  } catch (err) {
    console.error('❌ Recovery error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ============================================================
// 3. NEW: ACCOUNT RECOVERY — GENERATE CODES (signed-in user)
// ============================================================
app.post('/generate-codes', async (req, res) => {
  try {
    const { idToken, hashedCodes } = req.body || {};

    if (!idToken || !Array.isArray(hashedCodes)) {
      return res.status(400).json({ error: 'Missing idToken or hashedCodes' });
    }

    if (hashedCodes.length !== 10) {
      return res.status(400).json({ error: 'Expected exactly 10 codes' });
    }

    // Verify the user is actually signed in
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const cleaned = hashedCodes.map((c) => ({
      hash: String(c.hash || '').toLowerCase(),
      used: false,
      usedAt: null,
    }));

    if (cleaned.some((c) => !c.hash)) {
      return res.status(400).json({ error: 'Invalid code hash' });
    }

    const db = admin.firestore();

    await db.collection('users').doc(uid).set(
      {
        recoveryCodes: cleaned,
        recoveryCodesRemaining: 10,
        recoveryCodesGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.json({ success: true, remaining: 10 });
  } catch (err) {
    console.error('❌ Generate codes error:', err);
    return res.status(401).json({ error: 'Unauthorized or server error.' });
  }
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Admin server running on port ${PORT}`);
});
