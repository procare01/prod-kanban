/**
 * apply_migrations.js
 *
 * Applies new migrations (010 and 011) to the Supabase database.
 * Requires SUPABASE_SERVICE_ROLE_KEY environment variable (or set it below).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=your_key node supabase/apply_migrations.js
 *
 * Or set the key directly in this file (line ~15).
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = 'https://uvcywcoirmotdlsegpvd.supabase.co'
// Paste your service role key here OR set env var SUPABASE_SERVICE_ROLE_KEY
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'PASTE_SERVICE_ROLE_KEY_HERE'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const MIGRATIONS = [
  '010_settings.sql',
  '011_today_line_history.sql',
]

async function run() {
  for (const file of MIGRATIONS) {
    const sqlPath = path.join(__dirname, 'migrations', file)
    const sql = fs.readFileSync(sqlPath, 'utf-8')

    console.log(`\n→ Applying ${file}...`)
    const { error } = await supabase.rpc('exec_sql', { sql }).catch(() => ({ error: { message: 'RPC not available' } }))
    if (error) {
      // Fallback: try via postgres directly using supabase management API
      console.log(`  ⚠ RPC failed — apply manually in Supabase SQL Editor:`)
      console.log(`  https://supabase.com/dashboard/project/uvcywcoirmotdlsegpvd/sql/new`)
      console.log(`  File: supabase/migrations/${file}`)
    } else {
      console.log(`  ✓ Done`)
    }
  }
}

run().catch(console.error)
