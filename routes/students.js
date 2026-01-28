const express = require('express');
const axios = require('axios');
const { verifyToken } = require('./auth');
const router = express.Router();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';

// Register new student
router.post('/register', verifyToken, async (req, res) => {
  const { student_id, name, email, department, year, section, image } = req.body;
  const db = req.app.locals.db;

  try {
    // Check if student ID already exists
    const existingStudent = await db.query(
      'SELECT student_id FROM students WHERE student_id = $1',
      [student_id]
    );

    if (existingStudent.rows.length > 0) {
      return res.status(400).json({ error: 'Student ID already exists. Please use a different ID.' });
    }

    // Get face encoding from ML service
    const mlResponse = await axios.post(`${ML_SERVICE_URL}/register_face`, {
      image: image
    });

    if (!mlResponse.data.success) {
      return res.status(400).json({ error: mlResponse.data.error });
    }

    const faceEncoding = JSON.stringify(mlResponse.data.embedding);

    // Insert student into database
    const result = await db.query(
      `INSERT INTO students (student_id, name, email, department, year, section, face_encoding) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING id, student_id, name, email, department, registered_at`,
      [student_id, name, email, department, year, section, faceEncoding]
    );

    res.status(201).json({
      message: 'Student registered successfully',
      student: result.rows[0]
    });
  } catch (error) {
    console.error('Student registration error:', error);
    if (error.response?.data?.error) {
      res.status(400).json({ error: error.response.data.error });
    } else {
      res.status(500).json({ error: 'Failed to register student' });
    }
  }
});

// Get all students
router.get('/', verifyToken, async (req, res) => {
  const { department, section, year } = req.query;
  const db = req.app.locals.db;

  try {
    let query = `SELECT student_id, name, email, department, section, year FROM students WHERE 1=1`;
    const params = [];
    let i = 1;

    if (department) {
      query += ` AND LOWER(department) = LOWER($${i++})`;
      params.push(department);
    }

    if (section) {
      query += ` AND LOWER(section) = LOWER($${i++})`;
      params.push(section);
    }

    if (year) {
      query += ` AND LOWER(year) = LOWER($${i++})`;
      params.push(year);
    }

    query += ` ORDER BY student_id`;

    const result = await db.query(query, params);
    res.json({ students: result.rows });

  } catch (err) {
    console.error('Fetch students error:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get student by ID
router.get('/:student_id', verifyToken, async (req, res) => {
  const { student_id } = req.params;
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `SELECT id, student_id, name, email, department, year, section, registered_at
       FROM students 
       WHERE student_id = $1`,
      [student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ student: result.rows[0] });
  } catch (error) {
    console.error('Error fetching student:', error);
    res.status(500).json({ error: 'Failed to fetch student' });
  }
});

// Update student
router.put('/:student_id', verifyToken, async (req, res) => {
  const { student_id } = req.params;
  const { name, email, department } = req.body;
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `UPDATE students 
       SET name = $1, email = $2, department = $3 
       WHERE student_id = $4 
       RETURNING id, student_id, name, email, department`,
      [name, email, department, student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      message: 'Student updated successfully',
      student: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating student:', error);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
router.delete('/:student_id', verifyToken, async (req, res) => {
  const { student_id } = req.params;
  const db = req.app.locals.db;

  // Only admin can delete students
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin can delete students' });
  }

  try {
    const result = await db.query(
      'DELETE FROM students WHERE student_id = $1 RETURNING student_id',
      [student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Search students
router.get('/search/:query', verifyToken, async (req, res) => {
  const { query } = req.params;
  const db = req.app.locals.db;

  try {
    const result = await db.query(
      `SELECT id, student_id, name, email, department, year, section, registered_at
       FROM students 
       WHERE name ILIKE $1 OR student_id ILIKE $1 OR email ILIKE $1 
       ORDER BY name ASC`,
      [`%${query}%`]
    );

    res.json({ students: result.rows });
  } catch (error) {
    console.error('Error searching students:', error);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

module.exports = router;