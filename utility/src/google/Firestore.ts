import * as admin from 'firebase-admin';

const fireStore = admin.initializeApp().firestore();

export { fireStore }