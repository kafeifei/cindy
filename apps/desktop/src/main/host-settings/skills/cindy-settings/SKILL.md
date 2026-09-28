---
name: cindy-settings
description: Use when the user wants to inspect or change Cindy settings, new-task defaults, personalization, appearance, or restore defaults. Distinguish the current task from future defaults and the execution Host from the controlling device; discover the Host settings tools before changing anything.
---

# Cindy settings

This static, Host-owned Skill guides settings work. It is not a settings store, an authorization, or a copy of the user's preferences. Never write preferences, personal prompt text, credentials, or secrets into this Skill.

## Establish the target

- A change to the **current task** is not a change to **new-task defaults**. Use the current-task capability for a current-task request; do not silently persist it as a default. New-task defaults do not rewrite existing tasks.
- Settings tools act on the **execution Host** that owns this task. A phone or another desktop may only be its **control device**. Do not assume a remote Host setting changes the control device's appearance or preferences.
- State the intended domain and scope. Ask only when the user's target is genuinely ambiguous.

## Discover, read, then change one domain

1. Discover the live `cindy_helper` tools with `list_tools({ category: "settings" })`. If settings are unavailable, report that boundary; do not use shell commands, filesystem edits, browser automation, or another device to bypass it.
2. Use the returned `list_settings` tool to inspect the catalog, scope, writability, application behavior, and dedicated entry points. A complete catalog does **not** mean every listed setting is writable. Use only the tool names and schemas actually returned by the Host.
3. Call `get_settings` for the intended domain before proposing a write. Read the effective/default/override distinction. Use the Host-issued revision and operation ID; do not invent either or reuse them for a different change.
4. Submit only the user's requested changes to that **one domain**, using `update_settings` with `expected_revision`, `operation_id`, and the minimal `set` / `clear` fields allowed by the live schema. `clear` removes that override and follows the current default; setting today's default value still records a custom override. Do not copy the entire read result back as settings.
5. Persistent changes require the Host's human confirmation card. Explain scope and effect, then wait for the real person. Never claim approval yourself, simulate a click, supply a confirmed flag, or treat Full Access, trusted execution, a plan approval, or this Skill as consent. If confirmation cannot be delivered or is cancelled, say that the change was not confirmed.
6. Distinguish **saved** from **application**. A successful save does not prove a live runtime applied it. Report deferred/new-runtime-only/failed application as returned, and do not restart tasks unless the user requested it.

## Conflicts, uncertainty, and sensitive content

- On a revision conflict, re-read and compare against the user's intent. Do not overwrite a newer choice with a stale snapshot.
- After a timeout, disconnect, or unknown outcome, query `get_settings_operation` with the same operation ID and re-read the domain. An `unknown` receipt (including after restart or expiry) is not proof that the write failed. Do not replay the update automatically or mint a replacement operation to hide uncertainty.
- Personalization prompt **body disclosure** needs its separate Host human confirmation. Metadata is not permission to read the body. Request `include_user_prompt` only when the user actually needs the text, and respect the dedicated confirmation before reading or quoting it.
- Secrets, account connections, OAuth, API keys and passwords use their dedicated authorization/input cards. Do not request secret values in chat or put them in generic settings fields, logs, files, or this Skill.
- Never repair an unreadable settings file by replacing it, infer writable fields from the UI, or describe a catalog entry as already supported without checking the live tool result.
