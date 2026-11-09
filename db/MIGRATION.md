# JB Collections — Supabase to Neon + R2 migration

## Isolation boundaries
- GitHub repo: `JASBH121101/Cat-logo`
- Implementation branch: `migration/neon-r2`
- Neon project: `jb-collections-test` (`wispy-forest-84396726`)
- Neon development branch: `migration-neon-r2` (`br-nameless-lake-be7inmgh`)
- Cloudflare Pages: `jb-collections` / `jb-collections.pages.dev`
- R2 bucket: `jb-collections`

The separate `erp-perfume` Pages project, `erp-perfume` Neon project, and `erp-perfume-assets` R2 bucket are explicitly out of scope.

## Source inventory verified
- 11 public tables. Product variants are embedded in `products.variants` JSONB (147 nested variants), not a separate table.
- Products: 66 (42 technology, 24 perfumery).
- Other non-empty tables: `catalog_events` 106, `perfume_details` 24, `color_library` 45, `product_provider_status` 13, `product_provider_review_history` 15, `admin_users` 1, `admin_push_subscriptions` 1.
- `commission_records`, `private_chat_conversations`, and `private_chat_messages` are currently empty.
- Supabase Storage `product-images`: 568 objects / 89.31 MB. The remaining 100 not directly referenced from product image URLs must still be preserved until independently accounted for.

## Migration sequence
1. Schema baseline on isolated Neon branch.
2. Backend adapters and API endpoints; authorization stays server-side.
3. Auth migration and admin identity mapping.
4. R2 transfer with per-object size/hash verification.
5. Data import in dependency order with row counts and referential-integrity checks.
6. Functional/security regression tests.
7. Production cutover only after explicit approval.

## Security and retention constraints
- Never expose a Neon connection string or privileged database role to browser code.
- Preserve the published-only public catalog behavior and admin-only operations.
- Keep chat payload screening, one-time invitation and hashed session tokens, 30-minute session expiry, 10-minute decline deletion, and 7-day message retention.
- Preserve 15-day soft-trash retention and retry behavior if an R2 object deletion fails.
- Do not run cleanup against production during the migration.

## Cost guardrails
- Use the existing free-tier resources only.
- Neon migration compute minimum: 0.25 CU. The inherited suspend interval cannot be edited by this account; do not try to change it.
- Cloudflare Pages preview deployments are disabled, so no preview build will be generated from this branch.
- Do not enable paid add-ons, custom SMTP, paid AI services, or additional infrastructure without explicit user approval.
- Keep R2 Standard; no bucket/object deletion until migration is verified.
- Avoid opening a PR or triggering Actions until Actions usage and billing limits are checked.

## Current status
- GitHub branch created from `main` SHA `d40d020103f948b433180faced0d5648e9ed9602`.
- Neon branch created from production without modifying production.
- The baseline SQL is intentionally applied only to the migration branch.
