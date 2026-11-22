
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(
    "/etc/secrets/firebase-service-account.json"
  ),
});

const db = admin.firestore();

async function updateExpiredMoments() {
  const now = admin.firestore.Timestamp.now();
  let totalUpdated = 0;

  console.log("Starting Vowce Moment expiration task...");

  while (true) {
    const snapshot = await db
      .collection("moments")
      .where("isExpired", "==", false)
      .where("expiresAt", "<=", now)
      .limit(500)
      .get();

    if (snapshot.empty) break;

    const batch = db.batch();

    for (const doc of snapshot.docs) {
      batch.update(doc.ref, {
        isExpired: true,
      });
    }

    await batch.commit();

    totalUpdated += snapshot.size;

    console.log(`Updated ${snapshot.size} expired Moments.`);
  }

  console.log(`Finished. Total updated: ${totalUpdated}`);
}

updateExpiredMoments()
  .then(() => {
    console.log("Moment expiration task completed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Moment expiration task failed:", error);
    process.exit(1);
  });
