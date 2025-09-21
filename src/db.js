import DatabaseLib from 'better-sqlite3';
import { hashSync } from './util.js';
import fs from 'fs';

export class Database {
  constructor(dbPath) { this.dbPath = dbPath; this.db = new DatabaseLib(dbPath); }
  init() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS districts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, city TEXT, state TEXT)`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS schools (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, district_id INTEGER, FOREIGN KEY (district_id) REFERENCES districts(id))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT UNIQUE, password_hash TEXT, role TEXT CHECK(role IN ('super','admin')) NOT NULL DEFAULT 'admin')`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS admin_schools (admin_id INTEGER, school_id INTEGER, PRIMARY KEY (admin_id, school_id))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS learners (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, code TEXT CHECK(length(code)=4))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS learner_schools (learner_id INTEGER, school_id INTEGER, PRIMARY KEY (learner_id, school_id))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS courses (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, active INTEGER DEFAULT 1)`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS school_courses (school_id INTEGER, course_id INTEGER, PRIMARY KEY (school_id, course_id))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS learner_courses (learner_id INTEGER, course_id INTEGER, PRIMARY KEY (learner_id, course_id))`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, course_id INTEGER, title TEXT, slug TEXT, prompt TEXT)`).run();
    this.db.prepare(`CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER, learner_id INTEGER, text TEXT, file_path TEXT, created_at TEXT DEFAULT (datetime('now')))`).run();
  }
  seedSuperAdmin(email, password) {
    if (!email || !password) return;
    const exists = this.db.prepare(`SELECT id FROM admins WHERE email=?`).get(email);
    if (!exists) {
      this.db.prepare(`INSERT INTO admins(name,email,password_hash,role) VALUES(?,?,?,'super')`).run('Super Admin', email, hashSync(password));
      const d = this.db.prepare(`INSERT INTO districts(name, city, state) VALUES(?,?,?)`).run('Default District','City','ST');
      const s = this.db.prepare(`INSERT INTO schools(name, district_id) VALUES(?,?)`).run('Default School', d.lastInsertRowid);
      const a = this.db.prepare(`INSERT INTO admins(name,email,password_hash,role) VALUES(?,?,?,'admin')`).run('Default Admin','admin@example.com', hashSync('changeme'));
      this.db.prepare(`INSERT OR IGNORE INTO admin_schools(admin_id, school_id) VALUES(?,?)`).run(a.lastInsertRowid, s.lastInsertRowid);
    }
  }

  // Courses & enrollment
  createCourse(title, description) { return this.db.prepare(`INSERT INTO courses(title,description,active) VALUES(?,?,1)`).run(title, description||'').lastInsertRowid; }
  listCourses() { return this.db.prepare(`SELECT * FROM courses ORDER BY id DESC`).all(); }
  assignCourseToAllSchools(course_id) { const schools = this.db.prepare(`SELECT id FROM schools`).all(); const ins = this.db.prepare(`INSERT OR IGNORE INTO school_courses(school_id,course_id) VALUES(?,?)`); for (const s of schools) ins.run(s.id, course_id); }
  assignCourseToDistricts(course_id, district_ids) { if (!district_ids.length) return; const schools = this.db.prepare(`SELECT id FROM schools WHERE district_id IN (${district_ids.map(()=>'?').join(',')})`).all(...district_ids); const ins = this.db.prepare(`INSERT OR IGNORE INTO school_courses(school_id,course_id) VALUES(?,?)`); for (const s of schools) ins.run(s.id, course_id); }
  assignCourseToAllDistricts(course_id) { const ds = this.db.prepare(`SELECT id FROM districts`).all().map(r=>r.id); this.assignCourseToDistricts(course_id, ds); }
  listCoursesForAdmin(admin_id) { return this.db.prepare(`SELECT DISTINCT c.* FROM courses c JOIN school_courses sc ON sc.course_id=c.id JOIN admin_schools ax ON ax.school_id=sc.school_id WHERE ax.admin_id=? AND c.active=1 ORDER BY c.title`).all(admin_id); }
  listCoursesForLearner(learner_id) { return this.db.prepare(`SELECT c.* FROM courses c JOIN learner_courses lc ON lc.course_id=c.id WHERE lc.learner_id=? AND c.active=1 ORDER BY c.title`).all(learner_id); }
  enrollLearnerInCourse(learner_id, course_id) { return this.db.prepare(`INSERT OR IGNORE INTO learner_courses(learner_id,course_id) VALUES(?,?)`).run(learner_id, course_id); }

  // Assignments/Submissions
  listAssignmentsByCourse(course_id){ return this.db.prepare(`SELECT * FROM assignments WHERE course_id=? ORDER BY id ASC`).all(course_id); }
  getAssignment(id){ return this.db.prepare(`SELECT * FROM assignments WHERE id=?`).get(id); }
  getCourseIdForAssignment(id){ const r = this.db.prepare(`SELECT course_id FROM assignments WHERE id=?`).get(id); return r? r.course_id : null; }
  createSubmission(p){ return this.db.prepare(`INSERT INTO submissions(assignment_id, learner_id, text, file_path) VALUES(?,?,?,?)`).run(p.assignment_id, p.learner_id, p.text, p.file_path); }
  listSubmissionsForLearner(learner_id, assignment_id){ return this.db.prepare(`SELECT * FROM submissions WHERE learner_id=? AND assignment_id=? ORDER BY created_at DESC`).all(learner_id, assignment_id); }
  listSubmissionsForAdminSchools(admin_id){
    return this.db.prepare(`
      SELECT s.*, a.title AS assignment_title, l.first_name || ' ' || l.last_name AS learner_name
      FROM submissions s
      LEFT JOIN assignments a ON a.id=s.assignment_id
      LEFT JOIN learners l ON l.id=s.learner_id
      WHERE EXISTS (
        SELECT 1 FROM learner_schools ls JOIN admin_schools ax ON ax.school_id=ls.school_id
        WHERE ls.learner_id=s.learner_id AND ax.admin_id=?
      )
      ORDER BY s.created_at DESC
    `).all(admin_id);
  }

  // Districts/Schools/Admins/Learners
  createDistrict(n, c, st){ return this.db.prepare(`INSERT INTO districts(name,city,state) VALUES(?,?,?)`).run(n,c,st); }
  listDistricts(){ return this.db.prepare(`SELECT * FROM districts ORDER BY name`).all(); }
  createSchool(n, did){ return this.db.prepare(`INSERT INTO schools(name,district_id) VALUES(?,?)`).run(n,did); }
  listAllSchools(){ return this.db.prepare(`SELECT s.*, d.name AS district_name FROM schools s LEFT JOIN districts d ON d.id=s.district_id ORDER BY d.name, s.name`).all(); }
  listSchoolsForAdmin(aid){
    return this.db.prepare(`SELECT s.*, d.name AS district_name FROM schools s JOIN admin_schools ax ON ax.school_id=s.id LEFT JOIN districts d ON d.id=s.district_id WHERE ax.admin_id=? ORDER BY d.name, s.name`).all(aid);
  }
  findAdminByEmail(e){ return this.db.prepare(`SELECT * FROM admins WHERE email=?`).get(e); }
  createAdmin(n,e,p,role='admin'){ return this.db.prepare(`INSERT INTO admins(name,email,password_hash,role) VALUES(?,?,?,?)`).run(n,e,hashSync(p),role).lastInsertRowid; }
  assignAdminToSchools(aid, sids){ const del=this.db.prepare(`DELETE FROM admin_schools WHERE admin_id=?`); del.run(aid); const ins=this.db.prepare(`INSERT OR IGNORE INTO admin_schools(admin_id,school_id) VALUES(?,?)`); for (const sid of sids) ins.run(aid, sid); }
  deleteAdmin(aid){ this.db.prepare(`DELETE FROM admin_schools WHERE admin_id=?`).run(aid); this.db.prepare(`DELETE FROM admins WHERE id=? AND role='admin'`).run(aid); }
  superDeleteAdmin(aid){ this.db.prepare(`DELETE FROM admin_schools WHERE admin_id=?`).run(aid); this.db.prepare(`DELETE FROM admins WHERE id=?`).run(aid); }
  listAllAdmins(){ return this.db.prepare(`SELECT id,name,email,role FROM admins ORDER BY role DESC, name`).all(); }
  listAdminsInSameDistricts(aid){
    return this.db.prepare(`
      SELECT DISTINCT a.id, a.name, a.email, a.role FROM admins a
      WHERE a.id IN (
        SELECT ax.admin_id FROM admin_schools ax JOIN schools s ON s.id=ax.school_id
        WHERE s.district_id IN (
          SELECT DISTINCT s2.district_id FROM admin_schools ax2 JOIN schools s2 ON s2.id=ax2.school_id WHERE ax2.admin_id=?
        )
      )
      ORDER BY a.name
    `).all(aid);
  }
  findLearnerByNameAndCode(f,l,c){ return this.db.prepare(`SELECT * FROM learners WHERE lower(first_name)=lower(?) AND lower(last_name)=lower(?) AND code=?`).get(f,l,c); }
  createLearner(f,l,c){ const r=this.db.prepare(`INSERT INTO learners(first_name,last_name,code) VALUES(?,?,?)`).run(f,l,c); return { id:r.lastInsertRowid, first_name:f, last_name:l, code:c }; }
  assignLearnerToSchools(lid, sids){ const del=this.db.prepare(`DELETE FROM learner_schools WHERE learner_id=?`); del.run(lid); const ins=this.db.prepare(`INSERT OR IGNORE INTO learner_schools(learner_id,school_id) VALUES(?,?)`); for (const sid of sids) ins.run(lid, sid); }
  reassignLearnerSchools(lid, sids){ this.assignLearnerToSchools(lid, sids); }
  deleteLearner(lid){ this.db.prepare(`DELETE FROM learner_schools WHERE learner_id=?`).run(lid); this.db.prepare(`DELETE FROM learner_courses WHERE learner_id=?`).run(lid); this.db.prepare(`DELETE FROM submissions WHERE learner_id=?`).run(lid); this.db.prepare(`DELETE FROM learners WHERE id=?`).run(lid); }
  listLearnersForAdmin(aid){
    return this.db.prepare(`
      SELECT DISTINCT l.* FROM learners l
      WHERE EXISTS (
        SELECT 1 FROM learner_schools ls JOIN admin_schools ax ON ax.school_id=ls.school_id
        WHERE ax.admin_id=? AND ls.learner_id=l.id
      )
      ORDER BY l.last_name, l.first_name
    `).all(aid);
  }

  // CSV exports
  exportLearnersForAdmin(aid){
    return this.db.prepare(`
      SELECT l.id, l.first_name, l.last_name, l.code,
             GROUP_CONCAT(DISTINCT ls.school_id) AS school_ids,
             GROUP_CONCAT(DISTINCT lc.course_id) AS course_ids
      FROM learners l
      LEFT JOIN learner_schools ls ON ls.learner_id=l.id
      LEFT JOIN admin_schools ax ON ax.school_id=ls.school_id AND ax.admin_id=?
      LEFT JOIN learner_courses lc ON lc.learner_id=l.id
      WHERE ax.admin_id IS NOT NULL
      GROUP BY l.id ORDER BY l.last_name, l.first_name
    `).all(aid);
  }
  exportLearnersAll(){
    return this.db.prepare(`
      SELECT l.id, l.first_name, l.last_name, l.code,
             GROUP_CONCAT(DISTINCT ls.school_id) AS school_ids,
             GROUP_CONCAT(DISTINCT lc.course_id) AS course_ids
      FROM learners l
      LEFT JOIN learner_schools ls ON ls.learner_id=l.id
      LEFT JOIN learner_courses lc ON lc.learner_id=l.id
      GROUP BY l.id ORDER BY l.last_name, l.first_name
    `).all();
  }

  // Seed from structure JSON (optional hook)
  seedFromStructure(structurePath){
    let data; try { data = JSON.parse(fs.readFileSync(structurePath,'utf-8')); } catch(e){ return; }
    const courseId = this.createCourse('Imported Course','Imported from IMSCC');
    const insert = this.db.prepare(`INSERT INTO assignments(course_id,title,slug,prompt) VALUES (?,?,?,?)`);
    const items = (data.manifest?.organizations || []).flatMap(org => org.items || []);
    for (const it of items) {
      const title = it.title || 'Untitled';
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      insert.run(courseId, title, slug, `Complete: ${title}`);
    }
  }
}
