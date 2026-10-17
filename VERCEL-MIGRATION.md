# Vercel and Neon migration

The application changes are prepared for deployment from `sollylovessolly/pbs-frontend` and `sollylovessolly/PBS-BE`. Existing Render and Supabase services have not been removed. See the final chat handoff for the current deployment URLs and status.

## Completed account changes

- Existing Neon project: `polaroidsbysolly` (`aged-term-86120063`). Its current region supports Object Storage.
- Private bucket `production-files` created on production branch `br-rough-cherry-aubj6e74`.
- Named storage credential saved in the ignored backend `.env`; no storage credentials are exposed to the frontend or committed.
- Gallery/review and shared rate-limit migrations applied after testing them on the isolated `vercel-migration-check-20261017` branch.
- Existing production order/customer data is retained.

## Application changes

- Vercel configuration added to both repositories. NestJS uses its native Vercel framework support and `src/main.ts` entrypoint.
- Set `NEXT_PUBLIC_DIRECT_UPLOADS=true` in the frontend. Production artwork, gallery uploads and review photos then upload directly into private Neon storage using expiring, signed POST policies. Those policies bind the exact key, MIME type and file size. Backend finalization verifies the signed claim, file size and SHA-256 hash, then applies the existing file/purpose/image validation.
- Browser progress and retry remain supported. No storage account key reaches the browser.
- File downloads authorize through the API and redirect to short-lived signed storage URLs, avoiding large file bodies through Vercel.
- Legacy Render artwork references in API responses are translated to the configured new API origin. The opaque file token and object key stay unchanged. The corresponding old file must be copied into Neon before its new download works.
- In-process gallery cleanup is disabled on Vercel. An authenticated daily cron cleans gallery orphans, temporary upload files and expired rate-limit entries. `CRON_SECRET` must match the Vercel environment value.
- Vercel uses the pooled `DATABASE_URL` with a two-connection pool per instance; migrations use `DIRECT_URL`. Rate-limit counters are atomic and shared through PostgreSQL.
- Production builds reject missing frontend API/upload configuration; backend startup validates the Vercel storage, public URL and cron settings.
- Compatible backend dependency updates remove the high/critical advisories reported by the initial audit. Some moderate transitive advisories still require separate dependency upgrades; no forced major upgrades were applied.

## Dashboard steps

1. Publish the updated working source to the renamed GitHub repositories. Both repositories contained local work before this migration; the intended current application includes the new gallery/review modules. The assistant is preparing commits and preserving both frontend branch histories for this publication.
2. Open [Vercel New Project](https://vercel.com/new). Import `sollylovessolly/PBS-BE` for the backend. Use framework **NestJS**, root directory **./**, and Node.js **24.x**. `vercel.json` supplies the build command. Choose the project name and note its production domain.
3. Select the existing `polaroids-by-solly` frontend project and connect `sollylovessolly/pbs-frontend`. Use framework **Next.js**, root directory **./**, and Node.js **24.x**. Preserve its existing production domain (or custom domain).
4. Once both exact domains are known, run the command below from `polaroidsbysolly-api`, replacing the example domains. The assistant can do this when you provide the two URLs. Avoid a trailing slash and do not include `/api` in either argument.

   ```bash
   npm run vercel:env -- --frontend https://your-frontend.vercel.app --api https://your-backend.vercel.app
   ```

   This writes **backend `.env.vercel`** and **frontend `../polaroidsbysolly/.env.vercel`**, both ignored by Git. The prepared files currently contain explicit `replace-with-...` URL placeholders; replace those by regenerating before importing. They contain private credentials: do not commit them, post them in chat, or send them to anyone.

5. In each project's Vercel Environment Variables settings, import the corresponding `.env.vercel` into **Production**. Add backend `PAYSTACK_SECRET_KEY` directly from the existing Render environment; it was absent locally. Also copy any Render-only shipping/notification settings you still use. Do not import the raw backend `.env`, which includes local URLs and bootstrap values.
6. Confirm frontend `NEXT_PUBLIC_PAYSTACK_TEST_MODE=true` for a backend `sk_test_...` key, or `false` for `sk_live_...`. The environment generator defaults to test when the local secret is absent, so match this manually to the key you add in Vercel.
7. Configure storage CORS for the actual storefront/admin domain. From the backend folder, set `FRONTEND_URL` and `ADMIN_FRONTEND_URL` to that domain for the `npm run storage:configure` command. The assistant can do this; only localhost origins are configured until the production URL is supplied. For an additional custom domain, use `ADDITIONAL_FRONTEND_ORIGINS` on the backend and when running storage configuration.
8. Deploy the backend, then deploy/redeploy the frontend. Next.js embeds public variables during build; changing them requires a rebuild. Keep production API routes reachable from the storefront and Paystack, with admin access protected by the application login.
9. In Paystack, set the webhook URL to `https://your-backend.vercel.app/api/payments/webhook` and the callback to `https://your-frontend.vercel.app/payments/callback`. Use the same test/live mode as the deployed secret.
10. Send the deployed URLs back for read-only health, catalogue, media and CORS verification. A controlled Paystack test payment still requires the real test credentials/provider flow.

Do not select a paid plan or enable usage upgrades as part of these steps. No paid subscription or billing upgrade was created by this migration.

## Old files and cutover

Supabase was paused and the owner resumed it. The full storage migration then copied all 14 existing files into Neon and verified their SHA-256 checksums. A separate check confirmed that all 13 unique order-artwork references have matching objects in Neon. Supabase originals and existing database references were retained.

The migration tools preserve the originals and refuse to overwrite a destination object with different bytes:

```bash
# Inventory only
npm run storage:migrate

# Copy every source bucket file and verify SHA-256 after download from Neon
npm run storage:migrate -- --apply

# Alternative: copy files referenced by orders through their existing Render download links
npm run storage:recover-orders -- --apply
```

The order-only recovery cannot discover abandoned uploads or files referenced solely by a customer's saved cart. A complete Supabase copy is needed to preserve those too. Keep Render/Supabase available until the source file inventory and download checks are resolved. Existing order references are not rewritten in the database by the deployment; the API response adapter handles the hostname transition. `storage:update-urls` is an optional dry-run-first persistence tool, only for after file-copy verification.

## Verification commands

```bash
npm run build:vercel
npm test -- --runInBand
npx eslint "{src,apps,libs,test}/**/*.ts" scripts/*.ts
npm run db:verify
npm run storage:verify
```

`db:verify` rolls back its temporary counter writes. `storage:verify` creates and removes one disposable object, checks exact upload-size enforcement, and confirms anonymous reads are denied. `verify:vercel` starts the built backend against the isolated branch stored in ignored `.env.migration-test`, verifies browser preflights, the direct upload/finalization/download path, gallery/review reads and unsigned-cron rejection, and removes its disposable files.

Frontend validation:

```bash
npm test
npm run typecheck
npm run lint
NEXT_PUBLIC_DIRECT_UPLOADS=false npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e
```

Verification results: 20 frontend unit tests, 129 backend unit tests, and 54 browser regression tests passed. Both production builds, TypeScript and lint checks passed. A separate production build with direct uploads enabled passed a Chrome test using a 4.8 MB photo: the file body went to storage while the review API received only a small JSON token request. The isolated API/storage verification also passed with real Neon storage, pooled database access and browser CORS preflights.

The existing browser regression suite mocks backend/provider replies and tests the standard multipart transport. New frontend transport tests and the extra browser test exercise the direct-upload path; the isolated API/storage verification exercises real Neon storage and database behavior. Successful mocked payment tests are not evidence of live payment settlement. To rerun the extra browser test after a build with `NEXT_PUBLIC_DIRECT_UPLOADS=true`, use `PBS_DIRECT_UPLOAD_TEST=true PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/direct-upload.spec.ts`.

The temporary Neon verification branch is retained. It has a small compute endpoint under the existing free account and follows that account's automatic suspend policy. It is not used by the production app.

## Official deployment references

- [NestJS on Vercel](https://vercel.com/docs/frameworks/backend/nestjs)
- [Neon Object Storage authentication](https://neon.com/docs/storage/authentication)
- [Neon S3 compatibility and browser upload/CORS support](https://neon.com/docs/storage/s3-compatibility)
- [Vercel cron scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
