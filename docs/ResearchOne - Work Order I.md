**Work Order I --- BYOK key storage and routing**

**Goal. Allow BYOK users to supply OpenRouter keys, store them
encrypted, and route their runs through their own keys instead of the
platform\'s master key.**

**Pre-work --- read first:**

-   **This report Section 13 (BYOK key vault section)**

-   **backend/src/config/researchEnsemblePresets.ts**

-   **The OpenRouter integration code (likely
    backend/src/services/openrouter/openrouterService.ts per the 041626
    update doc)**

**Files to create:**

-   **backend/src/db/migrations/20260XXX_byok_keys.sql:**

```sql
CREATE TABLE byok_keys (
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL DEFAULT 'openrouter' CHECK (provider IN (
    'openrouter','anthropic','openai','google'
  )),
  encrypted_key text NOT NULL,
  encrypted_key_iv text NOT NULL,
  encrypted_key_tag text NOT NULL,
  key_last_four text NOT NULL,
  key_validated_at timestamp,
  key_status text NOT NULL DEFAULT 'pending' CHECK (key_status IN (
    'pending','valid','invalid','revoked'
  )),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
```

> **FK note.** `users.id` is the existing primary key in
> `backend/src/db/migrations/015_users_orgs_members.sql`. Reference
> `users(id)`, never `users(user_id)`.
>
> **Column naming.** Columns are provider-agnostic
> (`encrypted_key*`) so the same row layout works for OpenRouter,
> Anthropic, OpenAI, and Google keys without a future migration.

**Migration note: backfill existing single-provider rows with
`provider = 'openrouter'` before applying the composite PRIMARY KEY
change. The legacy `encrypted_openrouter_key*` column names (if
present from earlier drafts) must be renamed to `encrypted_key*` in
the same migration.**

-   **backend/src/services/byok/encryption.ts --- AES-256-GCM helpers
    using BYOK_ENCRYPTION_KEY env var (32-byte master key)**

-   **backend/src/services/byok/keyVault.ts --- storeKey,
    getDecryptedKey(userId, provider) (replaces single-key getter),
    validateKey(provider, plaintextKey) (provider-specific — see
    below), deleteKey, getKeyStatus**

> **`validateKey` must dispatch on `provider`.** The earlier draft
> said \"calls OpenRouter `/api/v1/auth/key`\" unconditionally. That
> is wrong for non-OpenRouter providers and would mark valid keys as
> invalid. Required dispatch table:
>
> | provider     | validation call                                                       |
> | ------------ | --------------------------------------------------------------------- |
> | `openrouter` | `GET https://openrouter.ai/api/v1/auth/key` with `Authorization: Bearer <key>` |
> | `anthropic`  | `POST https://api.anthropic.com/v1/messages` minimal probe (or `GET /v1/models` once the SDK exposes it) with `x-api-key` |
> | `openai`     | `GET https://api.openai.com/v1/models` with `Authorization: Bearer <key>` |
> | `google`     | `GET https://generativelanguage.googleapis.com/v1/models?key=<key>` |
>
> Each branch returns `{ valid: boolean, last_four: string,
> reason?: string }` and never logs the plaintext key.

-   **backend/src/api/byok/keys.ts --- POST /api/byok/keys, GET
    /api/byok/keys/status, DELETE /api/byok/keys**

-   **frontend/src/pages/BYOKConfigPage.tsx --- UI for
    entering/updating/deleting BYOK key**

**Files to modify:**

**The OpenRouter service. At call time, check whether the request\'s
user is on the byok tier; if so, retrieve and decrypt their key and use
it for the OpenRouter API call. Otherwise, use the platform\'s master
key.**

**Acceptance criteria:**

-   **BYOK user can submit a valid OpenRouter key → stored encrypted →
    status valid**

-   **BYOK user can submit an invalid key → 400, key not stored**

-   **GET /api/byok/keys/status returns {has_key: bool, key_last_four,
    key_status} --- never the key itself**

-   **BYOK user runs a research report → orchestrator uses their
    decrypted key for OpenRouter calls**

-   **BYOK user deletes their key → subsequent runs return 400 (\"BYOK
    key required\")**

-   **Encryption key rotation: the encryption code must support a key
    rotation procedure (out of scope to actually rotate, but the code
    structure must accommodate it)**

**Security tests (must fail without the fix):**

-   **Stored key cannot be decrypted with wrong master key**

-   **Tampered ciphertext fails GCM auth check**

-   **Key never appears in logs (test by capturing log output during a
    run, grep for key prefix)**

-   **Key never returned in any API response**

**What not to change.**

-   **Platform\'s master OpenRouter key handling for non-BYOK users**

-   **Research engine logic**
