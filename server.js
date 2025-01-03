const express = require("express");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const cors = require("cors");
const path = require("path");
const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const app = express();
const PORT = process.env.PORT || 5005;
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST, // ใช้ค่าจาก .env
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10), // แปลงเป็นตัวเลข
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10), // แปลงเป็นตัวเลข
});

async function getConnection() {
  try {
    return await pool.getConnection();
  } catch (err) {
    console.error("Error getting a connection from the pool:", err);
    throw err;
  }
}

app.get("/dataindex_all", async (req, res) => {
  connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(`
      select * from flowers
      `);
    const [rows_total] = await connection.execute(`
        select count(*) as total from flowers
        `);

    [rows_best] = await connection.execute(`
          SELECT 
      bf.id_bflower as id, 
      bf.name_code as name, 
      bf.price , 
      MIN(img.url_image) AS url_image
  FROM 
      bunch_flowers AS bf
  LEFT JOIN 
      image_all AS img 
  ON 
      bf.id_bflower = img.id_bflower
  GROUP BY 
      bf.id_bflower
      limit 10
      ;
        `);
    [rows_flower] = await connection.execute(`
      SELECT 
      name , meaning ,url_image
  from flowers
  limit 4
  ;
    `);

    res.json({
      data: rows,
      total: rows_total,
      data_best: rows_best,
      data_flower: rows_flower,
    });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/getDatabestseller", async (req, res) => {
  connection = await pool.getConnection();
  let type = req.query.select_type;
  // console.log(type)
  try {
    let rows; // ตัวแปรสำหรับเก็บผลลัพธ์จาก query
    let rows_total; // ตัวแปรสำหรับเก็บผลรวมจาก query

    if (type === 1) {
      // ใช้ === เพื่อตรวจสอบชนิดข้อมูลอย่างเคร่งครัด
      [rows] = await connection.execute(`
        SELECT 
    bf.id_bflower, 
    bf.name_code, 
    bf.price, 
    bf.description, 
    MIN(img.url_image) AS url_image
FROM 
    bunch_flowers AS bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
GROUP BY 
    bf.id_bflower;
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    } else if (type == 2) {
      [rows] = await connection.execute(`
        SELECT 
    bf.id_bflower, 
    bf.name_code, 
    bf.price, 
    bf.description, 
    MIN(img.url_image) AS url_image
FROM 
    bunch_flowers AS bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
GROUP BY 
    bf.id_bflower
        ORDER BY price ASC;
      `);
      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    } else {
      [rows] = await connection.execute(`
        SELECT 
    bf.id_bflower, 
    bf.name_code, 
    bf.price, 
    bf.description, 
    MIN(img.url_image) AS url_image
FROM 
    bunch_flowers AS bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
GROUP BY 
    bf.id_bflower
        ORDER BY price DESC;
      `);

      [rows_total] = await connection.execute(`
        SELECT COUNT(*) AS total FROM bunch_flowers
      `);
    }

    res.json({ data: rows, total: rows_total });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  } finally {
    connection.release(); // ปล่อย connection กลับไปที่ pool
  }
});

app.get("/users", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM user");
    res.json(rows);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Error retrieving data");
  }
});

app.post("/select_detail_flower", async (req, res) => {
  let select_id_flower = req.body.id_select;
  // console.log(select_id_flower)
  try {
    const [rows_img] = await pool.execute(
      `SELECT img.url_image as url FROM bunch_flowers  as bf
LEFT JOIN 
    image_all AS img 
ON 
    bf.id_bflower = img.id_bflower
where bf.id_bflower  = ?
      `,
      [select_id_flower]
    );
    const [rows_data] = await pool.execute(
      `SELECT   bf.id_bflower, 
        bf.name_code, 
        bf.price, 
        bf.description
    FROM bunch_flowers  as bf
    where bf.id_bflower  = ?
      `,
      [select_id_flower]
    );
    // console.log(rows)
    res.json({ data_img: rows_img, data: rows_data });
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Error retrieving data");
  }
});
app.get("/datainvolve", async (req, res) => {
  connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(`
      select * from flowers
      `);
    const [rows_total] = await connection.execute(`
        select count(*) as total from flowers
        `);

    [rows_best] = await connection.execute(`
          SELECT 
      bf.id_bflower as id, 
      bf.name_code as name, 
      bf.price , 
      MIN(img.url_image) AS url_image
  FROM 
      bunch_flowers AS bf
  LEFT JOIN 
      image_all AS img 
  ON 
      bf.id_bflower = img.id_bflower
  GROUP BY 
      bf.id_bflower
      limit 10
      ;
        `);
    res.json({ data: rows, total: rows_total, data_best: rows_best });
  } catch (err) {
    res.status(500).send("Can't get Data request");
  }
});

app.post("/check-login", async (req, res) => {
  let connection;
  const { email, pwd } = req.body;

  try {
    connection = await getConnection();
    const [rows] = await connection.execute(
      `SELECT id_uc as id ,email,role,nname as nickname FROM user_customers
      WHERE email = ? AND pwd = ? `,
      [email, pwd]
    );

    if (rows.length > 0) {
      const user = rows[0];
      const payload = {
        id: user.id_uc,
        nickname: user.nickname,
        role: user.role,
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
        expiresIn: "1d",
      });
      // console.log(token)
      res.json({
        status: true,
        token,
        id: user.id,
        role: user.role,
        nickname: user.nickname,
      });
    } else {
      res.status(401).json({ status: false, message: "Invalid credentials" });
    }
  } catch (err) {
    console.error("Error checking login:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
app.put("/register", async (req, res) => {
  let connection;
  const { email, pwd, fname, lname, nname, tel } = req.body.formData;
  try {
    connection = await getConnection();
    // console.log(req.body)
    // ตรวจสอบว่ามีผู้ใช้ที่ใช้อีเมลนี้อยู่แล้วหรือไม่
    const [existingUser] = await connection.execute(
      `SELECT id_uc FROM user_customers WHERE email = ?`,
      [email]
    );

    if (existingUser.length > 0) {
      return res
        .status(400)
        .json({ status: false, message: "อีเมลนี้ถูกใช้งานไปแล้ว" });
    }

    // เพิ่มข้อมูลผู้ใช้ใหม่
    await connection.execute(
      `INSERT INTO user_customers (id_uc,email, pwd, fname, lname, nname, tel) 
       VALUES (uuid(),?, ?, ?, ?, ?, ?)`,
      [email, pwd, fname, lname, nname, tel] // กำหนด role เป็น "user" โดยค่าเริ่มต้น
    );

    // รับ ID ผู้ใช้ใหม่ที่เพิ่งเพิ่ม
    const [newUser] = await connection.execute(
      `SELECT id_uc as id, email, role, nname as nickname 
       FROM user_customers WHERE email = ?`,
      [email]
    );

    const user = newUser[0];
    const payload = { id: user.id, nickname: user.nickname, role: user.role };

    // สร้าง token
    const token = jwt.sign(payload, process.env.JWT_SECRET_KEY, {
      expiresIn: "1d",
    });

    res.json({
      status: true,
      message: "สมัครสมาชิกสำเร็จ",
      token,
      id: user.id,
      role: user.role,
      nickname: user.nickname,
    });
    // console.log('ss')
  } catch (err) {
    console.error("Error during registration:", err);
    res.status(500).json({ status: false, message: "Server error" });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});
app.get("/", (req, res) => {
  res.send("Hello Backend!");
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
