import { parse } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const frontend = option('--frontend');
const api = option('--api');
if (
  !frontend ||
  !api ||
  !frontend.startsWith('https://') ||
  !api.startsWith('https://')
)
  throw new Error(
    'Pass --frontend https://YOUR-FRONTEND and --api https://YOUR-BACKEND',
  );
for (const url of [frontend, api])
  if (new URL(url).origin !== url)
    throw new Error(
      'Use exact HTTPS origins, without paths or trailing slashes',
    );
const local = parse(readFileSync('.env'));
const previous = (() => {
  try {
    return parse(readFileSync('.env.vercel'));
  } catch {
    return {};
  }
})();
const allowed = [
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'JWT_EXPIRES_IN_SECONDS',
  'ADMIN_EMAIL',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_BASE_URL',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'OWNER_NOTIFICATION_EMAIL',
  'DISCORD_WEBHOOK_URL',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_OWNER_CHAT_ID',
  'TERMII_API_KEY',
  'TERMII_SENDER_ID',
  'TERMII_CHANNEL',
  'SMS_OWNER_PHONE',
  'WHATSAPP_PROVIDER',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_OWNER_PHONE',
  'WHATSAPP_API_VERSION',
  'SHIPBUBBLE_API_KEY',
  'SHIPBUBBLE_BASE_URL',
  'SHIPBUBBLE_SENDER_ADDRESS_CODE',
  'SHIPBUBBLE_CATEGORY_ID',
  'SHIPBUBBLE_DEFAULT_UNIT_WEIGHT_KG',
  'SHIPBUBBLE_PACKAGE_LENGTH_CM',
  'SHIPBUBBLE_PACKAGE_WIDTH_CM',
  'SHIPBUBBLE_PACKAGE_HEIGHT_CM',
  'AWS_ENDPOINT_URL_S3',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'NEON_STORAGE_BUCKET',
];
const backend: Record<string, string> = Object.fromEntries(
  allowed.flatMap((key) =>
    local[key] || previous[key] ? [[key, local[key] || previous[key]]] : [],
  ),
);
Object.assign(backend, {
  NODE_ENV: 'production',
  STORAGE_PROVIDER: 'neon',
  FRONTEND_URL: frontend,
  ADMIN_FRONTEND_URL: frontend,
  PUBLIC_API_URL: api,
  CRON_SECRET: previous.CRON_SECRET || randomBytes(32).toString('hex'),
});
const format = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n') + '\n';
writeFileSync('.env.vercel', format(backend), { mode: 0o600 });
const frontendFile = resolve('../polaroidsbysolly/.env.vercel');
const frontendLocal = parse(readFileSync('../polaroidsbysolly/.env.local'));
const frontendValues = {
  ...Object.fromEntries(
    Object.entries(frontendLocal).filter(([key]) =>
      key.startsWith('NEXT_PUBLIC_'),
    ),
  ),
  NEXT_PUBLIC_API_URL: `${api}/api`,
  NEXT_PUBLIC_DIRECT_UPLOADS: 'true',
  NEXT_PUBLIC_PAYSTACK_TEST_MODE: backend.PAYSTACK_SECRET_KEY?.startsWith(
    'sk_live_',
  )
    ? 'false'
    : 'true',
};
writeFileSync(frontendFile, format(frontendValues), { mode: 0o600 });
console.log(
  'Prepared ignored backend/frontend .env.vercel files for dashboard import.',
);
if (!backend.PAYSTACK_SECRET_KEY)
  console.log(
    'Required manual value: PAYSTACK_SECRET_KEY. Copy it from Render into Vercel; never paste it into chat.',
  );
console.log(
  'Copy any additional production-only provider settings from Render, then match frontend Paystack test mode.',
);
