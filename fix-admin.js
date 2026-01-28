const bcrypt = require('bcrypt');
const { Pool } = require('pg');

require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function createAdminUser() {
  try {
    const username = 'admin';
    const password = 'admin123'; // Set your desired password
    const email = 'admin@example.com';
    const role = 'admin';
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    console.log('Creating admin user...');
    
    const result = await pool.query(
      'INSERT INTO users (username, password, email, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, hashedPassword, email, role]
    );
    
    if (result.rows.length > 0) {
      console.log('✅ Admin user created successfully!');
      console.log('User details:', result.rows[0]);
      console.log('\nLogin credentials:');
      console.log('Username:', username);
      console.log('Password:', password);
    }
    
    await pool.end();
  } catch (error) {
    if (error.code === '23505') {
      console.log('❌ Username already exists! Use UPDATE instead.');
    } else {
      console.error('❌ Error:', error.message);
    }
    await pool.end();
  }
}

createAdminUser();