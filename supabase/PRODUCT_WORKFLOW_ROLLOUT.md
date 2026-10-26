# Product workflow and trash cleanup

## Rollout order

1. Apply `supabase/migrations/20261024213000_product_workflow_trash.sql` in the Catálogo Supabase project.
2. Deploy the Edge Function `catalog-trash-cleanup` from `supabase/functions/catalog-trash-cleanup/index.ts` with JWT verification disabled. The function authenticates every request with the private `x-cron-secret` header, so it must never be deployed without the `CATALOG_TRASH_CLEANUP_SECRET` secret configured.
3. In Edge Function Secrets, set:
   - `CATALOG_TRASH_CLEANUP_SECRET`: a long random secret.
   - `CATALOG_STORAGE_BUCKET`: `product-images` (optional; this is the default).
   Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Edge Function environment; never expose the service-role key to the browser.
4. In Supabase Vault, create:
   - `cat_logo_project_url`: the Catálogo project URL.
   - `cat_logo_cleanup_secret`: exactly the same secret as `CATALOG_TRASH_CLEANUP_SECRET`.
5. Run `supabase/setup_catalog_trash_cron.sql` in the Catálogo SQL Editor. The script removes the old `catlogo-cleanup-expired-trash-daily` schedule before enabling the secret-authenticated job, avoiding duplicate cleanup runs.
6. Verify that only `cat-logo-trash-cleanup` remains active in the Cron Jobs screen. Test the Edge Function manually with its secret only in a secure request header; never include the secret in a URL or commit it to this repository.

## Behavior

- Products start as `unpublished` when saved complete without publishing.
- `draft` allows incomplete `name`, `category`, and `availability`.
- `published` remains synchronized with `is_published`, preserving existing public catalog queries.
- `is_exclusive` is independent of publication state.
- Trash stores `deleted_at` and `deleted_from_status`; the UI only offers recovery within 15 days.
- The cleanup function claims only expired trash rows. It removes Storage files only under the product's own UUID folder. If Storage removal fails, it returns the row to trash and retries on a later run. If database deletion fails after storage cleanup, the row remains in `deleting` for a later retry.
- `catalog_events.product_id ON DELETE SET NULL` preserves historical analytics.
