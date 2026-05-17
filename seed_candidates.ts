import { db } from './backend/src/db/index.js';

async function seedCandidates() {
  try {
    const elections = await db.query('SELECT id FROM elections');
    const admin = await db.query('SELECT id FROM admins LIMIT 1');
    
    const adminId = admin.rows[0]?.id;
    if (!adminId) return console.log('no admins');

    let p1 = await db.query(`SELECT id FROM parties WHERE abbreviation = 'DEM'`);
    if (p1.rows.length === 0) {
       await db.query(`INSERT INTO parties (name, abbreviation, created_by) VALUES ('Democratic Party', 'DEM', $1)`, [adminId]);
       p1 = await db.query(`SELECT id FROM parties WHERE abbreviation = 'DEM'`);
    }

    let p2 = await db.query(`SELECT id FROM parties WHERE abbreviation = 'IND'`);
    if (p2.rows.length === 0) {
       await db.query(`INSERT INTO parties (name, abbreviation, created_by) VALUES ('Independent candidate', 'IND', $1)`, [adminId]);
       p2 = await db.query(`SELECT id FROM parties WHERE abbreviation = 'IND'`);
    }
    
    for (const el of elections.rows) {
      await db.query(`INSERT INTO candidates (election_id, party_id, name, display_order) VALUES ($1, $2, 'Jane Doe', 1)`, [el.id, p1.rows[0].id]);
      await db.query(`INSERT INTO candidates (election_id, party_id, name, display_order) VALUES ($1, $2, 'John Smith', 2)`, [el.id, p2.rows[0].id]);
    }
    console.log('seeded candidates');
  } catch(e) { 
    console.error(e);
  } finally { 
    process.exit(0);
  }
}
seedCandidates();
