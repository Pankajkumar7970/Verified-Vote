/* eslint-disable camelcase */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('voting_sessions', {
    voting_selfie_minio_key: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('voting_sessions', ['voting_selfie_minio_key']);
};
