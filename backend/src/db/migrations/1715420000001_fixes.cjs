/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('notifications', {
    metadata: { type: 'jsonb' },
  });

  pgm.sql(`
    UPDATE elections SET status = 'draft' WHERE status = 'upcoming';
    UPDATE elections SET status = 'results_published' WHERE status = 'completed';
  `);
};

exports.down = (pgm) => {
  pgm.dropColumn('notifications', 'metadata');
  pgm.sql(`
    UPDATE elections SET status = 'upcoming' WHERE status = 'draft';
    UPDATE elections SET status = 'completed' WHERE status = 'results_published';
  `);
};
