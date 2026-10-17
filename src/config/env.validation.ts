export function validateEnvironment(values: Record<string, unknown>) {
  if (values.NODE_ENV !== 'production') return values;
  const required = [
    'DATABASE_URL',
    'DIRECT_URL',
    'JWT_SECRET',
    'FRONTEND_URL',
    'PAYSTACK_SECRET_KEY',
  ];
  const read = (name: string) =>
    typeof values[name] === 'string' ? values[name].trim() : '';
  const missing = required.filter((name) => !read(name));
  if (missing.length)
    throw new Error(
      `Missing required production configuration: ${missing.join(', ')}`,
    );
  if (read('JWT_SECRET').length < 32)
    throw new Error('JWT_SECRET must contain at least 32 characters');
  if (read('VERCEL')) {
    for (const name of [
      'PUBLIC_API_URL',
      'CRON_SECRET',
      'STORAGE_PROVIDER',
      'AWS_ENDPOINT_URL_S3',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
    ])
      if (!read(name))
        throw new Error(`Missing required Vercel configuration: ${name}`);
    if (read('STORAGE_PROVIDER') !== 'neon')
      throw new Error('Vercel deployment requires Neon file storage');
    if (read('CRON_SECRET').length < 32)
      throw new Error('CRON_SECRET must contain at least 32 characters');
    if (new URL(read('PUBLIC_API_URL')).protocol !== 'https:')
      throw new Error('PUBLIC_API_URL must use HTTPS');
    if (!new URL(read('DATABASE_URL')).hostname.includes('-pooler.'))
      throw new Error('Vercel requires the pooled Neon DATABASE_URL');
  }
  for (const name of ['FRONTEND_URL', 'ADMIN_FRONTEND_URL']) {
    const configured = read(name);
    if (configured) {
      const url = new URL(configured);
      if (url.protocol !== 'https:' && url.hostname !== 'localhost')
        throw new Error(`${name} must use HTTPS in production`);
    }
  }
  return values;
}
