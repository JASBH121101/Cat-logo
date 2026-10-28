# Supabase migration history reconciliation

Updated: 2026-10-28

The connected project now reports 34 applied migration versions. The repository now contains the same 31 version identifiers and names; there are no local-only or remote-only versions.

Several private-chat migration files had been applied directly to Supabase but their source files were absent from `main`. The missing baseline and follow-up files were reconstructed from the live table definitions, deployed RPC definitions, and adjacent migration sources. These restored files reproduce the intended schema/workflow, but they are **not claimed to be byte-for-byte copies of the original SQL that was applied**.

Before using this history to provision a separate production project, compare the generated schema against the intended baseline. Do not replay the applied migrations on the connected project; Supabase already records these versions as applied.

The migration `20261028230640_20261028230600_drop_duplicate_private_chat_inbox_index.sql` removes the redundant `private_chat_conversations_status_last_message_idx`; the equivalent `private_chat_conversations_admin_inbox_idx` remains.
