/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('voting_requests', {
    voter_id_photo_minio_key: { type: 'text' },
    request_selfie_minio_key: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('voting_requests', ['voter_id_photo_minio_key', 'request_selfie_minio_key']);
};
