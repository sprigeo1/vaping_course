import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Database } from './src/db.js';
import { notifyAdminsForSchools } from './src/notify.js';
import { compareSync } from './src/util.js';
import AdmZip from 'adm-zip';
import { XMLParser } from 'fast-xml-parser';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: path.join(__dirname, 'uploads') });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({ secret: process.env.SESSION_SECRET || 'dev_secret', resave: false, saveUninitialized: true }));
app.use('/static', express.static(path.join(__dirname, 'public')));

const db = new Database(path.join(__dirname, 'data', 'lms.sqlite'));
db.init();
db.seedSuperAdmin(process.env.SEED_SUPERADMIN_EMAIL, process.env.SEED_SUPERADMIN_PASSWORD);

// Auth helpers
function requireLearner(req,res,next){ if(!req.session.learner) return res.redirect('/login/learner'); next(); }
function requireAdmin(req,res,next){ if(!req.session.admin) return res.redirect('/login/admin'); next(); }
function requireSuper(req,res,next){ if(!req.session.admin || req.session.admin.role!=='super') return res.status(401).send('Super admin required'); next(); }

// Login
app.get('/login/learner', (req,res)=> res.render('login_learner',{error:null}));
app.post('/login/learner', (req,res)=>{
  const { first_name, last_name, code } = req.body;
  const learner = db.findLearnerByNameAndCode(first_name, last_name, code);
  if (!learner) return res.render('login_learner', { error: 'Not found. Check your name and 4-character code.' });
  req.session.learner = { id: learner.id, first_name: learner.first_name, last_name: learner.last_name };
  res.redirect('/');
});
app.get('/login/admin', (req,res)=> res.render('login_admin',{error:null}));
app.post('/login/admin', (req,res)=>{
  const { email, password } = req.body;
  const admin = db.findAdminByEmail(email);
  if (!admin || !compareSync(password, admin.password_hash)) return res.render('login_admin', { error: 'Invalid credentials' });
  req.session.admin = { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  res.redirect(admin.role === 'super' ? '/superadmin' : '/admin');
});
app.get('/logout', (req,res)=> req.session.destroy(()=>res.redirect('/login/learner')));

// Learner area
app.get('/', requireLearner, (req,res)=>{
  const courses = db.listCoursesForLearner(req.session.learner.id);
  res.render('learner_courses', { learner: req.session.learner, courses });
});
app.get('/course/:id', requireLearner, (req,res)=>{
  const courseId = Number(req.params.id);
  const allowed = db.listCoursesForLearner(req.session.learner.id).some(c=>c.id===courseId);
  if (!allowed) return res.status(403).send('Not enrolled in this course.');
  const assignments = db.listAssignmentsByCourse(courseId);
  res.render('course', { learner: req.session.learner, courseId, assignments });
});
app.get('/assignment/:id', requireLearner, (req,res)=>{
  const assignment = db.getAssignment(req.params.id);
  if (!assignment) return res.status(404).send('Not found');
  const allowed = db.listCoursesForLearner(req.session.learner.id).some(c=>c.id===assignment.course_id);
  if (!allowed) return res.status(403).send('Not enrolled in this course.');
  const mySubs = db.listSubmissionsForLearner(req.session.learner.id, assignment.id);
  res.render('assignment', { user: { name: req.session.learner.first_name }, assignment, mySubs });
});
app.post('/assignment/:id/submit', requireLearner, upload.single('file'), (req,res)=>{
  const assignment = db.getAssignment(req.params.id);
  if (!assignment) return res.status(404).send('Not found');
  const allowed = db.listCoursesForLearner(req.session.learner.id).some(c=>c.id===assignment.course_id);
  if (!allowed) return res.status(403).send('Not enrolled in this course.');
  const file = req.file ? (req.file.filename + (req.file.originalname ? ('_' + req.file.originalname) : '')) : null;
  db.createSubmission({ assignment_id: assignment.id, learner_id: req.session.learner.id, text: req.body.text || '', file_path: file });
  const schoolIds = db.listSchoolIdsForLearner ? db.listSchoolIdsForLearner(req.session.learner.id) : [];
  notifyAdminsForSchools(schoolIds, { assignmentTitle: assignment.title, learnerName: req.session.learner.first_name+' '+req.session.learner.last_name }, db);
  res.redirect('/assignment/' + assignment.id);
});

// Admin area
app.get('/admin', requireAdmin, (req,res)=>{
  if (req.session.admin.role !== 'admin') return res.redirect('/superadmin');
  const adminId = req.session.admin.id;
  const schools = db.listSchoolsForAdmin(adminId);
  const submissions = db.listSubmissionsForAdminSchools(adminId);
  const courses = db.listCoursesForAdmin(adminId);
  res.render('admin_dashboard', { admin: req.session.admin, schools, submissions, courses });
});
app.get('/admin/courses', requireAdmin, (req,res)=>{
  const courses = db.listCoursesForAdmin(req.session.admin.id);
  const learners = db.listLearnersForAdmin(req.session.admin.id);
  res.render('admin_courses', { admin: req.session.admin, courses, learners });
});
app.post('/admin/enroll', requireAdmin, (req,res)=>{ db.enrollLearnerInCourse(Number(req.body.learner_id), Number(req.body.course_id)); res.redirect('/admin/courses'); });

// CSV import/export (Admin)
app.get('/admin/export', requireAdmin, (req,res)=>{
  if (req.session.admin.role !== 'admin') return res.status(403).send('Admins only.');
  const rows = db.exportLearnersForAdmin(req.session.admin.id);
  let csv = 'first_name,last_name,code,school_ids,course_ids\n';
  for (const r of rows) csv += `${r.first_name},${r.last_name},${r.code},${r.school_ids||''},${r.course_ids||''}\n`;
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="learners_admin_export.csv"'); res.send(csv);
});
app.get('/admin/submissions/export', requireAdmin, (req,res)=>{
  if (req.session.admin.role !== 'admin') return res.status(403).send('Admins only.');
  const subs = db.listSubmissionsForAdminSchools(req.session.admin.id);
  let csv = 'learner_name,assignment_title,course_id,created_at\n';
  for (const s of subs) csv += `${s.learner_name},${s.assignment_title},${db.getCourseIdForAssignment(s.assignment_id)},${s.created_at}\n`;
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="submissions_admin_export.csv"'); res.send(csv);
});
app.get('/admin/import', requireAdmin, (req,res)=> res.render('admin_import', { admin: req.session.admin }));
app.post('/admin/import', requireAdmin, upload.single('csv'), (req,res)=>{
  const file = req.file; if (!file) return res.status(400).send('CSV file required');
  const text = fs.readFileSync(file.path, 'utf-8'); const lines = text.split(/\r?\n/).filter(Boolean); const header = lines.shift().split(',').map(s=>s.trim().toLowerCase());
  const idx = k => header.indexOf(k); const iFirst=idx('first_name'), iLast=idx('last_name'), iCode=idx('code'), iSchools=idx('school_ids'), iCourses=idx('course_ids');
  if ([iFirst,iLast,iCode,iSchools,iCourses].some(i=>i===-1)) return res.status(400).send('CSV must include headers: first_name,last_name,code,school_ids,course_ids');
  for (const line of lines){ const cols=line.split(',').map(s=>s.trim()); const first=cols[iFirst], last=cols[iLast], code=cols[iCode]; const schools=(cols[iSchools]||'').split(';').map(s=>s.trim()).filter(Boolean).map(Number); const courses=(cols[iCourses]||'').split(';').map(s=>s.trim()).filter(Boolean).map(Number); if(!first||!last||!code||code.length!=4) continue; const learner=db.createLearner(first,last,code); if(schools.length) db.assignLearnerToSchools(learner.id, schools); for (const c of courses) db.enrollLearnerInCourse(learner.id,c); }
  res.redirect('/admin');
});

// Super Admin area
app.get('/superadmin', requireAdmin, requireSuper, (req,res)=>{
  const districts=db.listDistricts(); const schools=db.listAllSchools(); const admins=db.listAllAdmins(); const courses=db.listCourses();
  res.render('super_dashboard', { admin: req.session.admin, districts, schools, admins, courses });
});
app.post('/superadmin/districts/create', requireAdmin, requireSuper, (req,res)=>{ db.createDistrict(req.body.name, req.body.city, req.body.state); res.redirect('/superadmin'); });
app.post('/superadmin/schools/create', requireAdmin, requireSuper, (req,res)=>{ db.createSchool(req.body.name, Number(req.body.district_id)); res.redirect('/superadmin'); });
app.post('/superadmin/admins/create', requireAdmin, requireSuper, (req,res)=>{ db.createAdmin(req.body.name, req.body.email, req.body.password, req.body.role || 'admin'); res.redirect('/superadmin'); });
app.post('/superadmin/admins/assign-schools', requireAdmin, requireSuper, (req,res)=>{ const ids = Array.isArray(req.body.school_ids) ? req.body.school_ids : (req.body.school_ids ? [req.body.school_ids] : []); db.assignAdminToSchools(Number(req.body.admin_id), ids.map(Number)); res.redirect('/superadmin'); });
app.post('/superadmin/admins/delete', requireAdmin, requireSuper, (req,res)=>{ db.superDeleteAdmin(Number(req.body.admin_id)); res.redirect('/superadmin'); });

// Courses (super)
app.post('/superadmin/courses/create', requireAdmin, requireSuper, (req,res)=>{ db.createCourse(req.body.title, req.body.description); res.redirect('/superadmin'); });
app.post('/superadmin/courses/assign-all', requireAdmin, requireSuper, (req,res)=>{ db.assignCourseToAllSchools(Number(req.body.course_id)); res.redirect('/superadmin'); });
app.post('/superadmin/courses/assign-districts', requireAdmin, requireSuper, (req,res)=>{ const ids = Array.isArray(req.body.district_ids) ? req.body.district_ids : (req.body.district_ids ? [req.body.district_ids] : []); db.assignCourseToDistricts(Number(req.body.course_id), ids.map(Number)); res.redirect('/superadmin'); });
app.post('/superadmin/courses/assign-all-districts', requireAdmin, requireSuper, (req,res)=>{ db.assignCourseToAllDistricts(Number(req.body.course_id)); res.redirect('/superadmin'); });

// CSV export (super)
app.get('/superadmin/export', requireAdmin, requireSuper, (req,res)=>{
  const rows = db.exportLearnersAll(); let csv='first_name,last_name,code,school_ids,course_ids\n'; for (const r of rows) csv += `${r.first_name},${r.last_name},${r.code},${r.school_ids||''},${r.course_ids||''}\n`;
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="learners_all_export.csv"'); res.send(csv);
});
app.get('/superadmin/submissions/export', requireAdmin, requireSuper, (req,res)=>{
  const rows = db.db.prepare(`SELECT sub.created_at, l.first_name || ' ' || l.last_name AS learner_name, a.title AS assignment_title, a.course_id FROM submissions sub JOIN learners l ON l.id=sub.learner_id JOIN assignments a ON a.id=sub.assignment_id ORDER BY sub.created_at DESC`).all();
  let csv='learner_name,assignment_title,course_id,created_at\n'; for (const r of rows) csv += `${r.learner_name},${r.assignment_title},${r.course_id},${r.created_at}\n`;
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename="submissions_all_export.csv"'); res.send(csv);
});

// IMSCC import UI + handler
app.get('/superadmin/courses/import', requireAdmin, requireSuper, (req,res)=> res.render('super_import', { admin: req.session.admin }));
app.post('/superadmin/courses/import', requireAdmin, requireSuper, upload.single('imscc'), (req,res)=>{
  const file = req.file; if (!file) return res.status(400).send('IMSCC file required');
  try{
    const zip = new AdmZip(file.path); const entry = zip.getEntry('imsmanifest.xml'); if (!entry) return res.status(400).send('imsmanifest.xml not found in package');
    const xml = zip.readAsText(entry); const parser = new XMLParser({ ignoreAttributes: false }); const doc = parser.parse(xml);
    const org = (doc.manifest?.organizations?.organization) || {}; const title = org.title || 'Imported Course'; const courseId = db.createCourse(title, 'Imported from IMSCC upload');
    const resArray = Array.isArray(doc.manifest?.resources?.resource) ? doc.manifest.resources.resource : [doc.manifest?.resources?.resource].filter(Boolean);
    const idToRes = {}; for (const r of (resArray || [])) { const ident = r['@_identifier'] || r.identifier; idToRes[ident] = { href: r['@_href'] || r.href || null }; }
    function collect(node, acc=[]){ if (!node) return acc; const items = Array.isArray(node.item) ? node.item : (node.item ? [node.item] : []); for (const it of items){ const t = it.title || '(untitled)'; const idr = it['@_identifierref'] || it.identifierref || null; const resMap = idr ? idToRes[idr] : null; acc.push({ title: t, href: resMap?.href || null }); collect(it, acc); } return acc; }
    const flat = collect(org, []); const insert = db.db.prepare(`INSERT INTO assignments(course_id,title,slug,prompt) VALUES (?,?,?,?)`);
    for (const it of flat){ const slug = (it.title||'untitled').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); insert.run(courseId, it.title||'Untitled', slug, `Complete the task: ${it.title}\n\n(Imported href: ${it.href || 'n/a'})`); }
    res.redirect('/superadmin');
  }catch(e){ console.error(e); res.status(500).send('Failed to import IMSCC'); }
});

// Super Admin: Load Sample Data
app.get('/superadmin/load-sample-data', requireAdmin, requireSuper, (req, res)=>{
  try{
    const learnersCsv = fs.readFileSync(path.join(__dirname, 'data', 'sample_learners.csv'), 'utf-8');
    const submissionsCsv = fs.readFileSync(path.join(__dirname, 'data', 'sample_submissions.csv'), 'utf-8');

    learnersCsv.split(/\r?\n/).slice(1).forEach(line=>{
      if(!line.trim()) return;
      const [first,last,code,schoolIds,courseIds] = line.split(',');
      if (first && last && code){
        const learner = db.createLearner(first, last, code);
        const schools = (schoolIds||'').split(';').map(Number).filter(Boolean);
        const courses = (courseIds||'').split(';').map(Number).filter(Boolean);
        if (schools.length) db.assignLearnerToSchools(learner.id, schools);
        for (const c of courses) db.enrollLearnerInCourse(learner.id, c);
      }
    });

    submissionsCsv.split(/\r?\n/).slice(1).forEach(line=>{
      if(!line.trim()) return;
      const [learnerName, assignmentTitle, courseId, createdAt] = line.split(',');
      const assignment = db.db.prepare(`SELECT id FROM assignments WHERE course_id=? AND title=?`).get(Number(courseId), assignmentTitle);
      const learner = db.db.prepare(`SELECT id FROM learners WHERE (first_name||' '||last_name)=?`).get(learnerName);
      if (assignment && learner){
        db.db.prepare(`INSERT INTO submissions (assignment_id, learner_id, text, created_at) VALUES (?,?,?,?)`).run(assignment.id, learner.id, 'Sample submission text', createdAt);
      }
    });

    res.redirect('/superadmin');
  }catch(e){ console.error(e); res.status(500).send('Failed to load sample data'); }
});

// Health
app.get('/health', (req,res)=> res.json({ ok:true }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('LMS app listening on', PORT));
