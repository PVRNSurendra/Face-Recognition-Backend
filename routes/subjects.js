// const express = require('express');
// const { verifyToken } = require('./auth');
// const router = express.Router();

// // Get all subjects for a department/section
// // router.get('/', verifyToken, async (req, res) => {
// //   const { department, section, year } = req.query;
// //   const db = req.app.locals.db;

// //   try {
// //     let query = 'SELECT * FROM subjects WHERE 1=1';
// //     const params = [];
// //     let paramCount = 1;

// //     if (department) {
// //       query += ` AND department = $${paramCount}`;
// //       params.push(department);
// //       paramCount++;
// //     }

// //     if (section) {
// //       query += ` AND section = $${paramCount}`;
// //       params.push(section);
// //       paramCount++;
// //     }

// //     if (year) {
// //       query += ` AND year = $${paramCount}`;
// //       params.push(year);
// //       paramCount++;
// //     }

// //     query += ' ORDER BY subject_type, subject_name';

// //     const result = await db.query(query, params);

// //     // Group by type
// //     const coreSubjects = result.rows.filter(s => s.subject_type === 'core');
// //     const electiveSubjects = result.rows.filter(s => s.subject_type === 'elective');

// //     res.json({
// //       subjects: result.rows,
// //       core: coreSubjects,
// //       electives: electiveSubjects
// //     });
// //   } catch (error) {
// //     console.error('Error fetching subjects:', error);
// //     res.status(500).json({ error: 'Failed to fetch subjects' });
// //   }
// // });

// router.get('/test', async (req, res) => {
//   const db = req.app.locals.db;
  
//   try {
//     const allSubjects = await db.query('SELECT * FROM subjects');
    
//     res.json({
//       total: allSubjects.rows.length,
//       subjects: allSubjects.rows,
//       test_query: {
//         department: 'CSE',
//         section: 'A', 
//         year: 'YEAR-1'
//       }
//     });
//   } catch (error) {
//     console.error('Test error:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// router.get('/', verifyToken, async (req, res) => {
//   const { department, section, year } = req.query;
//   const db = req.app.locals.db;

//   console.log('=== SUBJECTS API CALLED ===');
//   console.log('Query params:', { department, section, year });
//   console.log('User:', req.user);

//   try {
//     let query = 'SELECT * FROM subjects WHERE 1=1';
//     const params = [];
//     let paramCount = 1;

//     if (department) {
//       query += ` AND department = $${paramCount}`;
//       params.push(department);
//       paramCount++;
//     }

//     if (section) {
//       query += ` AND section = $${paramCount}`;
//       params.push(section);
//       paramCount++;
//     }

//     if (year) {
//       query += ` AND year = $${paramCount}`;
//       params.push(year);
//       paramCount++;
//     }

//     query += ' ORDER BY subject_type, subject_name';

//     console.log('SQL Query:', query);
//     console.log('SQL Params:', params);

//     const result = await db.query(query, params);

//     console.log('Results found:', result.rows.length);
//     console.log('Results:', result.rows);

//     const coreSubjects = result.rows.filter(s => s.subject_type === 'core');
//     const electiveSubjects = result.rows.filter(s => s.subject_type === 'elective');

//     const response = {
//       subjects: result.rows,
//       core: coreSubjects,
//       electives: electiveSubjects
//     };

//     console.log('Sending response:', response);

//     res.json(response);
//   } catch (error) {
//     console.error('Error fetching subjects:', error);
//     res.status(500).json({ error: 'Failed to fetch subjects' });
//   }
// });




// // Add new subject (Admin only)
// router.post('/', verifyToken, async (req, res) => {
//   const { subject_code, subject_name, department, section, year, subject_type, credits } = req.body;
//   const db = req.app.locals.db;

//   if (req.user.role !== 'admin') {
//     return res.status(403).json({ error: 'Only admin can add subjects' });
//   }

//   try {
//     const result = await db.query(
//       `INSERT INTO subjects (subject_code, subject_name, department, section, year, subject_type, credits)
//        VALUES ($1, $2, $3, $4, $5, $6, $7)
//        RETURNING *`,
//       [subject_code, subject_name, department, section, year, subject_type, credits]
//     );

//     res.status(201).json({
//       message: 'Subject added successfully',
//       subject: result.rows[0]
//     });
//   } catch (error) {
//     console.error('Error adding subject:', error);
//     if (error.code === '23505') { // Unique constraint violation
//       res.status(400).json({ error: 'Subject code already exists' });
//     } else {
//       res.status(500).json({ error: 'Failed to add subject' });
//     }
//   }
// });

// // Enroll student in elective subject
// router.post('/enroll', verifyToken, async (req, res) => {
//   const { student_id, subject_id } = req.body;
//   const db = req.app.locals.db;

//   try {
//     // Check if subject is elective
//     const subjectCheck = await db.query(
//       'SELECT subject_type FROM subjects WHERE id = $1',
//       [subject_id]
//     );

//     if (subjectCheck.rows.length === 0) {
//       return res.status(404).json({ error: 'Subject not found' });
//     }

//     if (subjectCheck.rows[0].subject_type !== 'elective') {
//       return res.status(400).json({ error: 'Can only enroll in elective subjects' });
//     }

//     // Enroll student
//     await db.query(
//       `INSERT INTO student_subjects (student_id, subject_id)
//        VALUES ($1, $2)
//        ON CONFLICT (student_id, subject_id) DO NOTHING`,
//       [student_id, subject_id]
//     );

//     res.json({ message: 'Student enrolled successfully' });
//   } catch (error) {
//     console.error('Error enrolling student:', error);
//     res.status(500).json({ error: 'Failed to enroll student' });
//   }
// });

// // Get student's enrolled subjects
// router.get('/student/:student_id', verifyToken, async (req, res) => {
//   const { student_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     const result = await db.query(
//       `SELECT s.*, 
//               CASE WHEN ss.id IS NOT NULL THEN true ELSE false END as is_enrolled
//        FROM subjects s
//        LEFT JOIN student_subjects ss ON s.id = ss.subject_id AND ss.student_id = $1
//        WHERE s.department = (SELECT department FROM students WHERE student_id = $1)
//          AND s.section = (SELECT section FROM students WHERE student_id = $1)
//        ORDER BY s.subject_type, s.subject_name`,
//       [student_id]
//     );

//     res.json({ subjects: result.rows });
//   } catch (error) {
//     console.error('Error fetching student subjects:', error);
//     res.status(500).json({ error: 'Failed to fetch student subjects' });
//   }
// });

// module.exports = router;
const express = require('express');
const { verifyToken } = require('./auth');
const router = express.Router();

// Fetch subjects based on dept + year
router.get('/', verifyToken, async (req, res) => {
  const { department, year } = req.query;
  const db = req.app.locals.db;

  try {
    let query = `SELECT * FROM subjects WHERE 1=1`;
    const params = [];
    let i = 1;

    if (department) {
      query += ` AND LOWER(department) = LOWER($${i++})`;
      params.push(department);
    }

    if (year) {
      query += ` AND LOWER(year) = LOWER($${i++})`;
      params.push(year); // year is YEAR-4 etc
    }

    query += ` ORDER BY subject_type, subject_name`;

    const result = await db.query(query, params);

    res.json({
      subjects: result.rows,
      core: result.rows.filter(s => s.subject_type === 'core'),
      electives: result.rows.filter(s => s.subject_type === 'elective')
    });

  } catch (err) {
    console.error('Error fetching subjects:', err);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

module.exports = router;
