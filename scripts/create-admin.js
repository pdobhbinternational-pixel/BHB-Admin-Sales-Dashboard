// Generates a bcrypt password hash and prints a ready-to-paste SQL
// INSERT statement for the admin_users table.
//
// Usage:
//   node scripts/create-admin.js "you@bhb.com" "your-password" "Your Name"

const bcrypt = require('bcryptjs');

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js "email" "password" "Full Name"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);
const safeName = (name || email.split('@')[0]).replace(/'/g, "''");
const safeEmail = email.trim().replace(/'/g, "''");

console.log('\nPaste this into the Supabase SQL Editor:\n');
console.log(
  `insert into admin_users (email, password_hash, name)\n` +
  `values ('${safeEmail}', '${hash}', '${safeName}')\n` +
  `on conflict (email) do update set password_hash = excluded.password_hash, name = excluded.name;\n`
);
