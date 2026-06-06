/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  // Admins
  pgm.createTable('admins', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    username: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    is_active: { type: 'boolean', default: true },
    last_login_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Parties
  pgm.createTable('parties', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true, unique: true },
    abbreviation: { type: 'text' },
    symbol_minio_key: { type: 'text' },
    is_active: { type: 'boolean', default: true },
    created_by: { type: 'uuid', references: 'admins(id)' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Voters
  pgm.createTable('voters', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    voter_id_hash: { type: 'text', notNull: true, unique: true },
    voter_id_enc: { type: 'bytea', notNull: true },
    name_enc: { type: 'bytea', notNull: true },
    phone_enc: { type: 'bytea', notNull: true },
    constituency: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    data_expires_at: { type: 'timestamptz' },
  });

  // Elections
  pgm.createTable('elections', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name: { type: 'text', notNull: true },
    constituency: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true },
    election_date: { type: 'date', notNull: true },
    request_deadline: { type: 'timestamptz', notNull: true },
    status: { type: 'text', notNull: true, default: 'draft' },
    results_hash: { type: 'text' },
    results_snapshot: { type: 'jsonb' },
    results_published_at: { type: 'timestamptz' },
    created_by: { type: 'uuid', references: 'admins(id)' },
    activated_by: { type: 'uuid', references: 'admins(id)' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Election Settings
  pgm.createTable('election_settings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    election_id: { type: 'uuid', references: 'elections(id)', unique: true, notNull: true },
    face_match_threshold: { type: 'float', default: 0.6 },
    liveness_threshold: { type: 'float', default: 0.4 },
    session_window_minutes: { type: 'integer', default: 15 },
    withdrawal_deadline_hours: { type: 'integer', default: 48 },
    max_otp_attempts: { type: 'integer', default: 3 },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Candidates
  pgm.createTable('candidates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    election_id: { type: 'uuid', references: 'elections(id)', notNull: true },
    party_id: { type: 'uuid', references: 'parties(id)', notNull: true },
    name: { type: 'text', notNull: true },
    display_order: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // OTPs
  pgm.createTable('otps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    voter_id: { type: 'uuid', references: 'voters(id)', notNull: true },
    otp_hash: { type: 'text', notNull: true },
    session_nonce: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    attempt_count: { type: 'integer', default: 0 },
    invalidated_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Voting Requests
  pgm.createTable('voting_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    voter_id: { type: 'uuid', references: 'voters(id)', notNull: true },
    election_id: { type: 'uuid', references: 'elections(id)', notNull: true },
    reason_category: { type: 'text', notNull: true },
    reason_detail: { type: 'text' },
    doc_type: { type: 'text', notNull: true },
    doc_minio_key: { type: 'text' },
    doc_hash: { type: 'text' },
    request_selfie_embedding_enc: { type: 'bytea' },
    face_score_at_request: { type: 'float' },
    liveness_score_at_request: { type: 'float' },
    status: { type: 'text', notNull: true, default: 'pending' },
    reviewed_by_reviewer: { type: 'uuid', references: 'admins(id)' },
    reviewer_note: { type: 'text' },
    reviewed_by_superadmin: { type: 'uuid', references: 'admins(id)' },
    superadmin_note: { type: 'text' },
    scheduled_at: { type: 'timestamptz' },
    withdrawn_at: { type: 'timestamptz' },
    appeal_doc_minio_key: { type: 'text' },
    appeal_submitted_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Partial unique index
  pgm.createIndex('voting_requests', ['voter_id', 'election_id'], {
    name: 'unique_active_request_idx',
    unique: true,
    where: "status NOT IN ('rejected', 'withdrawn', 'appeal_resolved')",
  });

  // Request Events
  pgm.createTable('request_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    request_id: { type: 'uuid', references: 'voting_requests(id)', notNull: true },
    old_status: { type: 'text', notNull: true },
    new_status: { type: 'text', notNull: true },
    actor_id: { type: 'uuid', notNull: true },
    actor_type: { type: 'text', notNull: true },
    reason: { type: 'text' },
    metadata: { type: 'jsonb' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Voting Sessions
  pgm.createTable('voting_sessions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    request_id: { type: 'uuid', references: 'voting_requests(id)', unique: true, notNull: true },
    ref_code: { type: 'text', unique: true, notNull: true },
    ref_code_used: { type: 'boolean', default: false },
    ref_code_used_at: { type: 'timestamptz' },
    exchange_nonce: { type: 'text', unique: true },
    exchange_nonce_used: { type: 'boolean', default: false },
    token_hash: { type: 'text', unique: true },
    state: { type: 'text', notNull: true, default: 'link_opened' },
    is_revoked: { type: 'boolean', default: false },
    revoked_at: { type: 'timestamptz' },
    revoked_by: { type: 'uuid', references: 'admins(id)' },
    expires_at: { type: 'timestamptz', notNull: true },
    otp_verified_at: { type: 'timestamptz' },
    face_verified_at: { type: 'timestamptz' },
    face_score: { type: 'float' },
    liveness_score: { type: 'float' },
    face_pending_reason: { type: 'text' },
    vote_cast_at: { type: 'timestamptz' },
    ip_address: { type: 'inet' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Votes
  pgm.createTable('votes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    election_id: { type: 'uuid', references: 'elections(id)', notNull: true },
    candidate_id: { type: 'uuid', references: 'candidates(id)', notNull: true },
    receipt_token: { type: 'text', unique: true, notNull: true },
    cast_at: { type: 'timestamptz', default: pgm.func("date_trunc('minute', now())") },
  });

  // Notifications
  pgm.createTable('notifications', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    voter_id: { type: 'uuid', references: 'voters(id)', notNull: true },
    type: { type: 'text', notNull: true },
    channel: { type: 'text', notNull: true, default: 'sms' },
    status: { type: 'text', notNull: true, default: 'pending' },
    retry_count: { type: 'integer', default: 0 },
    sent_at: { type: 'timestamptz' },
    next_retry_at: { type: 'timestamptz' },
    failed_reason: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Verification Logs
  pgm.createTable('verification_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    request_id: { type: 'uuid', references: 'voting_requests(id)' },
    session_id: { type: 'uuid', references: 'voting_sessions(id)' },
    verification_type: { type: 'text', notNull: true },
    face_score: { type: 'float', notNull: true },
    liveness_score: { type: 'float' },
    face_threshold: { type: 'float', notNull: true },
    liveness_threshold: { type: 'float' },
    face_passed: { type: 'boolean', notNull: true },
    liveness_passed: { type: 'boolean' },
    overall_passed: { type: 'boolean', notNull: true },
    model_used: { type: 'text', notNull: true },
    duration_ms: { type: 'integer', notNull: true },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Audit Logs
  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_type: { type: 'text', notNull: true },
    actor_id: { type: 'uuid', notNull: true },
    action: { type: 'text', notNull: true },
    entity_type: { type: 'text', notNull: true },
    entity_id: { type: 'uuid' },
    metadata: { type: 'jsonb' },
    ip_address: { type: 'inet' },
    request_id_header: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('now()') },
  });

  // Cron Jobs
  pgm.createTable('cron_jobs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    job_name: { type: 'text', unique: true, notNull: true },
    last_run_at: { type: 'timestamptz' },
    last_status: { type: 'text' },
    last_error: { type: 'text' },
    updated_at: { type: 'timestamptz', default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  // Normally drop tables in reverse block order
  pgm.dropTable('cron_jobs');
  pgm.dropTable('audit_logs');
  pgm.dropTable('verification_logs');
  pgm.dropTable('notifications');
  pgm.dropTable('votes');
  pgm.dropTable('voting_sessions');
  pgm.dropTable('request_events');
  pgm.dropIndex('voting_requests', ['voter_id', 'election_id'], { name: 'unique_active_request_idx' });
  pgm.dropTable('voting_requests');
  pgm.dropTable('otps');
  pgm.dropTable('candidates');
  pgm.dropTable('election_settings');
  pgm.dropTable('elections');
  pgm.dropTable('voters');
  pgm.dropTable('parties');
  pgm.dropTable('admins');
  pgm.dropExtension('pgcrypto');
};
