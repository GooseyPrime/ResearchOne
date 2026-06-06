-- SheerID student verification flags on users (PR2 student verification backend)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS verified_student BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS student_verified_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sheerid_verification_id TEXT;

COMMENT ON COLUMN users.verified_student IS
  'True after SheerID verification succeeds; required before Student tier checkout.';

COMMENT ON COLUMN users.student_verified_at IS
  'Timestamp when verified_student was last set true via SheerID.';

COMMENT ON COLUMN users.sheerid_verification_id IS
  'Last SheerID verification id persisted for audit / support.';
