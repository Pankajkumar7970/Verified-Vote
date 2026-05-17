import { db } from '../index.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config();

async function seedAdmins() {
  console.log('Seeding admins...');
  
  const admins = [
    { username: process.env.SUPER_ADMIN_USERNAME || 'superadmin', password: process.env.SUPER_ADMIN_PASSWORD || 'secret', role: 'super_admin' },
    { username: process.env.REVIEWER_USERNAME || 'reviewer', password: process.env.REVIEWER_PASSWORD || 'secret', role: 'reviewer' }
  ];

  for (const admin of admins) {
    // 12 rounds for admin as per Architecture constraint
    const hash = await bcrypt.hash(admin.password, 12);
    
    // Check if exists
    const existing = await db.query('SELECT username FROM admins WHERE username = $1', [admin.username]);
    if (existing.rows.length === 0) {
      await db.query(
        `INSERT INTO admins (username, password_hash, role) VALUES ($1, $2, $3)`,
        [admin.username, hash, admin.role]
      );
      console.log(`Created admin: ${admin.username} (${admin.role})`);
    } else {
      console.log(`Admin ${admin.username} already exists.`);
    }
  }
  
  console.log('Seed check complete.');
  process.exit(0);
}

seedAdmins().catch(console.error);
