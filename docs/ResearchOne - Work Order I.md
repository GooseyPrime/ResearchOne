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

**sql**

**CREATE TABLE byok_keys (**

**user_id text PRIMARY KEY REFERENCES users(user_id),**

**encrypted_openrouter_key text NOT NULL,**

**encrypted_openrouter_key_iv text NOT NULL,**

**encrypted_openrouter_key_tag text NOT NULL,**

**key_last_four text NOT NULL,**

**key_validated_at timestamp,**

**key_status text NOT NULL DEFAULT \'pending\' CHECK (key_status IN (**

**\'pending\',\'valid\',\'invalid\',\'revoked\'**

**)),**

**created_at timestamp NOT NULL DEFAULT now(),**

**updated_at timestamp NOT NULL DEFAULT now()**

**);**

-   **backend/src/services/byok/encryption.ts --- AES-256-GCM helpers
    using BYOK_ENCRYPTION_KEY env var (32-byte master key)**

-   **backend/src/services/byok/keyVault.ts --- storeKey,
    retrieveDecryptedKey, validateKey (calls OpenRouter
    /api/v1/auth/key), deleteKey, getKeyStatus**

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
