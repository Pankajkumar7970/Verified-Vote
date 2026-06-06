/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('voting_sessions', {
    baseline_embedding_enc: { type: 'bytea' },
    baseline_selfie_minio_key: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('voting_sessions', [
    'baseline_embedding_enc',
    'baseline_selfie_minio_key',
  ]);
};
