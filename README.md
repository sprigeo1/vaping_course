# Minimal Multi-Course LMS (Node/Express + SQLite)

A lightweight Learning Management System built with **Node.js + Express + SQLite**.  
Supports multi-tenant schools/districts, super/admin/learner roles, CSV import/export, and IMSCC course imports.  
Designed to run on **Replit (Node 18)** with one-click setup.

## 🚀 Features
- **Roles**
  - Super Admin: manage districts, schools, admins, and courses
  - Admin: manage learners in assigned schools, enroll them in courses
  - Learner: enroll in courses, submit assignments
- **Courses**
  - Create new courses
  - Import `.imscc` course packages (auto-creates assignments)
  - Assign to all districts, specific districts, or schools
- **Learners**
  - Bulk import via CSV (`first_name,last_name,code,school_ids,course_ids`)
  - Export learners (scoped for Admin, global for Super Admin)
  - 4-character login code authentication
- **Assignments & Submissions**
  - Learner submissions (text + optional file upload)
  - Notifications to admins for new submissions
  - CSV export of submissions
- **Extras**
  - “Load Sample Data” button (Super Admin) to quickly seed learners & submissions
  - Styled dashboards with Exports section
  - Sample CSVs in `/data/`

## 🛠️ Quick Start

### 1. Setup
Clone or upload repo to Replit (or run locally):
```bash
npm install
```

### 2. Seed Database
```bash
npm run seed
```
Seeds:
- **Super Admin** → `super@example.com` / `super-secret`
- **Admin** → `admin@example.com` / `changeme`
- Creates a demo course + assignments if DB is empty.

### 3. Run App
```bash
npm run dev
```
Open at [http://localhost:3000](http://localhost:3000) (Replit will provide a webview URL).

## 🔑 Logins
- **Super Admin:**  
  Email: `super@example.com`  
  Pass: `super-secret`

- **Admin:**  
  Email: `admin@example.com`  
  Pass: `changeme`

- **Learner:**  
  Add learners via CSV import, UI, or use **Load Sample Data** button.

## 📂 CSV Samples
Located in `/data/`:
- `sample_learners.csv`
- `sample_submissions.csv`

Super Admin → *Exports* card → **Load Sample Data** → instantly populates DB with test learners + submissions.

## 📦 Deployment
- Ready for **Replit** with:
  - `.replit`
  - `replit.nix` (Node 18)
  - `replit.yaml`

Just import into Replit → click **Run**.
