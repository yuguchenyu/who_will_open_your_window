# Qwen emotion portraits

The user requested switching local image generation to Qwen after the local text API migration. Keep the current application directory and all changes local; do not commit or push. Use the existing local Qwen credential without putting secrets in tracked files, test output, or browser responses.

Use `qwen-image-2.1-pro`, which documents transparent-channel output and is listed by this account's model discovery endpoint. Keep the existing reference-based emotional variations, consent, private preview, explicit save, stale-reference protection, PNG alpha checks, two global jobs, twelve attempts per user per rolling day, and 180-second combined timeout without automatic retries.

The current multipart `/images/edits` adapter cannot call Qwen directly. Add a Qwen branch selected by its image model name, using JSON with a reference data URL. Support OpenAI `/images/generations` for compatible bases and native `/services/aigc/multimodal-generation/generation` for bases ending in `/api/v1`. The local legacy DashScope host returns 404 for Images, so use its native endpoint. Fetch the returned HTTPS Alibaba Cloud image URL on the server without forwarding the API credential; reject redirects, untrusted hosts, and results larger than 12 MB. Keep explicit legacy model configurations compatible. Default new configurations to Qwen.

Alternatives considered: changing configuration alone cannot handle Qwen's protocol; replacing the entire job lifecycle would add unnecessary risk. A small adapter branch reuses the proven storage and task workflow.

Change the local image connection to the verified local text connection, with a separate image model. Update the UI description and example configuration. Verify with targeted tests, the full suite, one generated portrait using a bundled fictional character (not private user media), and the local running service.
