const express = require('express');
const PDFDocument = require('pdfkit');
const moment = require('moment');
const { verifyToken } = require('./auth');
const router = express.Router();

// Get individual student attendance report
router.get('/student/:student_id', verifyToken, async (req, res) => {
  const { student_id } = req.params;
  const { start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    /* =========================
       STUDENT INFO
    ========================= */
    const studentInfo = await db.query(
      `SELECT student_id, name, department, section, year
       FROM students
       WHERE student_id = $1`,
      [student_id]
    );

    if (studentInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentInfo.rows[0];

    /* =========================
       SUBJECT-WISE ATTENDANCE
       🔴 FIXED LOGIC
    ========================= */
    let query = `
      SELECT
        sub.subject_code,
        sub.subject_name,
        sub.subject_type,
        COUNT(ats.id) AS total_classes,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) AS classes_attended,
        COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) AS classes_absent
      FROM subjects sub

      LEFT JOIN attendance_sessions ats
        ON ats.subject_id = sub.id
        ${start_date ? 'AND ats.session_date >= $2' : ''}
        ${end_date ? 'AND ats.session_date <= $3' : ''}

      LEFT JOIN attendance_records ar
        ON ar.session_id = ats.id
       AND ar.student_id = $1

      WHERE sub.department = $4
        AND sub.year = $5

      GROUP BY sub.id, sub.subject_code, sub.subject_name, sub.subject_type
      ORDER BY sub.subject_type, sub.subject_name
    `;

    const params = [
      student_id,
      start_date || null,
      end_date || null,
      student.department,
      student.year
    ];

    const attendanceData = await db.query(query, params);

    /* =========================
       OVERALL CALCULATION
    ========================= */
    const totalClasses = attendanceData.rows.reduce(
      (sum, r) => sum + Number(r.total_classes || 0),
      0
    );

    const totalAttended = attendanceData.rows.reduce(
      (sum, r) => sum + Number(r.classes_attended || 0),
      0
    );

    const percentage =
      totalClasses > 0
        ? Number(((totalAttended / totalClasses) * 100).toFixed(2))
        : 0;

    /* =========================
       RESPONSE
    ========================= */
    res.json({
      student,
      period: {
        start_date: start_date || 'All time',
        end_date: end_date || 'Present'
      },
      overall: {
        total_classes: totalClasses,
        classes_attended: totalAttended,
        classes_absent: totalClasses - totalAttended,
        percentage
      },
      subjects: attendanceData.rows.map(r => ({
        subject_code: r.subject_code,
        subject_name: r.subject_name,
        subject_type: r.subject_type,
        total_classes: Number(r.total_classes),
        classes_attended: Number(r.classes_attended),
        classes_absent: Number(r.classes_absent),
        percentage:
          r.total_classes > 0
            ? Number(((r.classes_attended / r.total_classes) * 100).toFixed(2))
            : 0
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});


// Get class attendance report (all students)
// Get class attendance report
router.get('/class', verifyToken, async (req, res) => {
  const { department, section, year, subject_id, start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    console.log('Fetching class report for:', { department, section, year, subject_id, start_date, end_date });

    if (!department || !section || !year) {
      return res.status(400).json({ error: 'Department, section, and year are required' });
    }

    // First get all students in the class
    const studentsResult = await db.query(
      'SELECT student_id, name FROM students WHERE department = $1 AND section = $2 AND year = $3 ORDER BY name',
      [department, section, year]
    );

    console.log('Students found:', studentsResult.rows.length);

    if (studentsResult.rows.length === 0) {
      return res.json({
        department,
        section,
        year,
        students: []
      });
    }

    // Get attendance records for these students
    let query = `
      SELECT 
        st.student_id,
        st.name,
        sub.id as subject_id,
        sub.subject_code,
        sub.subject_name,
        COUNT(ar.id) as total_classes,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as classes_attended,
        COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) as classes_absent
      FROM students st
      LEFT JOIN attendance_records ar ON ar.student_id = st.student_id
      LEFT JOIN attendance_sessions ats ON ar.session_id = ats.id
      LEFT JOIN subjects sub ON ats.subject_id = sub.id
      WHERE st.department = $1 AND st.section = $2 AND st.year = $3
    `;

    const params = [department, section, year];
    let paramCount = 4;

    if (subject_id) {
      query += ` AND sub.id = $${paramCount}`;
      params.push(subject_id);
      paramCount++;
    }

    if (start_date) {
      query += ` AND ats.session_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND ats.session_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += `
      GROUP BY st.student_id, st.name, sub.id, sub.subject_code, sub.subject_name
      ORDER BY st.name, sub.subject_code
    `;

    console.log('Attendance Query:', query);
    console.log('Params:', params);

    const result = await db.query(query, params);
    console.log('Attendance records found:', result.rows.length);

    // Group by student
    const studentMap = {};
    
    // Initialize all students
    studentsResult.rows.forEach(student => {
      studentMap[student.student_id] = {
        student_id: student.student_id,
        name: student.name,
        subjects: [],
        overall: { total: 0, attended: 0, percentage: 0 }
      };
    });

    // Add attendance data
    result.rows.forEach(row => {
      if (row.subject_id) { // Only add if there's actual subject data
        const subjectData = {
          subject_code: row.subject_code,
          subject_name: row.subject_name,
          total_classes: parseInt(row.total_classes || 0),
          classes_attended: parseInt(row.classes_attended || 0),
          classes_absent: parseInt(row.classes_absent || 0),
          percentage: row.total_classes > 0 
            ? parseFloat(((row.classes_attended / row.total_classes) * 100).toFixed(2))
            : 0
        };

        studentMap[row.student_id].subjects.push(subjectData);
        studentMap[row.student_id].overall.total += subjectData.total_classes;
        studentMap[row.student_id].overall.attended += subjectData.classes_attended;
      }
    });

    // Calculate overall percentages
    Object.values(studentMap).forEach(student => {
      student.overall.percentage = student.overall.total > 0
        ? parseFloat(((student.overall.attended / student.overall.total) * 100).toFixed(2))
        : 0;
    });

    console.log('Final student count:', Object.values(studentMap).length);

    res.json({
      department,
      section,
      year,
      students: Object.values(studentMap)
    });
  } catch (error) {
    console.error('Error generating class report:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to generate class report: ' + error.message });
  }
});

// Generate PDF for individual student
router.get('/student/:student_id/pdf', verifyToken, async (req, res) => {
  const { student_id } = req.params;
  const { start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    // Get student info
    const studentInfo = await db.query(
      'SELECT * FROM students WHERE student_id = $1',
      [student_id]
    );

    if (studentInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentInfo.rows[0];

    // Get attendance data
    let query = `
      SELECT 
        sub.subject_code,
        sub.subject_name,
        sub.subject_type,
        COUNT(ar.id) as total_classes,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as classes_attended,
        COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) as classes_absent
      FROM attendance_sessions ats
      JOIN subjects sub ON ats.subject_id = sub.id
      LEFT JOIN attendance_records ar ON ats.id = ar.session_id AND ar.student_id = $1
      WHERE 1=1
    `;

    const params = [student_id];
    let paramCount = 2;

    if (start_date) {
      query += ` AND ats.session_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND ats.session_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += `
      GROUP BY sub.id, sub.subject_code, sub.subject_name, sub.subject_type
      ORDER BY sub.subject_type, sub.subject_name
    `;

    const attendanceData = await db.query(query, params);
    
    const totalClasses = attendanceData.rows.reduce((sum, row) => sum + parseInt(row.total_classes || 0), 0);
    const totalAttended = attendanceData.rows.reduce((sum, row) => sum + parseInt(row.classes_attended || 0), 0);
    const overallPercentage = totalClasses > 0 ? ((totalAttended / totalClasses) * 100).toFixed(2) : 0;

    // Create PDF
    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_${student_id}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Student Attendance Report', { align: 'center' });
    doc.moveDown();

    // Student Info
    doc.fontSize(12);
    doc.text(`Student ID: ${student.student_id}`);
    doc.text(`Name: ${student.name}`);
    doc.text(`Department: ${student.department} - Section: ${student.section}`);
    doc.text(`Year: ${student.year || 'N/A'}`);
    doc.moveDown();

    // Overall Summary
    doc.fontSize(14).text('Overall Attendance', { underline: true });
    doc.fontSize(12);
    doc.text(`Total Classes: ${totalClasses}`);
    doc.text(`Classes Attended: ${totalAttended}`);
    doc.text(`Classes Absent: ${totalClasses - totalAttended}`);
    doc.text(`Attendance Percentage: ${overallPercentage}%`);
    doc.moveDown();

    // Subject-wise breakdown
    doc.fontSize(14).text('Subject-wise Attendance', { underline: true });
    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    const col1X = 50;
    const col2X = 150;
    const col3X = 320;
    const col4X = 390;
    const col5X = 460;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Subject Code', col1X, tableTop);
    doc.text('Subject Name', col2X, tableTop);
    doc.text('Total', col3X, tableTop);
    doc.text('Present', col4X, tableTop);
    doc.text('Percentage', col5X, tableTop);
    
    doc.moveTo(col1X, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    // Table rows
    doc.font('Helvetica');
    let y = tableTop + 25;

    attendanceData.rows.forEach((record) => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      const total = parseInt(record.total_classes || 0);
      const attended = parseInt(record.classes_attended || 0);
      const percentage = total > 0 ? ((attended / total) * 100).toFixed(2) : 0;

      doc.text(record.subject_code, col1X, y, { width: 90 });
      doc.text(record.subject_name, col2X, y, { width: 160 });
      doc.text(total.toString(), col3X, y, { width: 60 });
      doc.text(attended.toString(), col4X, y, { width: 60 });
      doc.text(`${percentage}%`, col5X, y, { width: 80 });
      
      y += 20;
    });

    // Footer
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

// Generate PDF for class attendance report
router.get('/class/pdf', verifyToken, async (req, res) => {
  const { department, section, year, subject_id, start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    if (!department || !section || !year) {
      return res.status(400).json({ error: 'Department, section, and year are required' });
    }

    // Get all students in the class
    const studentsResult = await db.query(
      'SELECT student_id, name FROM students WHERE department = $1 AND section = $2 AND year = $3 ORDER BY name',
      [department, section, year]
    );

    // Get attendance records
    let query = `
      SELECT 
        st.student_id,
        st.name,
        sub.id as subject_id,
        sub.subject_code,
        sub.subject_name,
        COUNT(ar.id) as total_classes,
        COUNT(CASE WHEN ar.status = 'present' THEN 1 END) as classes_attended,
        COUNT(CASE WHEN ar.status = 'absent' THEN 1 END) as classes_absent
      FROM students st
      LEFT JOIN attendance_records ar ON ar.student_id = st.student_id
      LEFT JOIN attendance_sessions ats ON ar.session_id = ats.id
      LEFT JOIN subjects sub ON ats.subject_id = sub.id
      WHERE st.department = $1 AND st.section = $2 AND st.year = $3
    `;

    const params = [department, section, year];
    let paramCount = 4;

    if (subject_id) {
      query += ` AND sub.id = $${paramCount}`;
      params.push(subject_id);
      paramCount++;
    }

    if (start_date) {
      query += ` AND ats.session_date >= $${paramCount}`;
      params.push(start_date);
      paramCount++;
    }

    if (end_date) {
      query += ` AND ats.session_date <= $${paramCount}`;
      params.push(end_date);
      paramCount++;
    }

    query += `
      GROUP BY st.student_id, st.name, sub.id, sub.subject_code, sub.subject_name
      ORDER BY st.name, sub.subject_code
    `;

    const result = await db.query(query, params);

    // Group by student
    const studentMap = {};
    studentsResult.rows.forEach(student => {
      studentMap[student.student_id] = {
        student_id: student.student_id,
        name: student.name,
        subjects: [],
        overall: { total: 0, attended: 0, percentage: 0 }
      };
    });

    result.rows.forEach(row => {
      if (row.subject_id) {
        const subjectData = {
          subject_code: row.subject_code,
          subject_name: row.subject_name,
          total_classes: parseInt(row.total_classes || 0),
          classes_attended: parseInt(row.classes_attended || 0),
          classes_absent: parseInt(row.classes_absent || 0),
          percentage: row.total_classes > 0 
            ? parseFloat(((row.classes_attended / row.total_classes) * 100).toFixed(2))
            : 0
        };

        studentMap[row.student_id].subjects.push(subjectData);
        studentMap[row.student_id].overall.total += subjectData.total_classes;
        studentMap[row.student_id].overall.attended += subjectData.classes_attended;
      }
    });

    Object.values(studentMap).forEach(student => {
      student.overall.percentage = student.overall.total > 0
        ? parseFloat(((student.overall.attended / student.overall.total) * 100).toFixed(2))
        : 0;
    });

    const students = Object.values(studentMap);

    // Create PDF
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=class_attendance_${department}_${section}_${year}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(18).text('Class Attendance Report', { align: 'center' });
    doc.moveDown(0.5);
    
    doc.fontSize(12);
    doc.text(`Department: ${department} | Section: ${section} | Year: ${year}`, { align: 'center' });
    if (start_date || end_date) {
      doc.text(`Period: ${start_date || 'Start'} to ${end_date || 'Present'}`, { align: 'center' });
    }
    doc.moveDown();

    // Overall class statistics
    const classTotal = students.reduce((sum, s) => sum + s.overall.total, 0);
    const classAttended = students.reduce((sum, s) => sum + s.overall.attended, 0);
    const classPercentage = classTotal > 0 ? ((classAttended / classTotal) * 100).toFixed(2) : 0;

    doc.fontSize(11).text(`Total Students: ${students.length} | Class Average: ${classPercentage}%`);
    doc.moveDown();

    // Table
    const tableTop = doc.y;
    const rowHeight = 20;
    const col1X = 50;
    const col2X = 130;
    const col3X = 280;
    const col4X = 380;
    const col5X = 450;
    const col6X = 520;
    const col7X = 590;
    const col8X = 680;

    // Table header
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('S.No', col1X, tableTop);
    doc.text('Student ID', col2X, tableTop);
    doc.text('Name', col3X, tableTop);
    doc.text('Total', col4X, tableTop);
    doc.text('Present', col5X, tableTop);
    doc.text('Absent', col6X, tableTop);
    doc.text('%', col7X, tableTop);
    doc.text('Status', col8X, tableTop);
    
    doc.moveTo(col1X, tableTop + 12).lineTo(750, tableTop + 12).stroke();

    // Table rows
    doc.font('Helvetica');
    let y = tableTop + 18;
    let serialNo = 1;

    students.forEach((student) => {
      if (y > 500) {
        doc.addPage();
        y = 50;
        
        // Re-draw header on new page
        doc.fontSize(9).font('Helvetica-Bold');
        doc.text('S.No', col1X, y);
        doc.text('Student ID', col2X, y);
        doc.text('Name', col3X, y);
        doc.text('Total', col4X, y);
        doc.text('Present', col5X, y);
        doc.text('Absent', col6X, y);
        doc.text('%', col7X, y);
        doc.text('Status', col8X, y);
        doc.moveTo(col1X, y + 12).lineTo(750, y + 12).stroke();
        doc.font('Helvetica');
        y += 18;
      }

      const percentage = student.overall.percentage;
      const status = percentage >= 75 ? 'Good' : percentage >= 65 ? 'Warning' : 'Critical';

      doc.fontSize(8);
      doc.text(serialNo.toString(), col1X, y);
      doc.text(student.student_id, col2X, y, { width: 140 });
      doc.text(student.name, col3X, y, { width: 90 });
      doc.text(student.overall.total.toString(), col4X, y);
      doc.text(student.overall.attended.toString(), col5X, y);
      doc.text((student.overall.total - student.overall.attended).toString(), col6X, y);
      doc.text(percentage.toFixed(1), col7X, y);
      doc.text(status, col8X, y);
      
      y += rowHeight;
      serialNo++;
    });

    // Footer
    doc.fontSize(8).text(
      `Generated on ${moment().format('MMMM Do YYYY, h:mm:ss a')}`,
      50,
      550,
      { align: 'center' }
    );

    // Legend
    doc.moveDown();
    doc.fontSize(8);
    doc.text('Status Legend: Good (≥75%) | Warning (65-74%) | Critical (<65%)', { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Error generating class PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
  }
});

// Get comprehensive class attendance report (all subjects for all students)
router.get('/class/comprehensive', verifyToken, async (req, res) => {
  const { department, section, year, start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    if (!department || !section || !year) {
      return res.status(400).json({
        error: 'Department, section and year are required'
      });
    }

    /* ================== STUDENTS ================== */
    const studentsResult = await db.query(
      `SELECT student_id, name
       FROM students
       WHERE department = $1 AND section = $2 AND year = $3
       ORDER BY student_id`,
      [department, section, year]
    );

    if (studentsResult.rows.length === 0) {
      return res.json({
        department,
        section,
        year,
        subjects: [],
        students: []
      });
    }

    /* ================== SUBJECTS ================== */
    const subjectsResult = await db.query(
      `SELECT id, subject_code, subject_name
       FROM subjects
       WHERE department = $1 AND year = $2
       ORDER BY subject_code`,
      [department, year]
    );

    /* ================== ATTENDANCE ================== */
    let attendanceQuery = `
      SELECT
        ar.student_id,
        ats.subject_id,
        COUNT(ar.id) AS total,
        COUNT(*) FILTER (WHERE ar.status = 'present') AS present
      FROM attendance_records ar
      JOIN attendance_sessions ats ON ar.session_id = ats.id
      WHERE ats.year = $1
        AND ar.student_id = ANY($2::text[])
        AND ats.subject_id = ANY($3::int[])
    `;

    const params = [
      year,
      studentsResult.rows.map(s => s.student_id),
      subjectsResult.rows.map(s => s.id)
    ];

    let idx = 4;

    if (start_date) {
      attendanceQuery += ` AND ats.session_date >= $${idx++}`;
      params.push(start_date);
    }

    if (end_date) {
      attendanceQuery += ` AND ats.session_date <= $${idx++}`;
      params.push(end_date);
    }

    attendanceQuery += ` GROUP BY ar.student_id, ats.subject_id`;

    const attendanceResult = await db.query(attendanceQuery, params);

    /* ================== MAP ================== */
    const attendanceMap = {};
    attendanceResult.rows.forEach(r => {
      attendanceMap[`${r.student_id}_${r.subject_id}`] = {
        total: Number(r.total),
        present: Number(r.present)
      };
    });

    /* ================== BUILD GRID ================== */
    const students = studentsResult.rows.map((st, index) => {
      const subjectScores = {};
      let overallTotal = 0;
      let overallPresent = 0;

      subjectsResult.rows.forEach(sub => {
        const key = `${st.student_id}_${sub.id}`;
        const rec = attendanceMap[key] || { total: 0, present: 0 };

        const percentage =
          rec.total > 0
            ? Number(((rec.present / rec.total) * 100).toFixed(1))
            : null;

        subjectScores[sub.subject_code] = percentage;
        overallTotal += rec.total;
        overallPresent += rec.present;
      });

      return {
        sl: index + 1,
        student_id: st.student_id,
        name: st.name,
        subjects: subjectScores,
        overall_percentage:
          overallTotal > 0
            ? Number(((overallPresent / overallTotal) * 100).toFixed(1))
            : null
      };
    });

    /* ================== RESPONSE ================== */
    res.json({
      department,
      section,
      year,
      subjects: subjectsResult.rows.map(s => ({
        id: s.id,
        code: s.subject_code,
        name: s.subject_name,
        display: `${s.subject_name} (${s.subject_code})`
      })),
      students
    });

  } catch (err) {
    console.error('Comprehensive report error:', err);
    res.status(500).json({ error: err.message });
  }
});


// Generate comprehensive PDF for class
router.get('/class/comprehensive/pdf', verifyToken, async (req, res) => {
  const { department, section, year, start_date, end_date } = req.query;
  const db = req.app.locals.db;

  try {
    if (!department || !section || !year) {
      return res.status(400).json({ error: 'Department, section, year required' });
    }

    // 1️⃣ Students
    const studentsResult = await db.query(
      `SELECT student_id, name
       FROM students
       WHERE department=$1 AND section=$2 AND year=$3
       ORDER BY student_id`,
      [department, section, year]
    );

    // 2️⃣ Subjects
    const subjectsResult = await db.query(
      `SELECT id, subject_code, subject_name
       FROM subjects
       WHERE department=$1 AND year=$2
       ORDER BY subject_code`,
      [department, year]
    );

    // 3️⃣ Attendance aggregation
    const attendanceResult = await db.query(
      `
      SELECT 
        ar.student_id,
        ats.subject_id,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE ar.status='present') AS present
      FROM attendance_records ar
      JOIN attendance_sessions ats ON ar.session_id = ats.id
      WHERE ats.year = $1
      GROUP BY ar.student_id, ats.subject_id
      `,
      [year]
    );

    // Build lookup map
    const map = {};
    attendanceResult.rows.forEach(r => {
      map[`${r.student_id}_${r.subject_id}`] = r;
    });

    // PDF setup
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 30
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=VFSTR_Attendance_${department}_${section}_${year}.pdf`
    );

    doc.pipe(res);

    /* ================= HEADER ================= */

    /* ================= HEADER ================= */

doc.fontSize(18).font('Helvetica-Bold').text('VFSTR', { align: 'center' });
doc.moveDown(0.3);

doc.fontSize(11).font('Helvetica');
doc.text(
  `Course: B.TECH      Branch: ${department}      YEAR:${year.split('-')[1]}      Section : ${section}`,
  { align: 'center' }
);

doc.moveDown(0.3);
doc.fontSize(12).font('Helvetica-Bold').text('Class Attendance Report', { align: 'center' });
doc.moveDown(1);

/* ================= TABLE CONSTANTS ================= */

const startX = 40;
const slW = 30;
const regW = 90;
const nameW = 160;
const subjW = 65;
const rowH = 18;
const headerH = 48;

let y = doc.y;

/* ================= TABLE HEADER FUNCTION ================= */

const drawTableHeader = () => {
  let x = startX;
  doc.fontSize(8).font('Helvetica-Bold');

  doc.text('SL', x, y, { width: slW, align: 'center' });
  x += slW;

  doc.text('REGD.NO.', x, y, { width: regW, align: 'center' });
  x += regW;

  doc.text('NAME', x, y, { width: nameW, align: 'center' });
  x += nameW;

  subjectsResult.rows.forEach(sub => {
    doc.text(sub.subject_name, x, y, {
      width: subjW,
      align: 'center'
    });

    doc.text(`(${sub.subject_code})`, x, y + 30, {
      width: subjW,
      align: 'center'
    });

    x += subjW;
  });

  doc.moveTo(startX, y + headerH)
     .lineTo(x, y + headerH)
     .stroke();

  y += headerH + 6;
};

/* ================= DRAW INITIAL HEADER ================= */

drawTableHeader();

/* ================= TABLE BODY ================= */

doc.font('Helvetica').fontSize(8);

studentsResult.rows.forEach((st, index) => {
  if (y > 520) {
    doc.addPage();
    y = 50;
    drawTableHeader();
  }

  let x = startX;

  doc.text(index + 1, x, y, { width: slW, align: 'center' });
  x += slW;

  doc.text(st.student_id, x, y, { width: regW });
  x += regW;

  doc.text(st.name, x, y, { width: nameW });
  x += nameW;

  subjectsResult.rows.forEach(sub => {
    const r = map[`${st.student_id}_${sub.id}`];
    const pct =
      r && r.total > 0
        ? ((r.present / r.total) * 100).toFixed(1)
        : '0.0';

    doc.text(pct, x, y, { width: subjW, align: 'center' });
    x += subjW;
  });

  y += rowH;
});

/* ================= FOOTER ================= */

doc.fontSize(7).text(
  `Generated on ${moment().format('MMMM Do YYYY, h:mm:ss a')}`,
  startX,
  y + 20,
  { align: 'center', width: 1100 }
);

doc.end();

  } catch (err) {
    console.error('Comprehensive PDF error:', err);
    res.status(500).json({ error: err.message });
  }
});



module.exports = router;