// const express = require('express');
// const axios = require('axios');
// const PDFDocument = require('pdfkit');
// const moment = require('moment');
// const { verifyToken } = require('./auth');
// const router = express.Router();

// const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

// // Mark attendance from group photo with enhanced verification
// router.post('/mark', verifyToken, async (req, res) => {
//   const { 
//     subject_id,      // Changed from session_name and course_name
//     department, 
//     section, 
//     session_date, 
//     session_time,
//     period_number,   // Added
//     image 
//   } = req.body;
//   const db = req.app.locals.db;

//   try {
//     // Get all registered students with face encodings
//     const studentsResult = await db.query(
//       'SELECT student_id, name, email, department, face_encoding FROM students'
//     );

//     const registeredStudents = studentsResult.rows.map(student => ({
//       student_id: student.student_id,
//       name: student.name,
//       email: student.email,
//       department: student.department,
//       face_encoding: JSON.parse(student.face_encoding)
//     }));

//     if (registeredStudents.length === 0) {
//       return res.status(400).json({ error: 'No registered students found' });
//     }

//     // Call ML service to recognize faces with enhanced verification
//     const mlResponse = await axios.post(`${ML_SERVICE_URL}/recognize_faces`, {
//       image: image,
//       registered_students: registeredStudents
//     });

//     if (!mlResponse.data.success) {
//       return res.status(400).json({ error: mlResponse.data.error });
//     }

//     const recognizedStudents = mlResponse.data.recognized_students;
//     const unrecognizedFaces = mlResponse.data.unrecognized_faces || 0;
//     const lowQualityFaces = mlResponse.data.low_quality_faces || 0;

//     // Create attendance session
//     const sessionResult = await db.query(
//       `INSERT INTO attendance_sessions 
//        (subject_id, faculty_id, department, section, session_date, session_time, period_number) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7) 
//        RETURNING id`,
//       [subject_id, req.user.id, department, section, session_date, session_time, period_number]
//     );

//     const sessionId = sessionResult.rows[0].id;

//     // Get list of recognized student IDs
//     const recognizedIds = new Set(recognizedStudents.map(s => s.student_id));

//     // Mark attendance for all registered students
//     const attendancePromises = registeredStudents.map(student => {
//       const isPresent = recognizedIds.has(student.student_id);
//       const recognizedStudent = recognizedStudents.find(s => s.student_id === student.student_id);
      
//       return db.query(
//         `INSERT INTO attendance_records (session_id, student_id, status, confidence_score) 
//          VALUES ($1, $2, $3, $4)`,
//         [
//           sessionId,
//           student.student_id,
//           isPresent ? 'present' : 'absent',
//           isPresent ? recognizedStudent.confidence : null
//         ]
//       );
//     });

//     await Promise.all(attendancePromises);

//     // Get attendance summary
//     const summary = await db.query(
//       `SELECT 
//         COUNT(*) FILTER (WHERE status = 'present') as present_count,
//         COUNT(*) FILTER (WHERE status = 'absent') as absent_count,
//         COUNT(*) as total_count
//        FROM attendance_records 
//        WHERE session_id = $1`,
//       [sessionId]
//     );

//     res.json({
//       message: 'Attendance marked successfully',
//       session_id: sessionId,
//       faces_detected: mlResponse.data.faces_detected,
//       recognized_count: recognizedStudents.length,
//       unrecognized_faces: unrecognizedFaces,
//       low_quality_faces: lowQualityFaces,
//       summary: summary.rows[0],
//       recognized_students: recognizedStudents,
//       warning: unrecognizedFaces > 0 ? 
//         `${unrecognizedFaces} face(s) detected but not matched to any registered student` : null
//     });
//   } catch (error) {
//     console.error('Attendance marking error:', error);
//     if (error.response?.data?.error) {
//       res.status(400).json({ error: error.response.data.error });
//     } else {
//       res.status(500).json({ error: 'Failed to mark attendance' });
//     }
//   }
// });

// // Get all attendance sessions
// router.get('/sessions', verifyToken, async (req, res) => {
//   const db = req.app.locals.db;

//   try {
//     const result = await db.query(
//       `SELECT 
//           s.id,
//           sub.subject_name AS course_name,
//           sub.subject_code AS subject_code,
//           s.department AS department,
//           s.section AS section,
//           s.session_date,
//           s.session_time,
//           s.period_number,
//           u.username AS faculty_name,
//           COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_count,
//           COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
//           COUNT(ar.id) AS total_count
//       FROM attendance_sessions s
//       LEFT JOIN subjects sub ON s.subject_id = sub.id
//       LEFT JOIN users u ON s.faculty_id = u.id
//       LEFT JOIN attendance_records ar ON s.id = ar.session_id
//       GROUP BY s.id, sub.subject_name, sub.subject_code, u.username
//       ORDER BY s.session_date DESC, s.session_time DESC`
//     );

//     res.json({ sessions: result.rows });
//   } catch (error) {
//     console.error('Error fetching sessions:', error);
//     res.status(500).json({ error: 'Failed to fetch sessions' });
//   }
// });

// // Get attendance details for a session
// router.get('/sessions/:session_id', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     // Get session info
//     const sessionResult = await db.query(
//       `SELECT s.*, u.username as faculty_name, sub.subject_name as subject_name, sub.subject_code as subject_code
//        FROM attendance_sessions s
//        LEFT JOIN users u ON s.faculty_id = u.id
//        LEFT JOIN subjects sub ON s.subject_id = sub.id
//        WHERE s.id = $1`,
//       [session_id]
//     );

//     if (sessionResult.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     // Get attendance records
//     const recordsResult = await db.query(
//       `SELECT 
//         ar.id, ar.status, ar.marked_at, ar.confidence_score,
//         st.student_id, st.name, st.email, st.department
//        FROM attendance_records ar
//        JOIN students st ON ar.student_id = st.student_id
//        WHERE ar.session_id = $1
//        ORDER BY st.name ASC`,
//       [session_id]
//     );

//     res.json({
//       session: sessionResult.rows[0],
//       records: recordsResult.rows
//     });
//   } catch (error) {
//     console.error('Error fetching session details:', error);
//     res.status(500).json({ error: 'Failed to fetch session details' });
//   }
// });

// // Generate PDF report
// router.get('/sessions/:session_id/pdf', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     const sessionResult = await db.query(
//       `SELECT s.*, u.username as faculty_name, sub.subject_name as subject_name, sub.subject_code as subject_code
//        FROM attendance_sessions s
//        LEFT JOIN users u ON s.faculty_id = u.id
//        LEFT JOIN subjects sub ON s.subject_id = sub.id
//        WHERE s.id = $1`,
//       [session_id]
//     );

//     if (sessionResult.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     const session = sessionResult.rows[0];

//     const recordsResult = await db.query(
//       `SELECT 
//         ar.status, ar.marked_at, ar.confidence_score,
//         st.student_id, st.name, st.email, st.department
//        FROM attendance_records ar
//        JOIN students st ON ar.student_id = st.student_id
//        WHERE ar.session_id = $1
//        ORDER BY st.name ASC`,
//       [session_id]
//     );

//     const doc = new PDFDocument({ margin: 50 });
    
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=attendance_${session_id}.pdf`);
    
//     doc.pipe(res);

//     doc.fontSize(20).text('Attendance Report', { align: 'center' });
//     doc.moveDown();
    
//     doc.fontSize(12);
//     doc.text(`Subject: ${session.subject_name} (${session.subject_code})`);
//     doc.text(`Department: ${session.department || 'N/A'}`);
//     doc.text(`Section: ${session.section || 'N/A'}`);
//     doc.text(`Period: ${session.period_number || 'N/A'}`);
//     doc.text(`Date: ${session.session_date ? moment(session.session_date).format('MMMM Do YYYY') : 'N/A'}`);
//     doc.text(`Time: ${session.session_time || 'N/A'}`);
//     doc.text(`Faculty: ${session.faculty_name}`);
//     doc.moveDown();

//     const presentCount = recordsResult.rows.filter(r => r.status === 'present').length;
//     const absentCount = recordsResult.rows.filter(r => r.status === 'absent').length;
    
//     doc.fontSize(14).text('Summary', { underline: true });
//     doc.fontSize(12);
//     doc.text(`Total Students: ${recordsResult.rows.length}`);
//     doc.text(`Present: ${presentCount}`);
//     doc.text(`Absent: ${absentCount}`);
//     doc.moveDown();

//     doc.fontSize(14).text('Attendance Details', { underline: true });
//     doc.moveDown(0.5);
    
//     const tableTop = doc.y;
//     const col1X = 50;
//     const col2X = 150;
//     const col3X = 300;
//     const col4X = 450;

//     doc.fontSize(10).font('Helvetica-Bold');
//     doc.text('Student ID', col1X, tableTop);
//     doc.text('Name', col2X, tableTop);
//     doc.text('Status', col3X, tableTop);
//     doc.text('Confidence', col4X, tableTop);
    
//     doc.moveTo(col1X, tableTop + 15).lineTo(550, tableTop + 15).stroke();
//     doc.moveDown();

//     doc.font('Helvetica');
//     let y = tableTop + 25;
    
//     recordsResult.rows.forEach((record, index) => {
//       if (y > 700) {
//         doc.addPage();
//         y = 50;
//       }

//       doc.text(record.student_id, col1X, y, { width: 90 });
//       doc.text(record.name, col2X, y, { width: 140 });
//       doc.text(record.status.toUpperCase(), col3X, y, { width: 140 });
      
//       const confidenceText = record.confidence_score 
//         ? `${(record.confidence_score * 100).toFixed(1)}%`
//         : 'N/A';
//       doc.text(confidenceText, col4X, y, { width: 90 });
      
//       y += 20;
//     });

//     doc.fontSize(8).text(
//       `Generated on ${moment().format('MMMM Do YYYY, h:mm:ss a')}`,
//       50,
//       750,
//       { align: 'center' }
//     );

//     doc.end();
//   } catch (error) {
//     console.error('Error generating PDF:', error);
//     res.status(500).json({ error: 'Failed to generate PDF' });
//   }
// });

// router.delete('/sessions/:session_id', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     const result = await db.query(
//       'DELETE FROM attendance_sessions WHERE id = $1 RETURNING id',
//       [session_id]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     res.json({ message: 'Session deleted successfully' });
//   } catch (error) {
//     console.error('Error delating session:', error);
//     res.status(500).json({ error: 'Failed to delete session' });
//   }
// });

// module.exports = router;

// const express = require('express');
// const axios = require('axios');
// const PDFDocument = require('pdfkit');
// const moment = require('moment');
// const { verifyToken } = require('./auth');
// const router = express.Router();

// const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';


// Recognize faces in uploaded image (doesn't save to database)
// router.post('/recognize', verifyToken, async (req, res) => {
//   const { image, department, section, year } = req.body;
//   const db = req.app.locals.db;

//   try {
//     // Get students for this class
//     let query = 'SELECT student_id, name, email, department, face_encoding FROM students WHERE 1=1';
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

//     const studentsResult = await db.query(query, params);

//     const registeredStudents = studentsResult.rows.map(student => ({
//       student_id: student.student_id,
//       name: student.name,
//       email: student.email,
//       department: student.department,
//       face_encoding: JSON.parse(student.face_encoding)
//     }));

//     if (registeredStudents.length === 0) {
//       return res.status(400).json({ error: 'No registered students found for this class' });
//     }

//     // Call ML service
//     const mlResponse = await axios.post(`${ML_SERVICE_URL}/recognize_faces`, {
//       image: image,
//       registered_students: registeredStudents
//     });

//     if (!mlResponse.data.success) {
//       return res.status(400).json({ error: mlResponse.data.error });
//     }

//     res.json({
//       success: true,
//       faces_detected: mlResponse.data.faces_detected,
//       recognized_count: mlResponse.data.recognized_students.length,
//       recognized_students: mlResponse.data.recognized_students,
//       unrecognized_faces: mlResponse.data.unrecognized_faces || 0,
//       low_quality_faces: mlResponse.data.low_quality_faces || 0
//     });
//   } catch (error) {
//     console.error('Recognition error:', error);
//     if (error.response?.data?.error) {
//       res.status(400).json({ error: error.response.data.error });
//     } else {
//       res.status(500).json({ error: 'Failed to recognize faces' });
//     }
//   }
// });

const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { verifyToken } = require('./auth');
const router = express.Router();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
router.post('/recognize', verifyToken, async (req, res) => {
  let { image, department, section, year } = req.body;
  const db = req.app.locals.db;

  try {
    // Normalize case only
    department = String(department).toUpperCase();
    section = String(section).toUpperCase();
    year = String(year).toUpperCase(); // KEEP YEAR-4 AS IS

    console.log(`Recognition request → dept=${department}, section=${section}, year=${year}`);

    const studentsResult = await db.query(
      `SELECT student_id, name, email, department, section, year, face_encoding
       FROM students
       WHERE UPPER(department) = UPPER($1)
         AND UPPER(section) = UPPER($2)
         AND UPPER(year) = UPPER($3)`,
      [department, section, year]
    );

    if (studentsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No registered students found for this class' });
    }

    const registeredStudents = studentsResult.rows.map(s => ({
      student_id: s.student_id,
      name: s.name,
      email: s.email,
      department: s.department,
      section: s.section,
      year: s.year,
      face_encoding: s.face_encoding
    }));

    console.log(`Registered students found: ${registeredStudents.length}`);

    const mlResponse = await axios.post(`${ML_SERVICE_URL}/recognize_faces`, {
      image,
      registered_students: registeredStudents
    });

    if (!mlResponse.data.success) {
      return res.status(400).json({ error: mlResponse.data.error || 'Recognition failed' });
    }

    res.json({
      success: true,
      faces_detected: mlResponse.data.faces_detected || 0,
      recognized_count: mlResponse.data.recognized_students?.length || 0,
      recognized_students: mlResponse.data.recognized_students || [],
      unrecognized_faces: mlResponse.data.unrecognized_faces || 0
    });


  } catch (error) {
    console.error('Recognition error:', error);
    if (error.response?.data) {
      res.status(400).json({ error: error.response.data.error || 'Recognition failed' });
    } else {
      res.status(500).json({ error: 'Failed to recognize faces: ' + error.message });
    }
  }
});

router.post('/recognize-multiple', verifyToken, async (req, res) => {
  let { images, department, section, year } = req.body;
  const db = req.app.locals.db;

  try {
    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'At least one image is required' });
    }

    department = String(department).toUpperCase();
    section = String(section).toUpperCase();
    year = String(year).toUpperCase();

    console.log(`Multi-recognition → ${images.length} images`);

    // 1️⃣ Get registered students
    const studentsResult = await db.query(
      `SELECT student_id, name, email, department, section, year, face_encoding
       FROM students
       WHERE UPPER(department) = UPPER($1)
         AND UPPER(section) = UPPER($2)
         AND UPPER(year) = UPPER($3)`,
      [department, section, year]
    );

    if (studentsResult.rows.length === 0) {
      return res.status(400).json({ error: 'No registered students found for this class' });
    }

    const registeredStudents = studentsResult.rows.map(s => ({
      student_id: s.student_id,
      name: s.name,
      email: s.email,
      department: s.department,
      section: s.section,
      year: s.year,
      face_encoding: s.face_encoding
    }));

    // 2️⃣ Send ALL images to ML service
    const mlResponse = await axios.post(
      `${ML_SERVICE_URL}/recognize_faces_multiple`,
      {
        images,
        registered_students: registeredStudents
      }
    );

    if (!mlResponse.data.success) {
      return res.status(400).json({
        error: mlResponse.data.error || 'Multi-image recognition failed'
      });
    }

    // 3️⃣ Merge & de-duplicate results
    const recognizedMap = new Map();
    let totalDetections = 0;        // raw detections
    const detectedFaceIds = new Set(); // unique faces (students)
    let unrecognizedFaces = 0;

    for (const result of mlResponse.data.results) {
      totalDetections += result.faces_detected || 0;

      for (const student of result.recognized_students || []) {
        detectedFaceIds.add(student.student_id);

        const existing = recognizedMap.get(student.student_id);
        if (!existing || student.confidence > existing.confidence) {
          recognizedMap.set(student.student_id, student);
        }
      }
    }

    const recognizedStudents = Array.from(recognizedMap.values());

    res.json({
      success: true,
      images_processed: images.length,

      // ✅ RAW detections (can be high)
      total_face_detections: totalDetections,

      // ✅ UNIQUE students (attendance-relevant)
      unique_faces_detected: detectedFaceIds.size,

      recognized_students: Array.from(recognizedMap.values()),
      recognized_count: recognizedMap.size
    });
  } catch (error) {
    console.error('recognize-multiple error:', error);
    res.status(500).json({
      error: 'Failed to recognize faces (multi-image)',
      details: error.message
    });
  }
});

router.post('/mark', verifyToken, async (req, res) => {
  const {
    subject_id,
    department,
    section,
    year,
    session_date,
    session_time,
    period_number,
    attendance_records
  } = req.body;

  const db = req.app.locals.db;

  try {

    
    // 1. Prevent duplicate attendance
    const duplicateCheck = await db.query(
      `SELECT id FROM attendance_sessions
       WHERE subject_id = $1 AND
         department = $2 AND
         section = $3 AND
         year = $4 AND
         session_date = $5 AND
         period_number = $6`,
      [subject_id, department, section, year, session_date, period_number]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: `Attendance already marked for Period ${period_number} on ${session_date}`
      });
    }

    // 2. Insert new attendance session
    const sessionResult = await db.query(
      `INSERT INTO attendance_sessions 
        (subject_id, faculty_id, department, section, year, session_date, session_time, period_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [subject_id, req.user.id, department, section, year, session_date, session_time, period_number]
    );

    const sessionId = sessionResult.rows[0].id;

    // 3. Insert records
    const promises = attendance_records.map(r =>
      db.query(
        `INSERT INTO attendance_records (session_id, student_id, status, confidence_score)
        VALUES ($1, $2, $3, $4)`,
        [sessionId, r.student_id, r.status, r.confidence_score || null]
      )
    );

    await Promise.all(promises);

    res.json({ success: true, session_id: sessionId });
  } catch (error) {
    console.error('Attendance mark error:', error);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

router.post('/mark-multiple', verifyToken, async (req, res) => {
  const {
    subject_id,
    department,
    section,
    year,
    session_date,
    session_time,
    period_number,
    recognized_students   // 👈 OUTPUT of recognize-multiple
  } = req.body;

  const db = req.app.locals.db;

  try {
    if (!recognized_students || !Array.isArray(recognized_students)) {
      return res.status(400).json({
        error: 'recognized_students array is required'
      });
    }

    // 1️⃣ Prevent duplicate attendance
    const duplicateCheck = await db.query(
      `SELECT id FROM attendance_sessions
       WHERE subject_id=$1 AND department=$2 AND section=$3 AND year=$4
         AND session_date=$5 AND period_number=$6`,
      [subject_id, department, section, year, session_date, period_number]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({
        error: `Attendance already marked for Period ${period_number}`
      });
    }

    // 2️⃣ Fetch all students in class
    const studentsResult = await db.query(
      `SELECT student_id FROM students
       WHERE UPPER(department)=UPPER($1)
         AND UPPER(section)=UPPER($2)
         AND UPPER(year)=UPPER($3)`,
      [department, section, year]
    );

    // 3️⃣ Insert session
    const sessionResult = await db.query(
      `INSERT INTO attendance_sessions
       (subject_id, faculty_id, department, section, year,
        session_date, session_time, period_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        subject_id,
        req.user.id,
        department,
        section,
        year,
        session_date,
        session_time,
        period_number
      ]
    );

    const sessionId = sessionResult.rows[0].id;

    // 4️⃣ Create lookup of present students
    const presentMap = new Map();
    recognized_students.forEach(s => {
      presentMap.set(s.student_id, s.confidence || null);
    });

    // 5️⃣ Insert attendance records
    const insertPromises = studentsResult.rows.map(student => {
      const isPresent = presentMap.has(student.student_id);

      return db.query(
        `INSERT INTO attendance_records
         (session_id, student_id, status, confidence_score)
         VALUES ($1,$2,$3,$4)`,
        [
          sessionId,
          student.student_id,
          isPresent ? 'present' : 'absent',
          isPresent ? presentMap.get(student.student_id) : null
        ]
      );
    });

    await Promise.all(insertPromises);

    res.json({
      success: true,
      session_id: sessionId,
      present_count: presentMap.size,
      total_students: studentsResult.rows.length
    });

  } catch (error) {
    console.error('mark-multiple error:', error);
    res.status(500).json({
      error: 'Failed to mark attendance (multi-image)',
      details: error.message
    });
  }
});


// Get all attendance sessions
router.get('/sessions', verifyToken, async (req, res) => {
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `SELECT 
        s.id,
        s.department,
        s.section,
        s.session_date,
        s.period_number,
        s.created_at,
        sub.subject_name AS course_name,
        sub.subject_code AS subject_code,
        u.username AS faculty_name,
        COUNT(ar.id) FILTER (WHERE ar.status = 'present') AS present_count,
        COUNT(ar.id) FILTER (WHERE ar.status = 'absent') AS absent_count,
        COUNT(ar.id) AS total_count
    FROM attendance_sessions s
    LEFT JOIN subjects sub ON s.subject_id = sub.id
    LEFT JOIN users u ON s.faculty_id = u.id
    LEFT JOIN attendance_records ar ON s.id = ar.session_id
    GROUP BY s.id, sub.subject_name, sub.subject_code, u.username
    ORDER BY s.session_date DESC, s.session_time DESC;
    `
    );

    res.json({ sessions: result.rows });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Get attendance details for a session
router.get('/sessions/:session_id', verifyToken, async (req, res) => {
  const { session_id } = req.params;
  const db = req.app.locals.db;

  try {
    // Get session info
    const sessionResult = await db.query(
      `SELECT s.*, u.username as faculty_name,
              sub.subject_name, sub.subject_code
       FROM attendance_sessions s
       LEFT JOIN users u ON s.faculty_id = u.id
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       WHERE s.id = $1`,
      [session_id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get attendance records
    const recordsResult = await db.query(
      `SELECT 
          ar.id,
          ar.status,
          st.student_id,
          st.name,
          st.department
      FROM attendance_records ar
      JOIN students st ON ar.student_id = st.student_id
      WHERE ar.session_id = $1
      ORDER BY st.student_id ASC`,
      [session_id]
    );


    res.json({
      session: sessionResult.rows[0],
      records: recordsResult.rows
    });
  } catch (error) {
    console.error('Error fetching session details:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Generate PDF report
router.get('/sessions/:session_id/pdf', verifyToken, async (req, res) => {
  const { session_id } = req.params;
  const db = req.app.locals.db;

  try {
    const sessionResult = await db.query(
      `SELECT s.*, u.username as faculty_name, 
              sub.subject_name, sub.subject_code
       FROM attendance_sessions s
       LEFT JOIN users u ON s.faculty_id = u.id
       LEFT JOIN subjects sub ON s.subject_id = sub.id
       WHERE s.id = $1`,
      [session_id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];

    const recordsResult = await db.query(
      `SELECT 
        ar.status,
        st.student_id, st.name, st.email, st.department
       FROM attendance_records ar
       JOIN students st ON ar.student_id = st.student_id
       WHERE ar.session_id = $1
       ORDER BY st.name ASC`,
      [session_id]
    );

    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${session_id}.pdf`);
    
    doc.pipe(res);

    doc.fontSize(20).text('Attendance Report', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12);
    doc.text(`Subject: ${session.subject_name || 'N/A'} (${session.subject_code || 'N/A'})`);
    doc.text(`Department: ${session.department || 'N/A'}`);
    doc.text(`Section: ${session.section || 'N/A'}`);
    doc.text(`Period: ${session.period_number || 'N/A'}`);
    doc.text(`Date: ${session.session_date ? moment(session.session_date).format('MMMM Do YYYY') : 'N/A'}`);
    doc.text(`Time: ${session.session_time || 'N/A'}`);
    doc.text(`Faculty: ${session.faculty_name}`);
    doc.moveDown();

    const presentCount = recordsResult.rows.filter(r => r.status === 'present').length;
    const absentCount = recordsResult.rows.filter(r => r.status === 'absent').length;
    
    doc.fontSize(14).text('Summary', { underline: true });
    doc.fontSize(12);
    doc.text(`Total Students: ${recordsResult.rows.length}`);
    doc.text(`Present: ${presentCount}`);
    doc.text(`Absent: ${absentCount}`);
    doc.moveDown();

    doc.fontSize(14).text('Attendance Details', { underline: true });
    doc.moveDown(0.5);
    
    const tableTop = doc.y;
    const col1X = 50;
    const col2X = 200;
    const col3X = 380;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Student ID', col1X, tableTop);
    doc.text('Name', col2X, tableTop);
    doc.text('Status', col3X, tableTop);

    doc.moveTo(col1X, tableTop + 15).lineTo(550, tableTop + 15).stroke();
    doc.moveDown();

    doc.font('Helvetica');
    let y = tableTop + 25;

    recordsResult.rows.forEach((record) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(record.student_id, col1X, y, { width: 120 });
      doc.text(record.name, col2X, y, { width: 160 });
      doc.text(record.status.toUpperCase(), col3X, y, { width: 100 });

      y += 20;
    });

    doc.fontSize(8).text(
      `Generated on ${moment().format('MMMM Do YYYY, h:mm:ss a')}`,
      50,
      750,
      { align: 'center' }
    );

    doc.end();
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

router.delete('/sessions/:session_id', verifyToken, async (req, res) => {
  const { session_id } = req.params;
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      'DELETE FROM attendance_sessions WHERE id = $1 RETURNING id',
      [session_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Error delating session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;

// // Mark attendance from group photo with enhanced verification
// router.post('/mark', verifyToken, async (req, res) => {
//   const { 
//     subject_id,      // Changed from session_name and course_name
//     department, 
//     section, 
//     session_date, 
//     session_time,
//     period_number,   // Added
//     image 
//   } = req.body;
//   const db = req.app.locals.db;

//   try {
//     // Get all registered students with face encodings
//     const studentsResult = await db.query(
//       'SELECT student_id, name, email, department, face_encoding FROM students'
//     );

//     const registeredStudents = studentsResult.rows.map(student => ({
//       student_id: student.student_id,
//       name: student.name,
//       email: student.email,
//       department: student.department,
//       face_encoding: JSON.parse(student.face_encoding)
//     }));

//     if (registeredStudents.length === 0) {
//       return res.status(400).json({ error: 'No registered students found' });
//     }

//     // Call ML service to recognize faces with enhanced verification
//     const mlResponse = await axios.post(`${ML_SERVICE_URL}/recognize_faces`, {
//       image: image,
//       registered_students: registeredStudents
//     });

//     if (!mlResponse.data.success) {
//       return res.status(400).json({ error: mlResponse.data.error });
//     }

//     const recognizedStudents = mlResponse.data.recognized_students;
//     const unrecognizedFaces = mlResponse.data.unrecognized_faces || 0;
//     const lowQualityFaces = mlResponse.data.low_quality_faces || 0;

//     // Create attendance session
//     const sessionResult = await db.query(
//       `INSERT INTO attendance_sessions 
//        (subject_id, faculty_id, department, section, session_date, session_time, period_number) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7) 
//        RETURNING id`,
//       [subject_id, req.user.id, department, section, session_date, session_time, period_number]
//     );

//     const sessionId = sessionResult.rows[0].id;

//     // Get list of recognized student IDs
//     const recognizedIds = new Set(recognizedStudents.map(s => s.student_id));

//     // Mark attendance for all registered students
//     const attendancePromises = registeredStudents.map(student => {
//       const isPresent = recognizedIds.has(student.student_id);
//       const recognizedStudent = recognizedStudents.find(s => s.student_id === student.student_id);
      
//       return db.query(
//         `INSERT INTO attendance_records (session_id, student_id, status, confidence_score) 
//          VALUES ($1, $2, $3, $4)`,
//         [
//           sessionId,
//           student.student_id,
//           isPresent ? 'present' : 'absent',
//           isPresent ? recognizedStudent.confidence : null
//         ]
//       );
//     });

//     await Promise.all(attendancePromises);

//     // Get attendance summary
//     const summary = await db.query(
//       `SELECT 
//         COUNT(*) FILTER (WHERE status = 'present') as present_count,
//         COUNT(*) FILTER (WHERE status = 'absent') as absent_count,
//         COUNT(*) as total_count
//        FROM attendance_records 
//        WHERE session_id = $1`,
//       [sessionId]
//     );

//     res.json({
//       message: 'Attendance marked successfully',
//       session_id: sessionId,
//       faces_detected: mlResponse.data.faces_detected,
//       recognized_count: recognizedStudents.length,
//       unrecognized_faces: unrecognizedFaces,
//       low_quality_faces: lowQualityFaces,
//       summary: summary.rows[0],
//       recognized_students: recognizedStudents,
//       warning: unrecognizedFaces > 0 ? 
//         `${unrecognizedFaces} face(s) detected but not matched to any registered student` : null
//     });
//   } catch (error) {
//     console.error('Attendance marking error:', error);
//     if (error.response?.data?.error) {
//       res.status(400).json({ error: error.response.data.error });
//     } else {
//       res.status(500).json({ error: 'Failed to mark attendance' });
//     }
//   }
// });

// router.post('/mark', verifyToken, async (req, res) => {
//   const { 
//     subject_id,
//     department, 
//     section,
//     year,
//     session_date, 
//     session_time,
//     period_number,
//     attendance_records  // Array of {student_id, status, confidence_score}
//   } = req.body;
//   const db = req.app.locals.db;

//   try {
//     if (!attendance_records || attendance_records.length === 0) {
//       return res.status(400).json({ error: 'No attendance records provided' });
//     }

//     // Create attendance session
//     const sessionResult = await db.query(
//       `INSERT INTO attendance_sessions 
//        (subject_id, faculty_id, department, section, session_date, session_time, period_number) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7) 
//        RETURNING id`,
//       [subject_id, req.user.id, department, section, session_date, session_time, period_number]
//     );

//     const sessionId = sessionResult.rows[0].id;

//     // Insert attendance records
//     const attendancePromises = attendance_records.map(record => {
//       return db.query(
//         `INSERT INTO attendance_records (session_id, student_id, status, confidence_score) 
//          VALUES ($1, $2, $3, $4)`,
//         [sessionId, record.student_id, record.status, record.confidence_score]
//       );
//     });

//     await Promise.all(attendancePromises);

//     // Get attendance summary
//     const summary = await db.query(
//       `SELECT 
//         COUNT(*) FILTER (WHERE status = 'present') as present_count,
//         COUNT(*) FILTER (WHERE status = 'absent') as absent_count,
//         COUNT(*) as total_count
//        FROM attendance_records 
//        WHERE session_id = $1`,
//       [sessionId]
//     );

//     res.json({
//       message: 'Attendance marked successfully',
//       session_id: sessionId,
//       summary: summary.rows[0]
//     });
//   } catch (error) {
//     console.error('Attendance marking error:', error);
//     res.status(500).json({ error: 'Failed to mark attendance' });
//   }
// });



// const express = require('express');
// const axios = require('axios');
// const PDFDocument = require('pdfkit');
// const moment = require('moment');
// const { verifyToken } = require('./auth');
// const router = express.Router();

// const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

// // Recognize faces in uploaded image (doesn't save to database)
// router.post('/recognize', verifyToken, async (req, res) => {
//   const { image, department, section, year } = req.body;
//   const db = req.app.locals.db;

//   try {
//     // Get students for this class
//     let query = 'SELECT student_id, name, email, department, face_encoding FROM students WHERE 1=1';
//     const params = [];
//     let paramCount = 1;

//     if (department) {
//       query += ` AND department = ${paramCount}`;
//       params.push(department);
//       paramCount++;
//     }
//     if (section) {
//       query += ` AND section = ${paramCount}`;
//       params.push(section);
//       paramCount++;
//     }
//     if (year) {
//       query += ` AND year = ${paramCount}`;
//       params.push(year);
//       paramCount++;
//     }

//     const studentsResult = await db.query(query, params);

//     const registeredStudents = studentsResult.rows.map(student => ({
//       student_id: student.student_id,
//       name: student.name,
//       email: student.email,
//       department: student.department,
//       face_encoding: JSON.parse(student.face_encoding)
//     }));

//     if (registeredStudents.length === 0) {
//       return res.status(400).json({ error: 'No registered students found for this class' });
//     }

//     // Call ML service
//     const mlResponse = await axios.post(`${ML_SERVICE_URL}/recognize_faces`, {
//       image: image,
//       registered_students: registeredStudents
//     });

//     if (!mlResponse.data.success) {
//       return res.status(400).json({ error: mlResponse.data.error });
//     }

//     res.json({
//       success: true,
//       faces_detected: mlResponse.data.faces_detected,
//       recognized_count: mlResponse.data.recognized_students.length,
//       recognized_students: mlResponse.data.recognized_students,
//       unrecognized_faces: mlResponse.data.unrecognized_faces || 0,
//       low_quality_faces: mlResponse.data.low_quality_faces || 0
//     });
//   } catch (error) {
//     console.error('Recognition error:', error);
//     if (error.response?.data?.error) {
//       res.status(400).json({ error: error.response.data.error });
//     } else {
//       res.status(500).json({ error: 'Failed to recognize faces' });
//     }
//   }
// });

// // Mark attendance (saves to database)
// router.post('/mark', verifyToken, async (req, res) => {
//   const { 
//     subject_id,
//     department, 
//     section,
//     year,
//     session_date, 
//     session_time,
//     period_number,
//     attendance_records  // Array of {student_id, status, confidence_score}
//   } = req.body;
//   const db = req.app.locals.db;

//   try {
//     if (!attendance_records || attendance_records.length === 0) {
//       return res.status(400).json({ error: 'No attendance records provided' });
//     }

//     // Create attendance session
//     const sessionResult = await db.query(
//       `INSERT INTO attendance_sessions 
//        (subject_id, faculty_id, department, section, session_date, session_time, period_number) 
//        VALUES ($1, $2, $3, $4, $5, $6, $7) 
//        RETURNING id`,
//       [subject_id, req.user.id, department, section, session_date, session_time, period_number]
//     );

//     const sessionId = sessionResult.rows[0].id;

//     // Insert attendance records
//     const attendancePromises = attendance_records.map(record => {
//       return db.query(
//         `INSERT INTO attendance_records (session_id, student_id, status, confidence_score) 
//          VALUES ($1, $2, $3, $4)`,
//         [sessionId, record.student_id, record.status, record.confidence_score]
//       );
//     });

//     await Promise.all(attendancePromises);

//     // Get attendance summary
//     const summary = await db.query(
//       `SELECT 
//         COUNT(*) FILTER (WHERE status = 'present') as present_count,
//         COUNT(*) FILTER (WHERE status = 'absent') as absent_count,
//         COUNT(*) as total_count
//        FROM attendance_records 
//        WHERE session_id = $1`,
//       [sessionId]
//     );

//     res.json({
//       message: 'Attendance marked successfully',
//       session_id: sessionId,
//       summary: summary.rows[0]
//     });
//   } catch (error) {
//     console.error('Attendance marking error:', error);
//     res.status(500).json({ error: 'Failed to mark attendance' });
//   }
// });

// // Get all attendance sessions
// router.get('/sessions', verifyToken, async (req, res) => {
//   const db = req.app.locals.db;

//   try {
//     const result = await db.query(
//       `SELECT 
//         s.id, s.subject_id, s.department, s.section, 
//         s.session_date, s.session_time, s.period_number, s.created_at,
//         COALESCE(sub.subject_name, 'Unknown Subject') as session_name,
//         COALESCE(sub.subject_code, '') as subject_code,
//         u.username as faculty_name,
//         COUNT(ar.id) FILTER (WHERE ar.status = 'present') as present_count,
//         COUNT(ar.id) FILTER (WHERE ar.status = 'absent') as absent_count,
//         COUNT(ar.id) as total_count
//        FROM attendance_sessions s
//        LEFT JOIN subjects sub ON s.subject_id = sub.id
//        LEFT JOIN users u ON s.faculty_id = u.id
//        LEFT JOIN attendance_records ar ON s.id = ar.session_id
//        GROUP BY s.id, sub.subject_name, sub.subject_code, u.username
//        ORDER BY s.session_date DESC, s.session_time DESC`
//     );

//     res.json({ sessions: result.rows });
//   } catch (error) {
//     console.error('Error fetching sessions:', error);
//     res.status(500).json({ error: 'Failed to fetch sessions' });
//   }
// });

// // Get attendance details for a session
// router.get('/sessions/:session_id', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     // Get session info
//     const sessionResult = await db.query(
//       `SELECT s.*, u.username as faculty_name,
//               sub.subject_name, sub.subject_code
//        FROM attendance_sessions s
//        LEFT JOIN users u ON s.faculty_id = u.id
//        LEFT JOIN subjects sub ON s.subject_id = sub.id
//        WHERE s.id = $1`,
//       [session_id]
//     );

//     if (sessionResult.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     // Get attendance records
//     const recordsResult = await db.query(
//       `SELECT 
//         ar.id, ar.status, ar.marked_at, ar.confidence_score,
//         st.student_id, st.name, st.email, st.department
//        FROM attendance_records ar
//        JOIN students st ON ar.student_id = st.student_id
//        WHERE ar.session_id = $1
//        ORDER BY st.name ASC`,
//       [session_id]
//     );

//     res.json({
//       session: sessionResult.rows[0],
//       records: recordsResult.rows
//     });
//   } catch (error) {
//     console.error('Error fetching session details:', error);
//     res.status(500).json({ error: 'Failed to fetch session details' });
//   }
// });

// // Generate PDF report
// router.get('/sessions/:session_id/pdf', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     const sessionResult = await db.query(
//       `SELECT s.*, u.username as faculty_name, 
//               sub.subject_name, sub.subject_code
//        FROM attendance_sessions s
//        LEFT JOIN users u ON s.faculty_id = u.id
//        LEFT JOIN subjects sub ON s.subject_id = sub.id
//        WHERE s.id = $1`,
//       [session_id]
//     );

//     if (sessionResult.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     const session = sessionResult.rows[0];

//     const recordsResult = await db.query(
//       `SELECT 
//         ar.status, ar.marked_at, ar.confidence_score,
//         st.student_id, st.name, st.email, st.department
//        FROM attendance_records ar
//        JOIN students st ON ar.student_id = st.student_id
//        WHERE ar.session_id = $1
//        ORDER BY st.name ASC`,
//       [session_id]
//     );

//     const doc = new PDFDocument({ margin: 50 });
    
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `attachment; filename=attendance_${session_id}.pdf`);
    
//     doc.pipe(res);

//     doc.fontSize(20).text('Attendance Report', { align: 'center' });
//     doc.moveDown();
    
//     doc.fontSize(12);
//     doc.text(`Subject: ${session.subject_name || 'N/A'} (${session.subject_code || 'N/A'})`);
//     doc.text(`Department: ${session.department || 'N/A'}`);
//     doc.text(`Section: ${session.section || 'N/A'}`);
//     doc.text(`Period: ${session.period_number || 'N/A'}`);
//     doc.text(`Date: ${session.session_date ? moment(session.session_date).format('MMMM Do YYYY') : 'N/A'}`);
//     doc.text(`Time: ${session.session_time || 'N/A'}`);
//     doc.text(`Faculty: ${session.faculty_name}`);
//     doc.moveDown();

//     const presentCount = recordsResult.rows.filter(r => r.status === 'present').length;
//     const absentCount = recordsResult.rows.filter(r => r.status === 'absent').length;
    
//     doc.fontSize(14).text('Summary', { underline: true });
//     doc.fontSize(12);
//     doc.text(`Total Students: ${recordsResult.rows.length}`);
//     doc.text(`Present: ${presentCount}`);
//     doc.text(`Absent: ${absentCount}`);
//     doc.moveDown();

//     doc.fontSize(14).text('Attendance Details', { underline: true });
//     doc.moveDown(0.5);
    
//     const tableTop = doc.y;
//     const col1X = 50;
//     const col2X = 150;
//     const col3X = 300;
//     const col4X = 450;

//     doc.fontSize(10).font('Helvetica-Bold');
//     doc.text('Student ID', col1X, tableTop);
//     doc.text('Name', col2X, tableTop);
//     doc.text('Status', col3X, tableTop);
//     doc.text('Confidence', col4X, tableTop);
    
//     doc.moveTo(col1X, tableTop + 15).lineTo(550, tableTop + 15).stroke();
//     doc.moveDown();

//     doc.font('Helvetica');
//     let y = tableTop + 25;
    
//     recordsResult.rows.forEach((record, index) => {
//       if (y > 700) {
//         doc.addPage();
//         y = 50;
//       }

//       doc.text(record.student_id, col1X, y, { width: 90 });
//       doc.text(record.name, col2X, y, { width: 140 });
//       doc.text(record.status.toUpperCase(), col3X, y, { width: 140 });
      
//       const confidenceText = record.confidence_score 
//         ? `${(record.confidence_score * 100).toFixed(1)}%`
//         : 'N/A';
//       doc.text(confidenceText, col4X, y, { width: 90 });
      
//       y += 20;
//     });

//     doc.fontSize(8).text(
//       `Generated on ${moment().format('MMMM Do YYYY, h:mm:ss a')}`,
//       50,
//       750,
//       { align: 'center' }
//     );

//     doc.end();
//   } catch (error) {
//     console.error('Error generating PDF:', error);
//     res.status(500).json({ error: 'Failed to generate PDF' });
//   }
// });

// router.delete('/sessions/:session_id', verifyToken, async (req, res) => {
//   const { session_id } = req.params;
//   const db = req.app.locals.db;

//   try {
//     const result = await db.query(
//       'DELETE FROM attendance_sessions WHERE id = $1 RETURNING id',
//       [session_id]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ error: 'Session not found' });
//     }

//     res.json({ message: 'Session deleted successfully' });
//   } catch (error) {
//     console.error('Error delating session:', error);
//     res.status(500).json({ error: 'Failed to delete session' });
//   }
// });

// module.exports = router;