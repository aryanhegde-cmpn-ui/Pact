/**
 * Generates a VAPID key pair for web push.
 *
 *   npm run vapid:generate
 *
 * Prints the two variables to paste into .env.local and the Vercel project.
 * Run once. Rotating the keys invalidates every existing subscription, and
 * every device has to re-subscribe -- silently, because the push service will
 * simply start rejecting sends.
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('');
console.log('VAPID key pair generated. Add these to .env.local and to Vercel:');
console.log('');
console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY="${keys.publicKey}"`);
console.log(`VAPID_PRIVATE_KEY="${keys.privateKey}"`);
console.log('VAPID_SUBJECT="mailto:you@example.com"');
console.log('');
console.log('The PRIVATE key is a secret and must never reach the browser.');
console.log('The PUBLIC key is meant to ship: the browser needs it to subscribe.');
console.log('');
console.log('Rotating these invalidates every existing subscription, and devices');
console.log('re-subscribe silently rather than reporting an error, so do it once.');
console.log('');
