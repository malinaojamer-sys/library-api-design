const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
const PORT = 3000;


app.use(cors());
app.use(express.json());


const db = mysql.createPool({
    host: 'localhost',
    user: 'root',      
    password: '',      
    database: 'library_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});


db.getConnection()
    .then(conn => {
        console.log('✅ Connected to MySQL database successfully.');
        conn.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
    });


app.get('/api/v1/members', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM members');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.get('/api/v1/members/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM members WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: `Member with ID ${req.params.id} does not exist` } });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});

app.post('/api/v1/members', async (req, res) => {
    const { name, email, phone } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: { code: "MISSING_FIELDS", message: "Name and email are required fields" } });
    }

    try {
        const [existing] = await db.query('SELECT id FROM members WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ error: { code: "EMAIL_ALREADY_EXISTS", message: "A member with this email address already exists" } });
        }

        const [result] = await db.query(
            'INSERT INTO members (name, email, phone) VALUES (?, ?, ?)',
            [name, email, phone || null]
        );

        res.status(201).json({ id: result.insertId, name, email, phone: phone || null });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.delete('/api/v1/members/:id', async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM members WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member not found" } });
        }
        res.status(200).json({ message: `Member with ID ${req.params.id} was successfully deleted` });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});



app.get('/api/v1/books', async (req, res) => {
    try {
        const { search, category_id, sort = 'id', order = 'asc', page = 1, limit = 10 } = req.query;
        let queryParams = [];
        let conditions = [];

        if (search) {
            conditions.push('(title LIKE ? OR author LIKE ?)');
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        if (category_id) {
            conditions.push('category_id = ?');
            queryParams.push(parseInt(category_id));
        }

        let sql = 'SELECT * FROM books';
        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

       
        const allowedSorts = ['id', 'title', 'author', 'published_year', 'available_copies'];
        const sortColumn = allowedSorts.includes(sort) ? sort : 'id';
        const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        sql += ` ORDER BY ${sortColumn} ${sortOrder}`;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        sql += ' LIMIT ? OFFSET ?';
        queryParams.push(parseInt(limit), parseInt(offset));

        const [rows] = await db.query(sql, queryParams);
        const [countResult] = await db.query('SELECT COUNT(*) as total FROM books');

        res.json({
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit),
            data: rows
        });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.get('/api/v1/books/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: { code: "BOOK_NOT_FOUND", message: `Book with ID ${req.params.id} does not exist` } });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.post('/api/v1/books', async (req, res) => {
    const { title, author, isbn, published_year, category_id, available_copies } = req.body;

    if (!title || !author || !isbn) {
        return res.status(400).json({ error: { code: "MISSING_FIELDS", message: "Title, author, and ISBN are required" } });
    }

    try {
        const [existing] = await db.query('SELECT id FROM books WHERE isbn = ?', [isbn]);
        if (existing.length > 0) {
            return res.status(409).json({ error: { code: "DUPLICATE_ISBN", message: "A book with this ISBN already exists" } });
        }

        const [result] = await db.query(
            'INSERT INTO books (title, author, isbn, published_year, category_id, available_copies) VALUES (?, ?, ?, ?, ?, ?)',
            [title, author, isbn, published_year || null, category_id || null, available_copies ?? 1]
        );

        res.status(201).json({ id: result.insertId, title, author, isbn, published_year, category_id, available_copies });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.patch('/api/v1/books/:id', async (req, res) => {
    const bookId = req.params.id;
    const updates = req.body;

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: { code: "EMPTY_BODY", message: "No fields provided to update" } });
    }

    try {
        const fields = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            fields.push(`${key} = ?`);
            values.push(value);
        }
        values.push(bookId);

        const sql = `UPDATE books SET ${fields.join(', ')} WHERE id = ?`;
        const [result] = await db.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: { code: "BOOK_NOT_FOUND", message: "Book not found" } });
        }

        res.json({ message: "Book updated successfully" });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.delete('/api/v1/books/:id', async (req, res) => {
    const bookId = req.params.id;

    try {
        
        const [activeLoans] = await db.query('SELECT id FROM loans WHERE book_id = ? AND status = "active"', [bookId]);
        if (activeLoans.length > 0) {
            return res.status(409).json({ error: { code: "ACTIVE_LOANS_EXIST", message: "Cannot delete book because it is currently borrowed" } });
        }

        const [result] = await db.query('DELETE FROM books WHERE id = ?', [bookId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: { code: "BOOK_NOT_FOUND", message: "Book not found" } });
        }

        res.status(200).json({ message: `Book with ID ${bookId} was successfully deleted` });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});



app.post('/api/v1/loans', async (req, res) => {
    const { member_id, book_id, due_date } = req.body;

    if (!member_id || !book_id || !due_date) {
        return res.status(400).json({ error: { code: "MISSING_FIELDS", message: "member_id, book_id, and due_date are required" } });
    }

    try {
        
        const [member] = await db.query('SELECT id FROM members WHERE id = ?', [member_id]);
        if (member.length === 0) {
            return res.status(404).json({ error: { code: "MEMBER_NOT_FOUND", message: "Member ID not found" } });
        }

        
        const [book] = await db.query('SELECT id, available_copies FROM books WHERE id = ?', [book_id]);
        if (book.length === 0) {
            return res.status(404).json({ error: { code: "BOOK_NOT_FOUND", message: "Book ID not found" } });
        }

        if (book[0].available_copies <= 0) {
            return res.status(409).json({ error: { code: "BOOK_NOT_AVAILABLE", message: "This book has no available copies for borrowing" } });
        }

        const loanDate = new Date().toISOString().split('T')[0];

        
        await db.query('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?', [book_id]);

        
        const [loanResult] = await db.query(
            'INSERT INTO loans (member_id, book_id, loan_date, due_date, status) VALUES (?, ?, ?, ?, "active")',
            [member_id, book_id, loanDate, due_date]
        );

        res.status(201).json({
            id: loanResult.insertId,
            member_id,
            book_id,
            loan_date: loanDate,
            due_date,
            status: "active"
        });
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.get('/api/v1/members/:id/loans', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT l.*, b.title as book_title FROM loans l JOIN books b ON l.book_id = b.id WHERE l.member_id = ?', 
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});



app.get('/api/v1/categories/:id/books', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM books WHERE category_id = ?', [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: { code: "SERVER_ERROR", message: err.message } });
    }
});


app.use((req, res) => {
    res.status(404).json({ error: { code: "ROUTE_NOT_FOUND", message: "The requested route does not exist" } });
});

app.listen(PORT, () => {
    console.log(`🚀 Library API server running on http://localhost:${PORT}/api/v1`);
});