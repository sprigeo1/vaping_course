import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { Database } from '../src/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database(path.join(__dirname, '..', 'data', 'lms.sqlite'));
db.init();
db.seedSuperAdmin(process.env.SEED_SUPERADMIN_EMAIL || 'super@example.com', process.env.SEED_SUPERADMIN_PASSWORD || 'super-secret');

// Create a demo course and assignments if empty
const courses = db.listCourses();
let cid;
if (!courses.length) {
  cid = db.createCourse('Demo Course', 'Example coursework');
  const insert = db.db.prepare(`INSERT INTO assignments(course_id,title,slug,prompt) VALUES (?,?,?,?)`);
  ['Introduction Quiz','Module 1 Reflection','Final Project'].forEach(t => {
    insert.run(cid, t, t.toLowerCase().replace(/[^a-z0-9]+/g,'-'), `Please complete: ${t}`);
  });
}

console.log('Seed complete.');
